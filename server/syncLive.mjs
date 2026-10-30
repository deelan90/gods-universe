/**
 * Lightweight "live" sync — safe to run every few hours.
 *
 *  1. JPL Horizons state vectors for deep-space spacecraft  -> public/data/spacecraft.json
 *  2. Curiosity REMS daily weather (Gale Crater, Mars)       -> public/data/planetWeather.json
 *  3. Fresh CelesTrak elements for crewed space stations     -> patched into public/data/satellites.json
 *
 * Every step is independent: if one source is down, the others still update and the
 * existing file is kept, so the site never loses data.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DATA_DIR = path.join(path.resolve(__dirname, '..'), 'public', 'data');

const UA = 'GodsUniverseObservatory/1.1 (public science data sync; github.com/deelan90/gods-universe)';

// Keep in sync with SPACECRAFT_FLEET in src/utils/spacecraft.ts
export const HORIZONS_FLEET = [
  { id: 'voyager-1', horizonsId: '-31' },
  { id: 'voyager-2', horizonsId: '-32' },
  { id: 'new-horizons', horizonsId: '-98' },
  { id: 'pioneer-10', horizonsId: '-23' },
  { id: 'pioneer-11', horizonsId: '-24' },
  { id: 'parker-solar-probe', horizonsId: '-96' },
  { id: 'solar-orbiter', horizonsId: '-144' },
  { id: 'jwst', horizonsId: '-170' },
  { id: 'euclid', horizonsId: '-680' },
  { id: 'bepicolombo', horizonsId: '-121' },
  { id: 'hera', horizonsId: '-91' },
  { id: 'psyche', horizonsId: '-255' },
  { id: 'lucy', horizonsId: '-49' },
  { id: 'europa-clipper', horizonsId: '-159' },
  { id: 'juice', horizonsId: '-28' },
  { id: 'juno', horizonsId: '-61' },
  { id: 'curiosity', horizonsId: '-76' },
];

const DAYS_BEFORE = 7;
const DAYS_AFTER = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

const isoDay = (d) => d.toISOString().slice(0, 10);
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/** Parse "A.D. 2026-NOV-04 01:01:09.1826" out of a Horizons coverage error */
function parseCoverageLimit(text, kind) {
  const re = new RegExp(`${kind} A\\.D\\. (\\d{4})-([A-Z]{3})-(\\d{2})`);
  const m = text.match(re);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), MONTHS[m[2]], Number(m[3])));
}

