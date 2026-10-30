import * as Astronomy from 'astronomy-engine';

// Local copies (astronomy.ts imports this module, so importing back would create a cycle)
const KM_PER_AU = 149_597_870.7;
const SPEED_OF_LIGHT_KMS = 299_792.458;

/**
 * Deep-space spacecraft fleet.
 *
 * Positions come from three sources, in order of preference:
 *  1. `public/data/spacecraft.json` — daily JPL Horizons state vectors written by `npm run sync-live`
 *     (Hermite-interpolated between samples, so they are accurate to well under 1,000 km).
 *  2. A built-in Horizons state vector (epoch 2026-10-30) propagated with a two-body Kepler solver
 *     around the Sun. Excellent for coasting probes (Voyagers, New Horizons, Pioneers) for years.
 *  3. A parent-body anchor (Mars rovers, Jupiter orbiter) or the Sun–Earth L2 point (JWST, Euclid).
 *
 * All vectors are heliocentric, ICRF / J2000 equatorial, in AU and AU/day.
 */

export type SpacecraftStatus = 'active' | 'silent' | 'uncertain';
export type SpacecraftGroup = 'interstellar' | 'cruise' | 'orbiting' | 'observatory' | 'surface';

type Fallback =
  | { kind: 'kepler'; epochJd: number; state: [number, number, number, number, number, number] }
  | { kind: 'parent'; body: 'mars' | 'jupiter' }
  | { kind: 'l2' };

export interface SpacecraftInfo {
  id: string;
  name: string;
  shortName: string;
  horizonsId: string | null;
  agency: string;
  launched: string;
  status: SpacecraftStatus;
  group: SpacecraftGroup;
  where: string;
  color: string;
  wikiTitle: string;
  nasaQuery: string;
  funFacts: string[];
  fallback: Fallback;
}

const SEED_JD = 2461343.5; // 2026-10-30 00:00 TDB — JPL Horizons state vectors

