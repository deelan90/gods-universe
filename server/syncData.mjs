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
 * Parse sexagesimal Right Ascension (HH:MM:SS.s) -> degrees [0, 360)
 */
function parseSexagesimalRaDeg(raStr) {
  if (!raStr) return null;
  const parts = raStr.trim().split(':').map(Number);
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return null;
  const hours = parts[0] + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600;
  return ((hours * 15) % 360 + 360) % 360;
}

/**
 * Parse sexagesimal Declination (±DD:MM:SS.s) -> degrees [-90, +90]
 */
function parseSexagesimalDecDeg(decStr) {
  if (!decStr) return null;
  const s = decStr.trim();
  const sign = s.startsWith('-') ? -1 : 1;
  const clean = s.replace(/^[+-]/, '');
  const parts = clean.split(':').map(Number);
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return null;
  const deg = parts[0] + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600;
  return sign * deg;
}

function formatOpenNgcCatalogCode(rawCode) {
  const m = rawCode.match(/^([A-Za-z]+)0*(\d+[A-Za-z]?)$/);
  if (!m) return rawCode;
  return `${m[1]} ${m[2]}`;
}

/**
 * Exact astrophysically measured TRGB / Cepheid / Maser / Gaia distances (in Light-Years)
 * for famous Messier, Caldwell, Local Group & Milky Way deep-sky landmarks
 */