function horizonsUrl(id, start, stop) {
  const p = new URLSearchParams({
    format: 'json',
    COMMAND: `'${id}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'VECTORS'",
    CENTER: "'500@10'", // Sun centre
    START_TIME: `'${isoDay(start)}'`,
    STOP_TIME: `'${isoDay(stop)}'`,
    STEP_SIZE: "'1d'",
    VEC_TABLE: "'2'",
    REF_PLANE: "'FRAME'", // ICRF / J2000 equatorial — matches astronomy-engine's EQJ frame
    OUT_UNITS: "'AU-D'",
    CSV_FORMAT: "'YES'",
    VEC_LABELS: "'NO'",
  });
  return `https://ssd.jpl.nasa.gov/api/horizons.api?${p.toString()}`;
}

async function fetchHorizonsTrack(horizonsId, start, stop, attempt = 0) {
  const res = await fetchWithTimeout(horizonsUrl(horizonsId, start, stop));
  const json = await res.json();
  const text = json.result || json.error || '';
  if (!text.includes('$$SOE')) {
    // Shrink the window to the published coverage and retry once
    if (attempt < 2) {
      const after = parseCoverageLimit(text, 'after');
      const prior = parseCoverageLimit(text, 'prior to');
      if (after && after > start) {
        const newStop = new Date(after.getTime() - 86_400_000);
        if (newStop > start) return fetchHorizonsTrack(horizonsId, start, newStop, attempt + 1);
      }
      if (prior && prior < stop) {
        const newStart = new Date(prior.getTime() + 86_400_000);
        if (newStart < stop) return fetchHorizonsTrack(horizonsId, newStart, stop, attempt + 1);
      }
    }
    throw new Error(text.replace(/\s+/g, ' ').slice(0, 180) || 'no ephemeris');
  }
  const body = text.split('$$SOE')[1].split('$$EOE')[0];
  const rows = body
    .trim()
    .split('\n')
    .map((l) => l.split(',').map((c) => c.trim()))
    .filter((c) => c.length >= 8);
  if (rows.length === 0) throw new Error('empty table');
  const startJd = Number(rows[0][0]);
  const stepDays = rows.length > 1 ? Number(rows[1][0]) - startJd : 1;
  const samples = rows.map((c) => c.slice(2, 8).map((v) => Number(Number(v).toPrecision(11))));
  return { horizonsId, startJd, stepDays, samples };
}

export async function syncSpacecraft() {
  const now = new Date();
  const start = new Date(now.getTime() - DAYS_BEFORE * 86_400_000);
  const stop = new Date(now.getTime() + DAYS_AFTER * 86_400_000);
  const outPath = path.join(PUBLIC_DATA_DIR, 'spacecraft.json');
  const previous = await readJsonSafe(outPath, { craft: {} });

  const craft = {};
  const errors = [];
  for (const sc of HORIZONS_FLEET) {
    try {
      craft[sc.id] = await fetchHorizonsTrack(sc.horizonsId, start, stop);
      console.log(`[Live] Horizons ${sc.id}: ${craft[sc.id].samples.length} daily vectors`);
    } catch (err) {
      errors.push(`${sc.id}: ${err.message}`);
      if (previous.craft?.[sc.id]) craft[sc.id] = previous.craft[sc.id];
      console.warn(`[Live] Horizons ${sc.id} failed — keeping previous track. ${err.message}`);
    }
    await sleep(350); // be polite to JPL
  }

  const out = {
    generatedAt: now.toISOString(),
    source: 'NASA/JPL Horizons (https://ssd.jpl.nasa.gov/horizons/) — heliocentric ICRF state vectors',
    craft,
    warnings: errors,
  };
  await fsp.writeFile(outPath, JSON.stringify(out));
  return { count: Object.keys(craft).length, errors };
}

/** Curiosity REMS: keep the latest few weeks only (the full feed is ~1.7 MB) */
export async function syncPlanetWeather() {
  const outPath = path.join(PUBLIC_DATA_DIR, 'planetWeather.json');
  const previous = await readJsonSafe(outPath, {});
  const num = (v) => {
    const n = Number(v);
    return v === '--' || v === '' || v == null || !Number.isFinite(n) ? null : n;
  };
  try {
    const res = await fetchWithTimeout('https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json', 45000);
    const json = await res.json();
    const sols = (json.soles || []).slice(0, 21).map((s) => ({
      sol: num(s.sol),
      earthDate: s.terrestrial_date,
      ls: num(s.ls),
      season: s.season,
      minTempC: num(s.min_temp),
      maxTempC: num(s.max_temp),
      minGroundTempC: num(s.min_gts_temp),
      maxGroundTempC: num(s.max_gts_temp),
      pressurePa: num(s.pressure),
      sky: s.atmo_opacity && s.atmo_opacity !== '--' ? s.atmo_opacity : null,
      uv: s.local_uv_irradiance_index && s.local_uv_irradiance_index !== '--' ? s.local_uv_irradiance_index : null,
      sunrise: s.sunrise && s.sunrise !== '--' ? s.sunrise : null,
      sunset: s.sunset && s.sunset !== '--' ? s.sunset : null,
    }));
    const out = {
      generatedAt: new Date().toISOString(),
      mars: {
        source: 'NASA/JPL-Caltech & Centro de Astrobiología (CAB) — Curiosity REMS',
        sourceUrl: 'https://mars.nasa.gov/msl/weather/',
        station: 'Curiosity rover, Gale Crater (4.6°S, 137.4°E)',
        sols,
      },
    };
    await fsp.writeFile(outPath, JSON.stringify(out));
    console.log(`[Live] Mars weather: latest sol ${sols[0]?.sol} (${sols[0]?.earthDate})`);
    return { ok: true };
  } catch (err) {
    console.warn(`[Live] Mars weather failed — keeping previous file. ${err.message}`);
    if (!previous.mars) await fsp.writeFile(outPath, JSON.stringify({ generatedAt: null, mars: null }));
    return { ok: false, error: err.message };
  }
}

/** Patch only the crewed-station records with fresh elements (stations re-boost often) */
export async function syncStationElements() {
  const satPath = path.join(PUBLIC_DATA_DIR, 'satellites.json');
  const sats = await readJsonSafe(satPath, null);
  if (!Array.isArray(sats)) return { ok: false };
  try {
    const res = await fetchWithTimeout('https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json', 20000);
    const list = await res.json();
    const byId = new Map(list.map((o) => [o.NORAD_CAT_ID, o]));
    let patched = 0;
    for (const s of sats) {
      const fresh = byId.get(s.noradId);
      if (fresh) {
        s.omm = fresh;
        patched++;
      }
    }
    // Add any new crewed station that is not in our list yet (e.g. a newly launched commercial station)
    const known = new Set(sats.map((s) => s.noradId));
    for (const o of list) {
      const name = String(o.OBJECT_NAME || '').toUpperCase();
      if (!known.has(o.NORAD_CAT_ID) && /HAVEN|AXIOM|STARLAB|ORBITAL REEF|TIANGONG|BHARATIYA/.test(name)) {
        sats.unshift({
          id: `sat-${o.NORAD_CAT_ID}`,
          noradId: o.NORAD_CAT_ID,
          name: String(o.OBJECT_NAME).trim(),
          objectId: o.OBJECT_ID || '',
          category: 'Space Station',
          omm: o,
        });
        patched++;
      }
    }
    await fsp.writeFile(satPath, JSON.stringify(sats));
    console.log(`[Live] Station elements refreshed: ${patched} records`);
    return { ok: true, patched };
  } catch (err) {
    console.warn(`[Live] CelesTrak stations failed. ${err.message}`);
    return { ok: false, error: err.message };
  }
}

export async function runLiveSync() {
  await fsp.mkdir(PUBLIC_DATA_DIR, { recursive: true });
  const [spacecraft, weather, stations] = [
    await syncSpacecraft(),
    await syncPlanetWeather(),
    await syncStationElements(),
  ];
  return { spacecraft, weather, stations };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLiveSync()
    .then((r) => {
      console.log('[Live] Done', JSON.stringify(r));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(0); // never fail the deploy because a live feed is down
    });
}