export const SPACECRAFT_FLEET: SpacecraftInfo[] = [
  {
    id: 'voyager-1',
    name: 'Voyager 1',
    shortName: 'Voyager 1',
    horizonsId: '-31',
    agency: 'NASA / JPL',
    launched: '1977-09-05',
    status: 'active',
    group: 'interstellar',
    where: 'Interstellar space, beyond the heliopause',
    color: '#38bdf8',
    wikiTitle: 'Voyager_1',
    nasaQuery: 'Voyager 1 spacecraft',
    funFacts: [
      'The most distant human-made object. It crossed the heliopause into interstellar space in August 2012.',
      'Carries the Golden Record — sounds, music and images chosen to represent life on Earth.',
      'Its radio signal, about 20 watts at launch power levels, reaches Earth billions of times weaker than a watch battery.',
    ],
    fallback: {
      kind: 'kepler',
      epochJd: SEED_JD,
      state: [-32.197689201, -165.18682173, 36.461051176, -0.0011953189964, -0.0094711833202, 0.0020827073613],
    },
  },
  {
    id: 'voyager-2',
    name: 'Voyager 2',
    shortName: 'Voyager 2',
    horizonsId: '-32',
    agency: 'NASA / JPL',
    launched: '1977-08-20',
    status: 'active',
    group: 'interstellar',
    where: 'Interstellar space, heading south of the ecliptic',
    color: '#60a5fa',
    wikiTitle: 'Voyager_2',
    nasaQuery: 'Voyager 2 spacecraft',
    funFacts: [
      'The only spacecraft to have visited Uranus (1986) and Neptune (1989).',
      'Crossed into interstellar space in November 2018, six years after Voyager 1.',
      'Only the Deep Space Network dish in Canberra, Australia can still talk to it, because it travels south of the ecliptic.',
    ],
    fallback: {
      kind: 'kepler',
      epochJd: SEED_JD,
      state: [39.960674532, -61.147854568, -124.48861634, 0.0024276567634, -0.0023495162569, -0.0081421979998],
    },
  },
  {
    id: 'new-horizons',
    name: 'New Horizons',
    shortName: 'New Horizons',
    horizonsId: '-98',
    agency: 'NASA / APL',
    launched: '2006-01-19',
    status: 'active',
    group: 'interstellar',
    where: 'Kuiper Belt, outbound',
    color: '#a78bfa',
    wikiTitle: 'New_Horizons',
    nasaQuery: 'New Horizons spacecraft Pluto',
    funFacts: [
      'Flew past Pluto in July 2015 and returned the first close-up images of its heart-shaped glacier.',
      'Visited Arrokoth in 2019 — the most distant object ever explored up close.',
      'Left Earth faster than any spacecraft before it, passing the Moon’s orbit in about nine hours.',
    ],
    fallback: {
      kind: 'kepler',
      epochJd: SEED_JD,
      state: [20.936062868, -58.243266071, -22.746046444, 0.003064959614, -0.0067293878768, -0.0026082160942],
    },
  },
  {
    id: 'pioneer-10',
    name: 'Pioneer 10',
    shortName: 'Pioneer 10',
    horizonsId: '-23',
    agency: 'NASA / Ames',
    launched: '1972-03-03',
    status: 'silent',
    group: 'interstellar',
    where: 'Outer heliosphere — last signal received in 2003',
    color: '#94a3b8',
    wikiTitle: 'Pioneer_10',
    nasaQuery: 'Pioneer 10 spacecraft',
    funFacts: [
      'First spacecraft to cross the asteroid belt and the first to fly past Jupiter (1973).',
      'Carries the Pioneer plaque, showing where Earth is and who sent it.',
      'Still coasting toward the star Aldebaran, which it would reach in about two million years.',
    ],
    fallback: {
      kind: 'kepler',
      epochJd: SEED_JD,
      state: [24.091616531, 125.38759062, 62.430474314, 0.00070863716461, 0.0060980376747, 0.0030234041623],
    },
  },
  {
    id: 'pioneer-11',
    name: 'Pioneer 11',
    shortName: 'Pioneer 11',
    horizonsId: '-24',
    agency: 'NASA / Ames',
    launched: '1973-04-06',
    status: 'silent',
    group: 'interstellar',
    where: 'Outer heliosphere — last contact in 1995',
    color: '#94a3b8',
    wikiTitle: 'Pioneer_11',
    nasaQuery: 'Pioneer 11 spacecraft Saturn',
    funFacts: [
      'First spacecraft to fly past Saturn (1979).',
      'Heading toward the constellation Aquila.',
    ],
    fallback: {
      kind: 'kepler',
      epochJd: SEED_JD,
      state: [29.154629302, -113.0283644, -18.191272732, 0.0023317691724, -0.0059079323122, -0.0010310288362],
    },
  },
  {
    id: 'parker-solar-probe',
    name: 'Parker Solar Probe',
    shortName: 'Parker',
    horizonsId: '-96',
    agency: 'NASA / APL',
    launched: '2018-08-12',
    status: 'active',
    group: 'cruise',
    where: 'Looping through the Sun’s outer atmosphere',
    color: '#fb923c',
    wikiTitle: 'Parker_Solar_Probe',
    nasaQuery: 'Parker Solar Probe',
    funFacts: [
      'The fastest human-made object: about 192 km/s at its closest approaches to the Sun.',
      'Flies within about 6.1 million km of the Sun’s surface, behind a carbon-composite heat shield.',
    ],
    fallback: {
      kind: 'kepler',
      epochJd: SEED_JD,
      state: [0.61326862938, -0.29176814802, -0.17006999723, -0.0014572134053, 0.0081925234349, 0.0037795732448],
    },
  },
  {
    id: 'solar-orbiter',
    name: 'Solar Orbiter',
    shortName: 'Solar Orbiter',
    horizonsId: '-144',
    agency: 'ESA / NASA',
    launched: '2020-02-10',
    status: 'active',
    group: 'cruise',
    where: 'Inclined orbit around the Sun',
    color: '#fbbf24',
    wikiTitle: 'Solar_Orbiter',
    nasaQuery: 'Solar Orbiter',
    funFacts: [
      'Uses Venus flybys to tilt its orbit and take the first-ever pictures of the Sun’s poles.',
    ],
    fallback: {
      kind: 'kepler',
      epochJd: SEED_JD,
      state: [0.163889878, 0.713416015, 0.498469317, -0.0121644315, 0.00481541705, 0.00122195723],
    },
  },
  {
    id: 'jwst',
    name: 'James Webb Space Telescope (JWST)',
    shortName: 'JWST',
    horizonsId: '-170',
    agency: 'NASA / ESA / CSA',
    launched: '2021-12-25',
    status: 'active',
    group: 'observatory',
    where: 'Halo orbit around Sun–Earth L2, ~1.5 million km from Earth',
    color: '#fbbf24',
    wikiTitle: 'James_Webb_Space_Telescope',
    nasaQuery: 'James Webb Space Telescope',
    funFacts: [
      'Orbits the Sun–Earth L2 point, about four times farther away than the Moon.',
      'Its 6.5-metre gold-coated mirror sees infrared light from galaxies formed a few hundred million years after the Big Bang.',
      'A five-layer sunshield the size of a tennis court keeps its instruments below −223 °C.',
    ],
    fallback: { kind: 'l2' },
  },
  {
    id: 'euclid',
    name: 'Euclid',
    shortName: 'Euclid',
    horizonsId: '-680',
    agency: 'ESA',
    launched: '2023-07-01',
    status: 'active',
    group: 'observatory',
    where: 'Halo orbit around Sun–Earth L2',
    color: '#c4b5fd',
    wikiTitle: 'Euclid_(spacecraft)',
    nasaQuery: 'Euclid telescope',
    funFacts: ['Mapping billions of galaxies to measure dark matter and dark energy.'],
    fallback: { kind: 'l2' },
  },
  {
    id: 'bepicolombo',
    name: 'BepiColombo',
    shortName: 'BepiColombo',
    horizonsId: '-121',
    agency: 'ESA / JAXA',
    launched: '2018-10-20',
    status: 'active',
    group: 'cruise',
    where: 'Arriving at Mercury (orbit insertion planned for late 2026)',
    color: '#d6d3d1',
    wikiTitle: 'BepiColombo',
    nasaQuery: 'BepiColombo Mercury',
    funFacts: ['Two orbiters stacked together — one European, one Japanese — that separate at Mercury.'],
    fallback: {
      kind: 'kepler',
      epochJd: SEED_JD,
      state: [0.335251721, 0.0690261421, 0.002197073, -0.0106693833, 0.0249531444, 0.0144832137],
    },
  },
  {
    id: 'hera',
    name: 'Hera',
    shortName: 'Hera',
    horizonsId: '-91',
    agency: 'ESA',
    launched: '2024-10-07',
    status: 'active',
    group: 'cruise',
    where: 'En route to the Didymos–Dimorphos asteroid pair',
    color: '#f472b6',
    wikiTitle: 'Hera_(space_mission)',
    nasaQuery: 'Hera mission Didymos',
    funFacts: ['Inspecting the crater left by NASA’s DART impact — the first planetary-defence test.'],
    fallback: {
      kind: 'kepler',
      epochJd: SEED_JD,
      state: [0.995120974, -0.628324349, -0.347880336, 0.0054742611, 0.0151452417, 0.00653964437],
    },
  },
  {
    id: 'psyche',
    name: 'Psyche',
    shortName: 'Psyche',
    horizonsId: '-255',
    agency: 'NASA / JPL',
    launched: '2023-10-13',
    status: 'active',
    group: 'cruise',
    where: 'En route to metal-rich asteroid 16 Psyche (arrival 2029)',
    color: '#a3e635',
    wikiTitle: 'Psyche_(spacecraft)',
    nasaQuery: 'Psyche spacecraft asteroid',
    funFacts: ['Powered by electric Hall-effect thrusters that glow blue.'],
    fallback: {
      kind: 'kepler',
      epochJd: SEED_JD,
      state: [-0.515096836, 1.60066692, 0.622526619, -0.0137997054, 0.0000840196665, 0.000286521975],
    },
  },
  {
    id: 'lucy',
    name: 'Lucy',
    shortName: 'Lucy',
    horizonsId: '-49',
    agency: 'NASA / SwRI',
    launched: '2021-10-16',
    status: 'active',
    group: 'cruise',
    where: 'Heading for Jupiter’s Trojan asteroids (2027)',
    color: '#facc15',
    wikiTitle: 'Lucy_(spacecraft)',
    nasaQuery: 'Lucy spacecraft Trojan',
    funFacts: ['Will visit more asteroids than any mission before it.'],
    fallback: {
      kind: 'kepler',
      epochJd: SEED_JD,
      state: [-3.68519746, -3.21656307, -1.65505448, 0.000944838102, -0.00468337746, -0.00188698768],
    },
  },
  {
    id: 'europa-clipper',
    name: 'Europa Clipper',
    shortName: 'Europa Clipper',
    horizonsId: '-159',
    agency: 'NASA / JPL',
    launched: '2024-10-14',
    status: 'active',
    group: 'cruise',
    where: 'En route to Jupiter (arrival 2030)',
    color: '#67e8f9',
    wikiTitle: 'Europa_Clipper',
    nasaQuery: 'Europa Clipper',
    funFacts: ['NASA’s largest planetary spacecraft, built to check whether Europa’s hidden ocean could support life.'],
    fallback: {
      kind: 'kepler',
      epochJd: SEED_JD,
      state: [0.77085715252, 0.32116407506, 0.11500249545, -0.0079906010112, 0.019322153337, 0.0089361274699],
    },
  },
  {
    id: 'juice',
    name: 'JUICE',
    shortName: 'JUICE',
    horizonsId: '-28',
    agency: 'ESA',
    launched: '2023-04-14',
    status: 'active',
    group: 'cruise',
    where: 'En route to Jupiter’s icy moons (arrival 2031)',
    color: '#5eead4',
    wikiTitle: 'Jupiter_Icy_Moons_Explorer',
    nasaQuery: 'JUICE Jupiter Icy Moons Explorer',
    funFacts: ['Will become the first spacecraft to orbit a moon other than our own — Ganymede.'],
    fallback: {
      kind: 'kepler',
      epochJd: SEED_JD,
      state: [0.594920688, 0.571464439, 0.247709087, -0.0176419462, 0.0127936925, 0.00554572929],
    },
  },
  {
    id: 'juno',
    name: 'Juno',
    shortName: 'Juno',
    horizonsId: '-61',
    agency: 'NASA / JPL',
    launched: '2011-08-05',
    status: 'uncertain',
    group: 'orbiting',
    where: 'Polar orbit around Jupiter (mission status unclear since late 2025)',
    color: '#fdba74',
    wikiTitle: 'Juno_(spacecraft)',
    nasaQuery: 'Juno spacecraft Jupiter',
    funFacts: ['First solar-powered spacecraft to operate at Jupiter.'],
    fallback: { kind: 'parent', body: 'jupiter' },
  },
  {
    id: 'curiosity',
    name: 'Curiosity Rover',
    shortName: 'Curiosity',
    horizonsId: '-76',
    agency: 'NASA / JPL',
    launched: '2011-11-26',
    status: 'active',
    group: 'surface',
    where: 'Mount Sharp, Gale Crater, Mars',
    color: '#f97316',
    wikiTitle: 'Curiosity_(rover)',
    nasaQuery: 'Curiosity rover Mars',
    funFacts: ['Its weather station (REMS) feeds the live Mars weather in this app.'],
    fallback: { kind: 'parent', body: 'mars' },
  },
  {
    id: 'perseverance',
    name: 'Perseverance Rover',
    shortName: 'Perseverance',
    horizonsId: null,
    agency: 'NASA / JPL',
    launched: '2020-07-30',
    status: 'active',
    group: 'surface',
    where: 'Jezero Crater rim, Mars',
    color: '#fb7185',
    wikiTitle: 'Perseverance_(rover)',
    nasaQuery: 'Perseverance rover Mars',
    funFacts: ['Collecting rock cores for a possible future sample return to Earth.'],
    fallback: { kind: 'parent', body: 'mars' },
  },
];