const KNOWN_DSO_DIST_LY = {
  // Milky Way & Magellanic Nebulae
  B033: 1375, // Horsehead Nebula
  NGC2024: 1350, // Flame Nebula
  NGC1977: 1500, // Running Man Nebula
  NGC2068: 1350, // M78 Reflection Nebula
  NGC2237: 5200, // Rosette Nebula
  NGC2238: 5200,
  NGC2239: 5200,
  NGC2244: 5200, // Rosette Cluster
  NGC2246: 5200,
  NGC2264: 2300, // Cone Nebula / Christmas Tree Cluster
  NGC6523: 4100, // M8 Lagoon Nebula
  NGC6514: 4100, // M20 Trifid Nebula
  NGC6618: 5500, // M17 Omega / Swan Nebula
  NGC6853: 1360, // M27 Dumbbell Nebula
  NGC3587: 2030, // M97 Owl Nebula
  NGC0650: 2500, // M76 Little Dumbbell Nebula
  NGC7000: 2590, // North America Nebula
  IC5070: 2590, // Pelican Nebula
  NGC6960: 2400, // Western Veil Nebula (Witch's Broom)
  NGC6992: 2400, // Eastern Veil Nebula
  NGC6995: 2400, // Network Nebula (Cygnus Loop)
  NGC6888: 5000, // Crescent Nebula
  NGC7635: 7100, // Bubble Nebula
  NGC6543: 3300, // Cat's Eye Nebula
  NGC2392: 4200, // Eskimo Nebula
  NGC6302: 3400, // Butterfly / Bug Nebula
  NGC7009: 3900, // Saturn Nebula
  NGC3242: 4300, // Ghost of Jupiter Nebula
  NGC2440: 4000,
  NGC6826: 5200, // Blinking Planetary
  NGC1499: 1000, // California Nebula
  IC1805: 7500, // Heart Nebula
  IC1848: 7500, // Soul Nebula
  IC2118: 900, // Witch Head Nebula
  IC1396: 2400, // Elephant's Trunk Nebula
  NGC6334: 5500, // Cat's Paw Nebula
  NGC6357: 5500, // Lobster Nebula
  NGC2359: 11900, // Thor's Helmet
  NGC2070: 160000, // Tarantula Nebula (30 Doradus in LMC)
  NGC0346: 200000, // SMC Star-Forming HII Region
  // Star Clusters
  Mel022: 444, // M45 Pleiades
  Mel025: 153, // Hyades
  NGC2632: 577, // M44 Beehive Cluster
  NGC0869: 7500, // h Persei (Double Cluster)
  NGC0884: 7500, // Chi Persei (Double Cluster)
  NGC6205: 22200, // M13 Great Hercules Globular Cluster
  NGC7078: 33600, // M15
  NGC7089: 37500, // M2
  NGC5272: 33900, // M3
  NGC6121: 7200, // M4
  NGC5904: 24500, // M5
  NGC6341: 26700, // M92
  NGC5139: 17090, // Omega Centauri
  NGC0104: 14500, // 47 Tucanae
  NGC4755: 6440, // Jewel Box Cluster
  // Local Group, Messier & Benchmark Galaxies
  NGC0292: 200000, // Small Magellanic Cloud (SMC)
  NGC6822: 1630000, // Barnard's Galaxy
  IC0010: 2200000, // IC 10 Starburst Galaxy
  IC1613: 2380000,
  NGC0147: 2530000,
  NGC0185: 2050000,
  NGC0205: 2690000, // M110
  NGC0221: 2490000, // M32
  NGC0300: 6070000,
  NGC0055: 6500000,
  NGC0253: 11400000, // Sculptor Galaxy
  NGC0247: 11100000,
  NGC2403: 10400000,
  NGC3031: 11800000, // M81 Bode's Galaxy
  NGC3034: 12000000, // M82 Cigar Galaxy
  NGC5236: 15200000, // M83 Southern Pinwheel Galaxy
  NGC4945: 11700000,
  NGC4736: 16000000, // M94
  NGC4826: 17300000, // M64 Black Eye Galaxy
  NGC5457: 20900000, // M101 Pinwheel Galaxy
  NGC4258: 23700000, // M106
  NGC5055: 29300000, // M63 Sunflower Galaxy
  NGC4631: 25000000, // Whale Galaxy
  NGC4565: 42700000, // Needle Galaxy
  NGC0628: 32000000, // M74 Phantom Galaxy
  NGC3351: 33000000, // M95
  NGC3368: 33500000, // M96
  NGC3379: 34000000, // M105
  NGC3623: 35000000, // M65 (Leo Triplet)
  NGC3627: 35500000, // M66 (Leo Triplet)
  NGC3628: 35200000, // Hamburger Galaxy (Leo Triplet)
  NGC5866: 44000000, // M102 Spindle Galaxy
  NGC4038: 45000000, // Antennae Galaxies
  NGC4039: 45000000,
  NGC1300: 61300000, // Grand-Design Barred Spiral
  NGC1365: 56000000, // Great Barred Spiral in Fornax
  NGC1068: 47000000, // M77 Cetus A Seyfert Galaxy
  // Virgo Cluster Messier Galaxies (~52–57 Mly core)
  NGC4192: 51000000, // M98
  NGC4254: 52000000, // M99
  NGC4321: 55000000, // M100
  NGC4374: 55000000, // M84
  NGC4382: 56000000, // M85
  NGC4406: 52000000, // M86
  NGC4472: 53000000, // M49
  NGC4501: 54500000, // M88
  NGC4548: 54000000, // M91
  NGC4552: 53500000, // M89
  NGC4569: 54800000, // M90
  NGC4579: 56500000, // M58
  NGC4621: 53800000, // M59
  NGC4649: 55200000, // M60
  NGC4762: 56000000,
};

