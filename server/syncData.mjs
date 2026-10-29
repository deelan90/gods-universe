import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  SOLAR_SYSTEM_BODIES,
  CURATED_COSMIC_LANDMARKS,
  ZODIAC_STAR_SIGNS,
} from './curatedUniverse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const PUBLIC_DATA_DIR = path.join(ROOT_DIR, 'public', 'data');
export const CACHE_DIR = path.join(ROOT_DIR, 'data', 'cache');

// Default continual check interval: every 72 hours (3 days)
export const DEFAULT_SYNC_INTERVAL_HOURS = 72;

const PC_TO_LY = 3.261563777;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Convert Equatorial (RA deg, Dec deg, Distance in ly) -> Three.js Right-Handed J2000 Equatorial (X, Y=North, Z)
 * X = dist * cos(dec) * cos(ra)
 * Y = dist * sin(dec)            [North Celestial Pole = +Y]
 * Z = -dist * cos(dec) * sin(ra) [Right-handed basis: det = +1]
 */
export function raDecDistToThreeLy(raDeg, decDeg, distLy) {
  const ra = ((raDeg % 360) + 360) % 360 * DEG_TO_RAD;
  const dec = decDeg * DEG_TO_RAD;
  const cosDec = Math.cos(dec);
  const xEq = distLy * cosDec * Math.cos(ra);
  const yEq = distLy * cosDec * Math.sin(ra);
  const zEq = distLy * Math.sin(dec);
  return [
    Number(xEq.toPrecision(8)),
    Number(zEq.toPrecision(8)),
    Number((-yEq).toPrecision(8)),
  ];
}

function round(val, digits = 3) {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return null;
  const f = 10 ** digits;
  return Math.round(Number(val) * f) / f;
}

function classifyExoplanet(rade, bmasse, eqt) {
  const r = rade ?? (bmasse ? Math.pow(bmasse, 0.28) : 1.5);
  if (eqt && eqt > 1500 && r < 2.2) return 'Lava World';
  if (r <= 1.6) return 'Rocky';
  if (r <= 2.5) return 'Super-Earth';
  if (r <= 4.5) return 'Ice Giant';
  return 'Gas Giant';
}

function estimateStarTempFromSpectOrBV(spect, bv) {
  if (bv !== null && bv !== undefined && !Number.isNaN(bv)) {
    // Ballesteros (2012) formula B-V -> Teff
    const c = Math.max(-0.4, Math.min(2.2, Number(bv)));
    return Math.round(4600 * (1 / (0.92 * c + 1.7) + 1 / (0.92 * c + 0.62)));
  }
  const s = (spect || 'G').trim().toUpperCase()[0];
  const map = { O: 36000, B: 18000, A: 8600, F: 6600, G: 5778, K: 4500, M: 3200 };
  return map[s] || 5500;
}

function spectralClassLetter(spect, teff) {
  const s = (spect || '').trim().toUpperCase()[0];
  if (['O', 'B', 'A', 'F', 'G', 'K', 'M'].includes(s)) return s;
  if (!teff) return 'G';
  if (teff >= 30000) return 'O';
  if (teff >= 10000) return 'B';
  if (teff >= 7500) return 'A';
  if (teff >= 6000) return 'F';
  if (teff >= 5200) return 'G';
  if (teff >= 3700) return 'K';
  return 'M';
}