export const SPACECRAFT_BY_ID = new Map(SPACECRAFT_FLEET.map((s) => [s.id, s]));

/* ---------------------------------------------------------------- ephemeris file */

export interface SpacecraftEphemerisTrack {
  horizonsId: string;
  startJd: number;
  stepDays: number;
  /** [x, y, z, vx, vy, vz] in AU and AU/day */
  samples: number[][];
}

export interface SpacecraftEphemerisFile {
  generatedAt: string;
  source: string;
  craft: Record<string, SpacecraftEphemerisTrack>;
}

export interface SpacecraftState {
  posAu: [number, number, number];
  velAuDay: [number, number, number] | null;
  source: 'jpl-horizons' | 'kepler-model' | 'parent-body' | 'l2-model';
}

const GM_SUN_AU3_DAY2 = 2.9591220828559115e-4;

export function dateToJd(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

function stumpffC(z: number) {
  if (z > 1e-8) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-8) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 0.5 - z / 24;
}
function stumpffS(z: number) {
  if (z > 1e-8) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-8) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120;
}

/** Two-body propagation (universal variables) — works for ellipses and escape trajectories alike */
export function keplerPropagate(
  state: readonly number[],
  dtDays: number
): { pos: [number, number, number]; vel: [number, number, number] } {
  const mu = GM_SUN_AU3_DAY2;
  const [x, y, z, vx, vy, vz] = state;
  if (Math.abs(dtDays) < 1e-9) return { pos: [x, y, z], vel: [vx, vy, vz] };
  const r0 = Math.hypot(x, y, z);
  const v0sq = vx * vx + vy * vy + vz * vz;
  const vr0 = (x * vx + y * vy + z * vz) / r0;
  const alpha = 2 / r0 - v0sq / mu;
  const sqrtMu = Math.sqrt(mu);

  let chi = sqrtMu * Math.abs(alpha) * dtDays;
  if (!Number.isFinite(chi) || chi === 0) chi = (sqrtMu * dtDays) / r0;
  for (let i = 0; i < 60; i++) {
    const zz = alpha * chi * chi;
    const C = stumpffC(zz);
    const S = stumpffS(zz);
    const F =
      ((r0 * vr0) / sqrtMu) * chi * chi * C + (1 - alpha * r0) * chi * chi * chi * S + r0 * chi - sqrtMu * dtDays;
    const dF = ((r0 * vr0) / sqrtMu) * chi * (1 - zz * S) + (1 - alpha * r0) * chi * chi * C + r0;
    const step = F / dF;
    chi -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  const zz = alpha * chi * chi;
  const C = stumpffC(zz);
  const S = stumpffS(zz);
  const f = 1 - (chi * chi * C) / r0;
  const g = dtDays - (chi * chi * chi * S) / sqrtMu;
  const pos: [number, number, number] = [f * x + g * vx, f * y + g * vy, f * z + g * vz];
  const r = Math.hypot(pos[0], pos[1], pos[2]);
  const fdot = (sqrtMu / (r * r0)) * (alpha * chi * chi * chi * S - chi);
  const gdot = 1 - (chi * chi * C) / r;
  return {
    pos,
    vel: [fdot * x + gdot * vx, fdot * y + gdot * vy, fdot * z + gdot * vz],
  };
}

function helioStateOf(body: Astronomy.Body, date: Date) {
  const s = Astronomy.HelioState(body, date);
  return {
    pos: [s.x, s.y, s.z] as [number, number, number],
    vel: [s.vx, s.vy, s.vz] as [number, number, number],
  };
}

function l2State(date: Date): SpacecraftState {
  const earth = helioStateOf(Astronomy.Body.Earth, date);
  const k = 1.01005;
  return {
    posAu: [earth.pos[0] * k, earth.pos[1] * k, earth.pos[2] * k],
    velAuDay: [earth.vel[0] * k, earth.vel[1] * k, earth.vel[2] * k],
    source: 'l2-model',
  };
}

function interpolateTrack(track: SpacecraftEphemerisTrack, jd: number): SpacecraftState | null {
  const n = track.samples.length;
  if (n === 0) return null;
  const u = (jd - track.startJd) / track.stepDays;
  if (u < 0 || u > n - 1) return null;
  const i = Math.min(n - 2, Math.floor(u));
  if (n === 1) {
    const s = track.samples[0];
    return { posAu: [s[0], s[1], s[2]], velAuDay: [s[3], s[4], s[5]], source: 'jpl-horizons' };
  }
  const t = u - i;
  const a = track.samples[i];
  const b = track.samples[i + 1];
  const h = track.stepDays;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const pos: [number, number, number] = [0, 0, 0];
  const vel: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    pos[k] = h00 * a[k] + h10 * h * a[k + 3] + h01 * b[k] + h11 * h * b[k + 3];
    vel[k] = a[k + 3] + (b[k + 3] - a[k + 3]) * t;
  }
  return { posAu: pos, velAuDay: vel, source: 'jpl-horizons' };
}