const CANONICAL_DSO_NAMES = {
  NGC5457: 'Pinwheel Galaxy',
  NGC6618: 'Omega Nebula',
  NGC0650: 'Little Dumbbell Nebula',
  IC1805: 'Heart Nebula',
  IC1848: 'Soul Nebula',
  NGC2237: 'Rosette Nebula',
  NGC2070: 'Tarantula Nebula',
  NGC5139: 'Omega Centauri',
  NGC0104: '47 Tucanae',
  NGC0253: 'Sculptor Galaxy',
  NGC4038: 'Antennae Galaxies',
  NGC7635: 'Bubble Nebula',
  NGC1499: 'California Nebula',
  IC1396: "Elephant's Trunk Nebula",
  NGC2264: 'Cone Nebula',
  NGC6302: 'Butterfly Nebula',
  NGC6888: 'Crescent Nebula',
  NGC2359: "Thor's Helmet Nebula",
  NGC0628: 'Phantom Galaxy',
  NGC2024: 'Flame Nebula',
  IC5070: 'Pelican Nebula',
  NGC7000: 'North America Nebula',
  B033: 'Horsehead Nebula',
  NGC6543: "Cat's Eye Nebula",
  NGC6960: 'Western Veil Nebula',
  NGC6992: 'Eastern Veil Nebula',
};

// Catalog codes already represented with bespoke 2.5D JWST/Hubble/EHT hero cards in CURATED_COSMIC_LANDMARKS
const CURATED_SKIP_CODES = new Set([
  'NGC1952', // M1 Crab Nebula
  'NGC6611', // M16 Eagle / Pillars of Creation
  'NGC0224', // M31 Andromeda Galaxy
  'NGC0598', // M33 Triangulum Galaxy
  'NGC1976', // M42 Orion Nebula
  'NGC5194', // M51 Whirlpool Galaxy
  'NGC5195', // M51b companion
  'NGC6720', // M57 Ring Nebula
  'NGC4486', // M87 / M87*
  'NGC4594', // M104 Sombrero Galaxy
  'NGC7293', // Helix Nebula
  'NGC3372', // Carina Nebula
  'NGC3324', // Cosmic Cliffs (Carina)
  'NGC3132', // Southern Ring Nebula
  'NGC5128', // Centaurus A
  'NGC7317', // Stephan's Quintet
  'NGC7318A',
  'NGC7318B',
  'NGC7319',
  'NGC7320',
]);

/**
 * 4. Sync Deep-Sky Objects from Official OpenNGC Database (NGC + IC + Messier + Caldwell) + Curated Landmarks
 */