async function fetchWithTimeout(url, timeoutMs = 35000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'GodsUniverseObservatory/1.0 (Public Science Data Sync)',
        Accept: 'application/json, text/plain, */*',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureDirs() {
  await fsp.mkdir(PUBLIC_DATA_DIR, { recursive: true });
  await fsp.mkdir(CACHE_DIR, { recursive: true });
}

async function readJsonSafe(filePath, fallback = null) {
  try {
    const raw = await fsp.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * 1. Sync Confirmed Exoplanets from Official NASA Exoplanet Archive TAP API
 */
async function syncExoplanets(previousManifest) {
  console.log('[Sync] Querying NASA Exoplanet Archive TAP API (pscomppars)...');
  const query = [
    'select pl_name,hostname,sy_dist,pl_rade,pl_bmasse,pl_eqt,pl_orbper,pl_orbsmax,pl_orbeccen,',
    'st_teff,st_rad,st_mass,st_lum,st_spectype,disc_year,disc_pubdate,disc_facility,discoverymethod,ra,dec',
    'from pscomppars',
    'where sy_dist is not null and ra is not null and dec is not null',
    'order by disc_year desc, disc_pubdate desc',
  ].join(' ');

  const url = `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetchWithTimeout(url, 45000);
  const rows = await res.json();

  const prevKnownSet = new Set(previousManifest?.knownExoplanetNames || []);
  const currentYear = new Date().getFullYear();

  const exoplanets = [];
  const recentDiscoveries = [];

  for (const r of rows) {
    const distLy = Number(r.sy_dist) * PC_TO_LY;
    if (!Number.isFinite(distLy) || distLy <= 0) continue;

    const rade = r.pl_rade ? Number(r.pl_rade) : (r.pl_bmasse ? Math.pow(Number(r.pl_bmasse), 0.28) : 1.4);
    const bmasse = r.pl_bmasse ? Number(r.pl_bmasse) : Math.pow(rade, 3.0);
    const eqt = r.pl_eqt ? Math.round(Number(r.pl_eqt)) : null;
    const planetType = classifyExoplanet(rade, bmasse, eqt);

    // Host star luminosity in solar units (st_lum in NASA TAP is log10(L/Lsun))
    let lumSolar = 1.0;
    if (r.st_lum !== null && r.st_lum !== undefined && !Number.isNaN(Number(r.st_lum))) {
      lumSolar = Math.pow(10, Number(r.st_lum));
    } else if (r.st_rad && r.st_teff) {
      lumSolar = Math.pow(Number(r.st_rad), 2) * Math.pow(Number(r.st_teff) / 5778, 4);
    }

    const hzInnerAu = Math.sqrt(Math.max(0.00001, lumSolar) / 1.1);
    const hzOuterAu = Math.sqrt(Math.max(0.00001, lumSolar) / 0.53);
    const orbsmax = r.pl_orbsmax ? Number(r.pl_orbsmax) : null;

    const inHabitableZone = Boolean(
      (orbsmax && orbsmax >= hzInnerAu * 0.85 && orbsmax <= hzOuterAu * 1.15) ||
        (eqt && eqt >= 185 && eqt <= 315 && rade <= 2.2)
    );

    const posLy = raDecDistToThreeLy(Number(r.ra), Number(r.dec), distLy);
    const discYear = r.disc_year ? Number(r.disc_year) : null;
    const isNewlyAdded = prevKnownSet.size > 0 && !prevKnownSet.has(r.pl_name);
    const isRecent = Boolean(isNewlyAdded || (discYear && discYear >= currentYear - 1) || (r.disc_pubdate && r.disc_pubdate >= '2025-01'));

    const planet = {
      id: `exo-${r.pl_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: r.pl_name,
      hostStar: r.hostname,
      ra: round(r.ra, 4),
      dec: round(r.dec, 4),
      distLy: round(distLy, 2),
      posLy,
      earthRadii: round(rade, 2),
      massEarths: round(bmasse, 2),
      tempK: eqt,
      planetType,
      orbPeriodDays: round(r.pl_orbper, 3),
      semiMajorAxisAu: round(orbsmax, 4),
      eccentricity: round(r.pl_orbeccen, 3) ?? 0,
      starTeff: r.st_teff ? Math.round(Number(r.st_teff)) : 5200,
      starRadiiSolar: round(r.st_rad, 2) ?? 0.9,
      starLumSolar: round(lumSolar, 5),
      starSpecClass: spectralClassLetter(r.st_spectype, r.st_teff),
      hzInnerAu: round(hzInnerAu, 4),
      hzOuterAu: round(hzOuterAu, 4),
      inHabitableZone,
      discYear,
      discPubDate: r.disc_pubdate || null,
      discFacility: r.disc_facility || 'Astronomical Survey',
      discMethod: r.discoverymethod || 'Transit / Radial Velocity',
      isRecent,
    };

    exoplanets.push(planet);
    if (recentDiscoveries.length < 30 && (isNewlyAdded || isRecent)) {
      recentDiscoveries.push({
        id: planet.id,
        name: planet.name,
        hostStar: planet.hostStar,
        distLy: planet.distLy,
        earthRadii: planet.earthRadii,
        planetType: planet.planetType,
        inHabitableZone: planet.inHabitableZone,
        discYear: planet.discYear,
        discPubDate: planet.discPubDate,
        discFacility: planet.discFacility,
      });
    }
  }

  console.log(`[Sync] Loaded ${exoplanets.length} confirmed exoplanets from NASA Exoplanet Archive.`);
  return { exoplanets, recentDiscoveries };
}

/**
 * 2. Sync HYG 3D Star Catalog + IAU Proper Names + 88 3D Constellations & 12 Zodiac Star Signs
 */
async function syncStarsAndConstellations() {
  console.log('[Sync] Fetching d3-celestial Constellation Lines & HYG v40 3D Star Database...');
  const [constLinesRes, constMetaRes, hygRes] = await Promise.all([
    fetchWithTimeout('https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json', 25000),
    fetchWithTimeout('https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.json', 25000),
    fetchWithTimeout('https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v40.csv.gz', 60000),
  ]);

  const constLinesGeo = await constLinesRes.json();
  const constMetaGeo = await constMetaRes.json();

  // Map constellation metadata by 3-letter IAU code
  const constMetaById = new Map();
  for (const feat of constMetaGeo.features || []) {
    const id = feat.id || feat.properties?.desig;
    const coords = feat.geometry?.coordinates || [0, 0];
    const raDeg = ((coords[0] % 360) + 360) % 360;
    const decDeg = coords[1] || 0;
    constMetaById.set(id, {
      id,
      name: feat.properties?.en || feat.properties?.name || id,
      latinName: feat.properties?.name || id,
      genitive: feat.properties?.gen || '',
      raDeg: round(raDeg, 2),
      decDeg: round(decDeg, 2),
    });
  }

  // Stream gunzip HYG CSV
  const gunzip = zlib.createGunzip();
  const nodeStream = Readable.fromWeb(hygRes.body).pipe(gunzip);
  const rl = readline.createInterface({ input: nodeStream, crlfDelay: Infinity });

  let headers = null;
  const stars = [];

  for await (const line of rl) {
    if (!headers) {
      headers = line.split(',').map((h) => h.replace(/^"|"$/g, '').trim());
      continue;
    }
    // Simple fast CSV splitter (HYG fields rarely contain embedded commas)
    const cols = line.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
    const get = (colName) => cols[headers.indexOf(colName)];

    const proper = get('proper');
    if (proper === 'Sol') continue; // Sun is rendered via high-precision Solar System ephemeris

    const mag = parseFloat(get('mag'));
    const distPc = parseFloat(get('dist'));
    if (!Number.isFinite(mag) || !Number.isFinite(distPc) || distPc <= 0) continue;

    // Keep naked-eye stars (mag <= 6.0), solar neighborhood (< 20 pc / 65 ly), or named IAU stars
    const hasName = Boolean(proper && proper.length > 0);
    if (mag > 6.0 && distPc > 20.0 && !hasName) continue;

    // Clamp unresolved Hipparcos extreme parallax outliers (100000 pc sentinel in HYG) to realistic visual distance
    const cleanDistPc = distPc >= 99000 ? 450 : distPc;
    const distLy = cleanDistPc * PC_TO_LY;

    const raHours = parseFloat(get('ra'));
    const decDeg = parseFloat(get('dec'));
    const raDeg = raHours * 15.0;
    const posLy = raDecDistToThreeLy(raDeg, decDeg, distLy);

    const ci = parseFloat(get('ci'));
    const spect = get('spect') || '';
    const lum = parseFloat(get('lum')) || 1.0;
    const teff = estimateStarTempFromSpectOrBV(spect, Number.isFinite(ci) ? ci : null);
    const specClass = spectralClassLetter(spect, teff);

    // Stefan-Boltzmann radius R/Rsun = sqrt(L/Lsun) * (5778 / Teff)^2
    const solarRadii = Math.max(0.08, Math.min(1600, Math.sqrt(Math.max(0.00001, lum)) * Math.pow(5778 / teff, 2)));
    const hzInnerAu = Math.sqrt(Math.max(0.00001, lum) / 1.1);
    const hzOuterAu = Math.sqrt(Math.max(0.00001, lum) / 0.53);

    const bf = get('bf') || '';
    const con = get('con') || '';
    const hip = get('hip') || '';
    const gl = get('gl') || '';

    const displayName = proper || bf || (gl ? `Gliese ${gl}` : hip ? `HIP ${hip}` : `HYG ${get('id')}`);

    stars.push({
      id: `star-${hip ? `hip-${hip}` : get('id')}`,
      hip: hip ? Number(hip) : null,
      name: displayName,
      proper: proper || null,
      bayerFlamsteed: bf || null,
      constellation: con || null,
      ra: round(raDeg, 4),
      dec: round(decDeg, 4),
      distLy: round(distLy, 2),
      posLy,
      mag: round(mag, 2),
      bv: Number.isFinite(ci) ? round(ci, 2) : 0.65,
      teff,
      specClass,
      spectFull: spect || specClass,
      lumSolar: round(lum, 5),
      solarRadii: round(solarRadii, 2),
      hzInnerAu: round(hzInnerAu, 3),
      hzOuterAu: round(hzOuterAu, 3),
    });
  }

  // Build spatial lookup on unit celestial sphere so every constellation line vertex snaps to its true 3D star!
  const brightStarsUnit = stars
    .filter((s) => s.mag <= 6.2)
    .map((s) => {
      const len = Math.hypot(s.posLy[0], s.posLy[1], s.posLy[2]) || 1;
      return {
        star: s,
        ux: s.posLy[0] / len,
        uy: s.posLy[1] / len,
        uz: s.posLy[2] / len,
      };
    });

  const findNearest3DStar = (raDeg, decDeg) => {
    const [ux, uy, uz] = raDecDistToThreeLy(raDeg, decDeg, 1.0);
    let best = null;
    let bestDot = 0.9996; // within ~1.6 degrees
    for (const item of brightStarsUnit) {
      const dot = ux * item.ux + uy * item.uy + uz * item.uz;
      if (dot > bestDot) {
        bestDot = dot;
        best = item.star;
      }
    }
    if (best) return best.posLy;
    // Fallback to 220 ly shell if faint uncataloged vertex
    return raDecDistToThreeLy(raDeg, decDeg, 220);
  };

  const zodiacMap = new Map(ZODIAC_STAR_SIGNS.map((z) => [z.id, z]));
  const constellations = [];

  for (const feat of constLinesGeo.features || []) {
    const id = feat.id;
    const meta = constMetaById.get(id) || { id, name: id, latinName: id, raDeg: 0, decDeg: 0 };
    const zodiac = zodiacMap.get(id) || null;
    const multiLines = feat.geometry?.coordinates || [];

    const segments3D = [];
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let count = 0;

    for (const polyline of multiLines) {
      const pts3D = polyline.map(([lon, lat]) => {
        const ra = ((lon % 360) + 360) % 360;
        const p = findNearest3DStar(ra, lat);
        sumX += p[0];
        sumY += p[1];
        sumZ += p[2];
        count += 1;
        return p;
      });
      if (pts3D.length >= 2) segments3D.push(pts3D);
    }

    const labelPosLy =
      count > 0
        ? [round(sumX / count, 2), round(sumY / count, 2), round(sumZ / count, 2)]
        : raDecDistToThreeLy(meta.raDeg, meta.decDeg, 200);

    constellations.push({
      id,
      name: meta.name,
      latinName: meta.latinName,
      raDeg: meta.raDeg,
      decDeg: meta.decDeg,
      isZodiac: Boolean(zodiac),
      zodiac,
      labelPosLy,
      segments3D,
    });
  }

  console.log(`[Sync] Built ${stars.length} 3D HYG stars and ${constellations.length} 3D constellations (${ZODIAC_STAR_SIGNS.length} Zodiac star signs).`);
  return { stars, constellations };
}

/**
 * 3. Sync Live Active Satellites from CelesTrak GP API
 */
async function syncSatellites() {
  console.log('[Sync] Fetching live NORAD GP/OMM satellite elements from CelesTrak...');
  const groups = [
    { group: 'stations', category: 'Space Station', limit: 35 },
    { group: 'science', category: 'Space Telescope / Science', limit: 80 },
    { group: 'visual', category: 'Bright LEO Satellite', limit: 120 },
    { group: 'gps-ops', category: 'GPS / Navigation (MEO)', limit: 40 },
    { group: 'weather', category: 'Weather / Earth Obs', limit: 60 },
    { group: 'starlink', category: 'Starlink Megaconstellation', limit: 180 },
  ];

  const seenNorad = new Set();
  const satellites = [];

  for (const g of groups) {
    try {
      const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${g.group}&FORMAT=json`;
      const res = await fetchWithTimeout(url, 20000);
      const list = await res.json();
      let added = 0;
      for (const omm of list) {
        if (added >= g.limit) break;
        const noradId = omm.NORAD_CAT_ID;
        if (!noradId || seenNorad.has(noradId)) continue;
        seenNorad.add(noradId);
        satellites.push({
          id: `sat-${noradId}`,
          noradId,
          name: (omm.OBJECT_NAME || `SAT ${noradId}`).trim(),
          objectId: omm.OBJECT_ID || '',
          category: g.category,
          omm,
        });
        added += 1;
      }
    } catch (err) {
      console.warn(`[Sync] Warning fetching CelesTrak group ${g.group}: ${err.message}`);
    }
  }

  console.log(`[Sync] Cached ${satellites.length} live orbital satellites.`);
  return satellites;
}

/**
 * 4. Sync Deep-Sky Objects (Messier / Bright NGC + Curated Landmarks)
 */
export async function syncDeepSpace() {
  console.log('[Sync] Building Deep-Space Nebulae, Black Holes, Galaxies & Observable Universe Landmarks...');
  const landmarks = CURATED_COSMIC_LANDMARKS.map((item) => ({
    ...item,
    posLy: item.distLy > 0 ? raDecDistToThreeLy(item.raDeg, item.decDeg, item.distLy) : [0, 0, 0],
  }));

  // Also pull bright Messier / NGC objects from d3-celestial for comprehensive sky coverage
  const extraDsos = [];
  try {
    const res = await fetchWithTimeout(
      'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/dsos.bright.json',
      20000
    );
    const geo = await res.json();
    const curatedNames = new Set(landmarks.map((l) => l.name.toLowerCase()));

    for (const feat of geo.features || []) {
      const props = feat.properties || {};
      const coords = feat.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;
      const name = props.name || props.desig;
      if (!name) continue;
      if ([...curatedNames].some((cn) => cn.includes(name.toLowerCase()))) continue;

      const raDeg = ((coords[0] % 360) + 360) % 360;
      const decDeg = coords[1];
      const dsoType = props.type || 'oc';

      // Realistic typical distance by DSO morphological class when catalog only stores angular mag
      let estDistLy = 3800;
      let category = 'cluster';
      let subType = 'Star Cluster';
      if (dsoType === 'g' || dsoType === 's') {
        estDistLy = 18000000 + ((Math.abs(Math.sin(raDeg)) * 45000000) | 0);
        category = 'galaxy';
        subType = 'Spiral / Elliptical Galaxy';
      } else if (dsoType === 'gc') {
        estDistLy = 16000 + ((Math.abs(Math.cos(raDeg)) * 28000) | 0);
        category = 'cluster';
        subType = 'Globular Star Cluster';
      } else if (dsoType === 'pn' || dsoType === 'en' || dsoType === 'rn' || dsoType === 'snr') {
        estDistLy = 1800 + ((Math.abs(Math.sin(decDeg)) * 5500) | 0);
        category = 'nebula';
        subType = dsoType === 'pn' ? 'Planetary Nebula' : dsoType === 'snr' ? 'Supernova Remnant' : 'Emission Nebula';
      }

      extraDsos.push({
        id: `dso-${(props.desig || name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name: props.name && props.desig && props.name !== props.desig ? `${props.name} (${props.desig})` : name,
        category,
        subType,
        raDeg: round(raDeg, 3),
        decDeg: round(decDeg, 3),
        distLy: estDistLy,
        posLy: raDecDistToThreeLy(raDeg, decDeg, estDistLy),
        mag: props.mag ?? 7.5,
        sizeLy: category === 'galaxy' ? 65000 : category === 'cluster' ? 95 : 14,
        color: category === 'galaxy' ? '#c4b5fd' : category === 'nebula' ? '#38bdf8' : '#fde68a',
        nasaQuery: `${props.name || props.desig}`,
        heroImage: null,
        renderAs25D: false,
        funFacts: [
          `${subType} cataloged as ${props.desig || name} at Right Ascension ${round(raDeg, 2)}°, Declination ${round(decDeg, 2)}°.`,
          `Apparent visual magnitude ${props.mag ?? '—'}, observable in deep-sky surveys from Earth’s hemisphere.`,
        ],
      });
    }
  } catch (err) {
    console.warn(`[Sync] Warning fetching bright DSOs: ${err.message}`);
  }

  return {
    solarSystem: SOLAR_SYSTEM_BODIES,
    zodiacSigns: ZODIAC_STAR_SIGNS,
    landmarks,
    catalogDsos: extraDsos.slice(0, 140),
  };
}

/**
 * Master Sync Orchestrator — Writes optimized JSON bundles to public/data/ and tracks freshness
 */
export async function runUniverseSync({ force = false, syncIntervalHours = DEFAULT_SYNC_INTERVAL_HOURS } = {}) {
  await ensureDirs();
  const manifestPath = path.join(PUBLIC_DATA_DIR, 'syncManifest.json');
  const existingManifest = await readJsonSafe(manifestPath, null);

  if (!force && existingManifest?.lastSyncedAt) {
    const ageMs = Date.now() - new Date(existingManifest.lastSyncedAt).getTime();
    const thresholdMs = syncIntervalHours * 3600 * 1000;
    if (ageMs < thresholdMs) {
      return { skipped: true, manifest: existingManifest };
    }
  }

  const startedAt = Date.now();
  const errors = [];

  // 1. Exoplanets
  let exoplanetBundle = null;
  try {
    exoplanetBundle = await syncExoplanets(existingManifest);
    await fsp.writeFile(
      path.join(PUBLIC_DATA_DIR, 'exoplanets.json'),
      JSON.stringify(exoplanetBundle.exoplanets)
    );
  } catch (err) {
    console.error('[Sync] Exoplanet sync error:', err.message);
    errors.push(`NASA Exoplanet Archive: ${err.message}`);
  }

  // 2. Stars & Constellations
  let starBundle = null;
  try {
    starBundle = await syncStarsAndConstellations();
    await fsp.writeFile(path.join(PUBLIC_DATA_DIR, 'stars.json'), JSON.stringify(starBundle.stars));
    await fsp.writeFile(
      path.join(PUBLIC_DATA_DIR, 'constellations.json'),
      JSON.stringify(starBundle.constellations)
    );
  } catch (err) {
    console.error('[Sync] Star/Constellation sync error:', err.message);
    errors.push(`HYG / Constellations: ${err.message}`);
  }

  // 3. Satellites
  let satellites = null;
  try {
    satellites = await syncSatellites();
    if (satellites.length > 0) {
      await fsp.writeFile(path.join(PUBLIC_DATA_DIR, 'satellites.json'), JSON.stringify(satellites));
    }
  } catch (err) {
    console.error('[Sync] Satellite sync error:', err.message);
    errors.push(`CelesTrak: ${err.message}`);
  }

  // 4. Deep Space & Landmarks
  let deepSpace = null;
  try {
    deepSpace = await syncDeepSpace();
    await fsp.writeFile(path.join(PUBLIC_DATA_DIR, 'deepSpace.json'), JSON.stringify(deepSpace));
  } catch (err) {
    console.error('[Sync] DeepSpace sync error:', err.message);
    errors.push(`Deep Space Catalog: ${err.message}`);
  }

  // Read counts from disk in case a partial source fell back to existing file
  const finalExo = exoplanetBundle?.exoplanets || (await readJsonSafe(path.join(PUBLIC_DATA_DIR, 'exoplanets.json'), []));
  const finalStars = starBundle?.stars || (await readJsonSafe(path.join(PUBLIC_DATA_DIR, 'stars.json'), []));
  const finalConst = starBundle?.constellations || (await readJsonSafe(path.join(PUBLIC_DATA_DIR, 'constellations.json'), []));
  const finalSats = (satellites?.length ? satellites : null) || (await readJsonSafe(path.join(PUBLIC_DATA_DIR, 'satellites.json'), []));
  const finalDeep = deepSpace || (await readJsonSafe(path.join(PUBLIC_DATA_DIR, 'deepSpace.json'), { landmarks: [], catalogDsos: [] }));

  const nowIso = new Date().toISOString();
  const nextIso = new Date(Date.now() + syncIntervalHours * 3600 * 1000).toISOString();

  const manifest = {
    version: '1.0.0',
    lastSyncedAt: nowIso,
    nextScheduledSyncAt: nextIso,
    syncIntervalHours,
    durationMs: Date.now() - startedAt,
    counts: {
      exoplanets: finalExo.length,
      stars: finalStars.length,
      constellations: finalConst.length,
      zodiacSigns: ZODIAC_STAR_SIGNS.length,
      satellites: finalSats.length,
      solarSystemBodies: SOLAR_SYSTEM_BODIES.length,
      deepSpaceObjects: (finalDeep.landmarks?.length || 0) + (finalDeep.catalogDsos?.length || 0),
    },
    sources: [
      {
        name: 'NASA Exoplanet Archive (Caltech/IPAC TAP)',
        url: 'https://exoplanetarchive.ipac.caltech.edu/',
        status: errors.some((e) => e.includes('Exoplanet')) ? 'cached' : 'live',
      },
      {
        name: 'NORAD / CelesTrak GP Orbital Elements',
        url: 'https://celestrak.org/',
        status: errors.some((e) => e.includes('CelesTrak')) ? 'cached' : 'live',
      },
      {
        name: 'Astronexus HYG v40 (Hipparcos + Gaia + Gliese + Yale Bright Star)',
        url: 'https://github.com/astronexus/HYG-Database',
        status: errors.some((e) => e.includes('HYG')) ? 'cached' : 'live',
      },
      {
        name: 'IAU 88 Constellations & OpenNGC / Messier Deep-Sky Catalog',
        url: 'https://www.iau.org/public/themes/constellations/',
        status: 'live',
      },
      {
        name: 'NASA Image & Video Library + JWST / Hubble / EHT Archives',
        url: 'https://images.nasa.gov/',
        status: 'live',
      },
    ],
    recentDiscoveries: exoplanetBundle?.recentDiscoveries || existingManifest?.recentDiscoveries || [],
    knownExoplanetNames: finalExo.slice(0, 600).map((p) => p.name),
    warnings: errors,
  };

  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[Sync] Completed in ${manifest.durationMs}ms! Counts:`, manifest.counts);
  return { skipped: false, manifest };
}

// Allow standalone CLI execution via `npm run sync-data`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runUniverseSync({ force: true })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