/** Heliocentric J2000 equatorial state of a spacecraft at `date` (AU, AU/day). */
export function computeSpacecraftState(
  info: SpacecraftInfo,
  date: Date,
  ephem: SpacecraftEphemerisFile | null
): SpacecraftState {
  const jd = dateToJd(date);
  const track = ephem?.craft?.[info.id];

  if (track && track.samples.length > 0) {
    const inside = interpolateTrack(track, jd);
    if (inside) return inside;
  }

  const fb = info.fallback;
  if (fb.kind === 'l2') return l2State(date);
  if (fb.kind === 'parent') {
    const body = fb.body === 'mars' ? Astronomy.Body.Mars : Astronomy.Body.Jupiter;
    const p = helioStateOf(body, date);
    // If Horizons gave us a recent sample, keep the small offset from the parent body
    return { posAu: p.pos, velAuDay: p.vel, source: 'parent-body' };
  }

  // Coasting probe: propagate from the nearest Horizons sample (or the built-in seed vector)
  let baseState: readonly number[] = fb.state;
  let baseJd = fb.epochJd;
  if (track && track.samples.length > 0) {
    const lastIdx = track.samples.length - 1;
    const endJd = track.startJd + lastIdx * track.stepDays;
    if (jd > endJd) {
      baseState = track.samples[lastIdx];
      baseJd = endJd;
    } else {
      baseState = track.samples[0];
      baseJd = track.startJd;
    }
  }
  const prop = keplerPropagate(baseState, jd - baseJd);
  return { posAu: prop.pos, velAuDay: prop.vel, source: 'kepler-model' };
}