export async function syncDeepSpace() {
  console.log('[Sync] Building Deep-Space Galaxies, Nebulae, Star Clusters & Landmarks from OpenNGC...');
  const landmarks = CURATED_COSMIC_LANDMARKS.map((item) => ({
    ...item,
    morphCode:
      item.category === 'galaxy'
        ? item.subType.toLowerCase().includes('barred')
          ? 1
          : item.subType.toLowerCase().includes('elliptical') || item.subType.toLowerCase().includes('lenticular')
            ? 2
            : 0
        : item.category === 'nebula'
          ? item.subType.toLowerCase().includes('planetary') || item.subType.toLowerCase().includes('supernova')
            ? 4
            : 3
          : item.category === 'cluster'
            ? 5
            : 2,
    axisRatio: 0.72,
    posAngleDeg: 28,
    posLy: item.distLy > 0 ? raDecDistToThreeLy(item.raDeg, item.decDeg, item.distLy) : [0, 0, 0],
  }));

  const nebulaCandidates = [];
  const clusterCandidates = [];
  const galaxyCandidates = [];

  try {
    const [ngcRes, addRes] = await Promise.all([
      fetchWithTimeout('https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv', 40000),
      fetchWithTimeout('https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/addendum.csv', 25000),
    ]);
    const [ngcCsv, addCsv] = await Promise.all([ngcRes.text(), addRes.text()]);

    const allLines = [
      ...ngcCsv.split(/\r?\n/).slice(1),
      ...addCsv.split(/\r?\n/).slice(1),
    ];

    const seenCodes = new Set();

    for (const line of allLines) {
      if (!line || line.length < 10) continue;
      const cols = line.split(';');
      const rawCode = (cols[0] || '').trim();
      const objType = (cols[1] || '').trim();
      if (!rawCode || !objType) continue;
      if (['Dup', 'NonEx', '*', '**', 'Other'].includes(objType)) continue;
      if (CURATED_SKIP_CODES.has(rawCode) || seenCodes.has(rawCode)) continue;

      const raDeg = parseSexagesimalRaDeg(cols[2]);
      const decDeg = parseSexagesimalDecDeg(cols[3]);
      if (raDeg === null || decDeg === null) continue;

      seenCodes.add(rawCode);

      const constellation = (cols[4] || '').trim() || null;
      const majAxArcmin = parseFloat(cols[5]);
      const minAxArcmin = parseFloat(cols[6]);
      const posAngleDeg = Number.isFinite(parseFloat(cols[7])) ? Math.round(parseFloat(cols[7])) : Math.round((raDeg * 3.7) % 180);
      const bMag = parseFloat(cols[8]);
      const vMag = parseFloat(cols[9]);
      const mag = Number.isFinite(vMag) ? vMag : Number.isFinite(bMag) ? bMag - 0.5 : 11.8;
      const hubbleType = (cols[14] || '').trim();
      const paxMas = parseFloat(cols[15]);
      const radVelKms = parseFloat(cols[18]);
      const redshift = parseFloat(cols[19]);
      const messierRaw = (cols[23] || '').trim();
      const messierNum = messierRaw ? parseInt(messierRaw, 10) : null;
      const messier = messierNum && Number.isFinite(messierNum) ? `M${messierNum}` : null;
      const commonNamesRaw = (cols[28] || '').trim();
      const primaryCommon =
        CANONICAL_DSO_NAMES[rawCode] || (commonNamesRaw ? commonNamesRaw.split(',')[0].trim() : '');

      const formattedCatalog = formatOpenNgcCatalogCode(rawCode);
      let displayName = formattedCatalog;
      if (primaryCommon && messier) {
        displayName = `${primaryCommon} (${messier})`;
      } else if (primaryCommon) {
        displayName = `${primaryCommon} (${formattedCatalog})`;
      } else if (messier) {
        displayName = `${messier} (${formattedCatalog})`;
      }

      const axisRatio =
        Number.isFinite(majAxArcmin) && majAxArcmin > 0 && Number.isFinite(minAxArcmin) && minAxArcmin > 0
          ? round(Math.max(0.18, Math.min(1.0, minAxArcmin / majAxArcmin)), 2)
          : 0.72;

      let category = 'galaxy';
      let subType = 'Spiral Galaxy';
      let morphCode = 0;
      let color = '#93c5fd';
      let distLy = KNOWN_DSO_DIST_LY[rawCode] || null;

      const isGalaxy = ['G', 'GPair', 'GTrpl', 'GGroup'].includes(objType);
      const isNebula = ['PN', 'HII', 'EmN', 'Neb', 'Cl+N', 'RfN', 'DrkN', 'SNR'].includes(objType);

      // Deterministic pseudo-scatter in [0, 1) from sky coordinates so fallback distances never form artificial shells
      const skyHash = Math.abs(Math.sin(raDeg * 12.9898 + decDeg * 78.233) * 43758.5453) % 1;

      if (isGalaxy) {
        category = 'galaxy';
        const hUp = hubbleType.toUpperCase();
        if (hUp.startsWith('SB') || hUp.startsWith('SAB')) {
          morphCode = 1; // Barred Spiral
          subType = `Barred Spiral Galaxy${hubbleType ? ` (${hubbleType})` : ''}`;
          color = '#7dd3fc';
        } else if (hUp.startsWith('E') || hUp.startsWith('S0')) {
          morphCode = 2; // Elliptical / Lenticular
          subType = hUp.startsWith('S0')
            ? `Lenticular Galaxy (${hubbleType})`
            : `Elliptical Galaxy${hubbleType ? ` (${hubbleType})` : ''}`;
          color = '#fcd34d';
        } else if (hUp.startsWith('I')) {
          morphCode = 0;
          subType = `Irregular Galaxy (${hubbleType})`;
          color = '#a5b4fc';
        } else {
          morphCode = 0; // Grand-design / Flocculent Spiral
          subType =
            objType === 'GPair'
              ? 'Interacting Galaxy Pair'
              : objType === 'GTrpl' || objType === 'GGroup'
                ? 'Compact Galaxy Group'
                : `Spiral Galaxy${hubbleType ? ` (${hubbleType})` : ''}`;
          color = skyHash > 0.45 ? '#60a5fa' : '#c4b5fd';
        }

        if (!distLy) {
          let z = Number.isFinite(redshift) ? redshift : Number.isFinite(radVelKms) ? radVelKms / 299792.458 : null;
          const inVirgoCore = raDeg >= 178 && raDeg <= 195 && decDeg >= 2 && decDeg <= 21;
          if (z !== null && z > 0.0012) {
            // Hubble-Lemaitre relativistic comoving distance (H0 = 69.8 km/s/Mpc)
            const dMpc = ((299792.458 * z) / 69.8) * (1 + 0.225 * z);
            distLy = Math.round(dMpc * 3_261_563.78);
            // Clamp Virgo infall peculiar velocities to realistic Virgo supercluster depth
            if (inVirgoCore && distLy < 85_000_000) {
              distLy = Math.round(49_000_000 + skyHash * 11_000_000);
            }
          } else if (inVirgoCore) {
            distLy = Math.round(50_500_000 + skyHash * 8_500_000);
          } else {
            // Tully-Fisher / Faber-Jackson apparent magnitude fallback (m - M) with M_V ~ -20.6
            const clampedMag = Math.max(8.2, Math.min(14.5, mag));
            const estMpc = Math.pow(10, (clampedMag + 20.6 - 25) / 5);
            distLy = Math.round(Math.max(9_000_000, Math.min(450_000_000, estMpc * 3_261_563.78 * (0.85 + 0.3 * skyHash))));
          }
        }
      } else if (isNebula) {
        category = 'nebula';
        if (objType === 'PN') {
          morphCode = 4;
          subType = 'Planetary Nebula';
          color = '#2dd4bf';
        } else if (objType === 'SNR') {
          morphCode = 4;
          subType = 'Supernova Remnant';
          color = '#38bdf8';
        } else if (objType === 'RfN') {
          morphCode = 3;
          subType = 'Reflection Nebula';
          color = '#60a5fa';
        } else if (objType === 'DrkN') {
          morphCode = 3;
          subType = 'Dark Molecular Nebula';
          color = '#fb7185';
        } else if (objType === 'Cl+N') {
          morphCode = 3;
          subType = 'Star-Forming Nebula & Cluster';
          color = '#f472b6';
        } else {
          morphCode = 3;
          subType = 'HII Emission Nebula';
          color = '#f43f5e';
        }

        if (!distLy) {
          if (Number.isFinite(paxMas) && paxMas > 0.08 && paxMas < 25) {
            distLy = Math.round((1000 / paxMas) * PC_TO_LY);
          } else {
            // Typical physical size scaling inside Milky Way disk (PN ~1.2 ly, HII/Neb ~18 ly, SNR ~35 ly)
            const typPhysLy = objType === 'PN' ? 1.15 : objType === 'SNR' ? 32 : 16;
            const angRad = Math.max(0.25, Number.isFinite(majAxArcmin) ? majAxArcmin : 3.5) * (Math.PI / (180 * 60));
            const rawEst = typPhysLy / Math.tan(angRad);
            distLy = Math.round(Math.max(420, Math.min(28_000, rawEst * (0.75 + 0.5 * skyHash))));
          }
        }
      } else {
        // GCl, OCl, *Ass
        category = 'cluster';
        morphCode = 5;
        if (objType === 'GCl') {
          subType = 'Globular Star Cluster';
          color = '#fcd34d';
        } else if (objType === '*Ass') {
          subType = 'OB Stellar Association';
          color = '#93c5fd';
        } else {
          subType = 'Open Star Cluster';
          color = '#fde68a';
        }

        if (!distLy) {
          if (Number.isFinite(paxMas) && paxMas > 0.06 && paxMas < 30) {
            distLy = Math.round((1000 / paxMas) * PC_TO_LY);
          } else if (objType === 'GCl') {
            distLy = Math.round(14_000 + skyHash * 38_000);
          } else {
            distLy = Math.round(950 + skyHash * 7_500);
          }
        }
      }

      // Compute true physical diameter in Light-Years from angular MajAx (arcmin) & 3D distance
      let sizeLy;
      if (Number.isFinite(majAxArcmin) && majAxArcmin > 0) {
        const angRad = (majAxArcmin / 60) * DEG_TO_RAD;
        sizeLy = distLy * Math.tan(angRad);
      } else {
        sizeLy = category === 'galaxy' ? 65_000 : category === 'cluster' ? 45 : 14;
      }

      if (category === 'galaxy') {
        sizeLy = Math.max(8_000, Math.min(380_000, Math.round(sizeLy)));
      } else if (category === 'cluster') {
        sizeLy = round(Math.max(6, Math.min(320, sizeLy)), 1);
      } else {
        sizeLy = round(Math.max(0.8, Math.min(450, sizeLy)), 2);
      }

      // Priority ranking so all Messiers, named highlights & brightest deep-sky objects are always retained
      const priorityScore =
        (primaryCommon ? 1000 : 0) +
        (messier ? 800 : 0) +
        (KNOWN_DSO_DIST_LY[rawCode] ? 500 : 0) +
        (20 - Math.min(20, mag)) * 18 +
        (Number.isFinite(majAxArcmin) ? Math.min(60, majAxArcmin) * 1.5 : 0);

      const record = {
        id: `dso-${rawCode.toLowerCase()}`,
        name: displayName,
        category,
        subType,
        raDeg: round(raDeg, 4),
        decDeg: round(decDeg, 4),
        distLy,
        posLy: raDecDistToThreeLy(raDeg, decDeg, distLy),
        sizeLy,
        mag: round(mag, 2),
        color,
        morphCode,
        hubbleType: hubbleType || undefined,
        axisRatio,
        posAngleDeg,
        messier,
        constellation,
        nasaQuery: primaryCommon || messier || formattedCatalog,
        heroImage: null,
        renderAs25D: false,
        funFacts: [],
        _score: priorityScore,
      };

      if (isNebula) nebulaCandidates.push(record);
      else if (isGalaxy) galaxyCandidates.push(record);
      else clusterCandidates.push(record);
    }
  } catch (err) {
    console.warn(`[Sync] Warning fetching OpenNGC catalog: ${err.message}`);
  }

  nebulaCandidates.sort((a, b) => b._score - a._score);
  clusterCandidates.sort((a, b) => b._score - a._score);
  galaxyCandidates.sort((a, b) => b._score - a._score);

  const selectedDsos = [
    ...nebulaCandidates, // Keep ALL ~425 real OpenNGC nebulae!
    ...clusterCandidates.slice(0, 350), // Top 350 globular & open star clusters
    ...galaxyCandidates.slice(0, 1850), // Top 1,850 redshift-mapped 3D galaxies
  ].map(({ _score, ...clean }) => clean);

  console.log(
    `[Sync] OpenNGC 3D Deep-Space Catalog built: ${nebulaCandidates.length} Nebulae, ${Math.min(
      350,
      clusterCandidates.length
    )} Star Clusters, ${Math.min(1850, galaxyCandidates.length)} 3D Galaxies (${
      landmarks.length + selectedDsos.length
    } total deep-space objects).`
  );

  return {
    solarSystem: SOLAR_SYSTEM_BODIES,
    zodiacSigns: ZODIAC_STAR_SIGNS,
    landmarks,
    catalogDsos: selectedDsos,
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
