import * as satellite from 'satellite.js';
import * as Astronomy from 'astronomy-engine';
import type { SatelliteRecord } from '../types/universe';

/**
 * Crewed space-station tracking: live latitude/longitude, altitude, speed, sunlight and ground track.
 * Elements come from the synced satellites.json and are refreshed straight from CelesTrak in the
 * browser when they are more than a few hours old (CelesTrak allows cross-origin requests).
 */

export interface StationDef {
  key: string;
  name: string;
  flag: string;
  crewNote: string;
  color: string;
}

const KNOWN_STATIONS: Record<number, StationDef> = {
  25544: {
    key: 'iss',
    name: 'International Space Station',
    flag: 'USA · Russia · Europe · Japan · Canada',
    crewNote: 'Crewed continuously since November 2000',
    color: '#fde047',
  },
  48274: {
    key: 'tiangong',
    name: 'Tiangong (China Space Station)',
    flag: 'China',
    crewNote: 'Crewed by rotating Shenzhou crews since 2021',
    color: '#f87171',
  },
};

const OTHER_STATION_NAME = /HAVEN|AXIOM|STARLAB|ORBITAL REEF|BHARATIYA/i;

export interface TrackedStation {
  def: StationDef;
  record: SatelliteRecord;
  satrec: satellite.SatRec;
}

export function pickStations(records: SatelliteRecord[]): TrackedStation[] {
  const out: TrackedStation[] = [];
  for (const rec of records) {
    let def = KNOWN_STATIONS[rec.noradId];
    if (!def && OTHER_STATION_NAME.test(rec.name)) {
      def = {
        key: `sat-${rec.noradId}`,
        name: rec.name,
        flag: 'Commercial',
        crewNote: 'Commercial space station',
        color: '#a78bfa',
      };
    }
    if (!def) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const satrec = satellite.json2satrec(rec.omm as any);
      if (satrec && !satrec.error) out.push({ def, record: rec, satrec });
    } catch {
      // skip malformed elements
    }
  }
  return out;
}

export interface StationFix {
  latDeg: number;
  lonDeg: number;
  altKm: number;
  speedKms: number;
  sunlit: boolean;
  elementAgeHours: number;
}

const EARTH_RADIUS_KM = 6371;

function sunUnitVectorEci(date: Date): [number, number, number] {
  const v = Astronomy.GeoVector(Astronomy.Body.Sun, date, false);
  const r = Math.hypot(v.x, v.y, v.z);
  return [v.x / r, v.y / r, v.z / r];
}

export function stationFix(st: TrackedStation, date: Date): StationFix | null {
  const pv = satellite.propagate(st.satrec, date);
  if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
  const pos = pv.position;
  const gmst = satellite.gstime(date);
  const geo = satellite.eciToGeodetic(pos, gmst);
  let speedKms = 7.66;
  if (pv.velocity && typeof pv.velocity !== 'boolean') {
    speedKms = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z);
  }
  // Cylindrical Earth-shadow test
  const s = sunUnitVectorEci(date);
  const along = pos.x * s[0] + pos.y * s[1] + pos.z * s[2];
  const perp = Math.hypot(pos.x - along * s[0], pos.y - along * s[1], pos.z - along * s[2]);
  const sunlit = along > 0 || perp > EARTH_RADIUS_KM;

  const epochMs = epochToMs(st.satrec);
  return {
    latDeg: satellite.degreesLat(geo.latitude),
    lonDeg: satellite.degreesLong(geo.longitude),
    altKm: geo.height,
    speedKms,
    sunlit,
    elementAgeHours: (date.getTime() - epochMs) / 3_600_000,
  };
}

function epochToMs(satrec: satellite.SatRec): number {
  // jdsatepoch (+ fraction) is a Julian date
  const jd = satrec.jdsatepoch + ((satrec as unknown as { jdsatepochF?: number }).jdsatepochF || 0);
  return (jd - 2_440_587.5) * 86_400_000;
}

/** Ground track as SVG polyline segments in the 360×180 equirectangular map space */
export function groundTrackSegments(st: TrackedStation, date: Date, minutesBack = 45, minutesAhead = 90) {
  const past: string[] = [];
  const future: string[] = [];
  let cur: string[] = [];
  let prevX: number | null = null;
  let bucket: 'past' | 'future' = 'past';
  const flush = () => {
    if (cur.length > 1) (bucket === 'past' ? past : future).push(cur.join(' '));
    cur = [];
  };
  for (let m = -minutesBack; m <= minutesAhead; m += 1) {
    const t = new Date(date.getTime() + m * 60_000);
    const pv = satellite.propagate(st.satrec, t);
    if (!pv || !pv.position || typeof pv.position === 'boolean') continue;
    const geo = satellite.eciToGeodetic(pv.position, satellite.gstime(t));
    const x = satellite.degreesLong(geo.longitude) + 180;
    const y = 90 - satellite.degreesLat(geo.latitude);
    const nextBucket = m <= 0 ? 'past' : 'future';
    if (nextBucket !== bucket) {
      cur.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      flush();
      bucket = nextBucket;
    }
    if (prevX !== null && Math.abs(x - prevX) > 180) flush();
    cur.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    prevX = x;
  }
  flush();
  return { past, future };
}

export function formatLatLon(lat: number, lon: number) {
  const la = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
  const lo = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
  return `${la}, ${lo}`;
}

/* ---------------------------------------------------------------- live element refresh */

const CACHE_KEY = 'gu-station-elements-v1';
const CACHE_TTL_MS = 2 * 3_600_000;

/**
 * Fetch fresh station elements from CelesTrak (at most once every 2 hours per browser).
 * Returns null if the synced elements are already fresh or the request fails.
 */
export async function fetchFreshStationElements(current: SatelliteRecord[]): Promise<SatelliteRecord[] | null> {
  const iss = current.find((r) => r.noradId === 25544);
  const epochStr = iss?.omm?.EPOCH as string | undefined;
  const ageH = epochStr ? (Date.now() - Date.parse(`${epochStr}Z`)) / 3_600_000 : 999;
  if (ageH < 6) return null;

  let list: Record<string, unknown>[] | null = null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as { at: number; list: Record<string, unknown>[] };
      if (Date.now() - cached.at < CACHE_TTL_MS) list = cached.list;
    }
  } catch {
    // storage unavailable
  }

  if (!list) {
    try {
      const res = await fetch('https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json');
      if (!res.ok) return null;
      list = (await res.json()) as Record<string, unknown>[];
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), list }));
      } catch {
        // ignore quota errors
      }
    } catch {
      return null;
    }
  }

  const byId = new Map(list.map((o) => [Number(o.NORAD_CAT_ID), o]));
  const out: SatelliteRecord[] = [];
  for (const r of current) {
    const fresh = byId.get(r.noradId);
    if (fresh) out.push({ ...r, omm: fresh });
  }
  // Pick up newly launched commercial stations
  const known = new Set(current.map((r) => r.noradId));
  for (const o of list) {
    const id = Number(o.NORAD_CAT_ID);
    const name = String(o.OBJECT_NAME || '');
    if (!known.has(id) && OTHER_STATION_NAME.test(name)) {
      out.push({ id: `sat-${id}`, noradId: id, name, objectId: String(o.OBJECT_ID || ''), category: 'Space Station', omm: o });
    }
  }
  return out.length ? out : null;
}