/* ---------------------------------------------------------------- telemetry helpers */

export interface SpacecraftTelemetry {
  info: SpacecraftInfo;
  state: SpacecraftState;
  distSunAu: number;
  distEarthAu: number;
  distEarthKm: number;
  lightTimeSec: number;
  speedSunKms: number | null;
}

const AU_PER_DAY_TO_KMS = KM_PER_AU / 86_400;

export function computeSpacecraftTelemetry(
  info: SpacecraftInfo,
  date: Date,
  ephem: SpacecraftEphemerisFile | null,
  earthPosAu?: [number, number, number]
): SpacecraftTelemetry {
  const state = computeSpacecraftState(info, date, ephem);
  const e = earthPosAu || (() => {
    const v = Astronomy.HelioVector(Astronomy.Body.Earth, date);
    return [v.x, v.y, v.z] as [number, number, number];
  })();
  const [x, y, z] = state.posAu;
  let distEarthAu = Math.hypot(x - e[0], y - e[1], z - e[2]);
  // Mars rovers sit on the surface: distance is the Earth–Mars distance
  if (info.group === 'surface') distEarthAu = Math.max(distEarthAu, 0);
  const distEarthKm = distEarthAu * KM_PER_AU;
  const v = state.velAuDay;
  return {
    info,
    state,
    distSunAu: Math.hypot(x, y, z),
    distEarthAu,
    distEarthKm,
    lightTimeSec: distEarthKm / SPEED_OF_LIGHT_KMS,
    speedSunKms: v ? Math.hypot(v[0], v[1], v[2]) * AU_PER_DAY_TO_KMS : null,
  };
}

export function formatLightTime(sec: number): string {
  if (sec < 1) return `${(sec * 1000).toFixed(0)} ms`;
  if (sec < 60) return `${sec.toFixed(1)} s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h === 0) return `${m} min ${s.toString().padStart(2, '0')} s`;
  return `${h} h ${m.toString().padStart(2, '0')} min`;
}

export function formatAuKm(au: number): { primary: string; secondary: string } {
  const km = au * KM_PER_AU;
  const primary =
    au >= 10
      ? `${au.toFixed(2)} AU`
      : au >= 0.05
        ? `${au.toFixed(3)} AU`
        : `${Math.round(km).toLocaleString()} km`;
  const secondary =
    km >= 1e9
      ? `${(km / 1e9).toFixed(2)} billion km`
      : km >= 1e6
        ? `${(km / 1e6).toFixed(1)} million km`
        : `${(au * 1000).toFixed(2)} mAU`;
  return { primary, secondary };
}
