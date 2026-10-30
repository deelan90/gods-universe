import * as Astronomy from 'astronomy-engine';

/**
 * "Weather on other worlds today".
 *
 * Measured data:  Curiosity REMS daily reports (Mars) via planetWeather.json, and NOAA SWPC
 *                 real-time space weather (the Sun's "weather" at Earth), fetched live.
 * Computed today: Mars season, sol number and local time; each world's distance from the Sun,
 *                 sunlight strength and signal delay from Earth.
 * Typical values: everything else, clearly labelled as typical rather than measured.
 */

/* ---------------------------------------------------------------- Mars clock */

const DEG = Math.PI / 180;

function jdTT(date: Date) {
  // UTC -> TT: +69.184 s (leap seconds as of 2017, no new ones announced)
  return date.getTime() / 86_400_000 + 2_440_587.5 + 69.184 / 86_400;
}

/** Allison & McEwen (2000) Mars24 algorithm — solar longitude Ls, Mars Sol Date, Coordinated Mars Time */
export function marsClock(date: Date) {
  const jd = jdTT(date);
  const dt = jd - 2_451_545.0;
  const M = (19.3871 + 0.52402073 * dt) * DEG;
  const alphaFMS = 270.3871 + 0.524038496 * dt;
  const pbs = [
    [0.0071, 2.2353, 49.409],
    [0.0057, 2.7543, 168.173],
    [0.0039, 1.1177, 191.837],
    [0.0037, 15.7866, 21.736],
    [0.0021, 2.1354, 15.704],
    [0.002, 2.4694, 95.528],
    [0.0018, 32.8493, 49.095],
  ].reduce((sum, [A, tau, phi]) => sum + A * Math.cos(((0.985626 * dt) / tau + phi) * DEG), 0);
  const nuMinusM =
    (10.691 + 3.0e-7 * dt) * Math.sin(M) +
    0.623 * Math.sin(2 * M) +
    0.05 * Math.sin(3 * M) +
    0.005 * Math.sin(4 * M) +
    0.0005 * Math.sin(5 * M) +
    pbs;
  const ls = (((alphaFMS + nuMinusM) % 360) + 360) % 360;
  // Equation of time (degrees) for local true solar time
  const eotDeg =
    2.861 * Math.sin(2 * ls * DEG) - 0.071 * Math.sin(4 * ls * DEG) + 0.002 * Math.sin(6 * ls * DEG) - nuMinusM;
  const msd = (jd - 2_405_522.0028779) / 1.0274912517;
  const mtcHours = (((msd % 1) + 1) % 1) * 24;
  return { ls, msd, mtcHours, eotHours: eotDeg / 15 };
}

/** Local true solar time (hours) at an east longitude on Mars */
export function marsLocalSolarTime(date: Date, eastLonDeg: number) {
  const { mtcHours, eotHours } = marsClock(date);
  return (((mtcHours + eastLonDeg / 15 + eotHours) % 24) + 24) % 24;
}

export function marsSeason(ls: number) {
  const north = ls < 90 ? 'spring' : ls < 180 ? 'summer' : ls < 270 ? 'autumn' : 'winter';
  const south = ls < 90 ? 'autumn' : ls < 180 ? 'winter' : ls < 270 ? 'spring' : 'summer';
  const dustSeason = ls >= 180 && ls <= 330;
  return { north, south, dustSeason };
}

export function formatClock(hours: number) {
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/* ---------------------------------------------------------------- worlds */

export interface WorldCard {
  id: string;
  name: string;
  emoji: string;
  color: string;
  body: Astronomy.Body | null;
  headline: string;
  temp: string;
  pressure: string;
  wind: string;
  sky: string;
  forecast: string;
}

export const WORLDS: WorldCard[] = [
  {
    id: 'mercury',
    name: 'Mercury',
    emoji: '☿',
    color: '#a8a29e',
    body: Astronomy.Body.Mercury,
    headline: 'Scorching days, freezing nights',
    temp: '430 °C day · −180 °C night',
    pressure: 'Almost none (exosphere)',
    wind: 'No wind — no real atmosphere',
    sky: 'Black, even at noon',
    forecast: 'Clear forever. One sunrise-to-sunrise lasts 176 Earth days.',
  },
  {
    id: 'venus',
    name: 'Venus',
    emoji: '♀',
    color: '#fbbf24',
    body: Astronomy.Body.Venus,
    headline: 'Hottest planet in the Solar System',
    temp: '465 °C, day and night',
    pressure: '92× Earth (like 900 m under the sea)',
    wind: '~360 km/h at the cloud tops, a crawl at the surface',
    sky: 'Dim orange under sulfuric-acid clouds',
    forecast: 'Overcast with acid drizzle that evaporates before it lands.',
  },
  {
    id: 'mars',
    name: 'Mars',
    emoji: '♂',
    color: '#f97316',
    body: Astronomy.Body.Mars,
    headline: 'Live from Curiosity at Gale Crater',
    temp: '−80 °C to 0 °C (typical)',
    pressure: '~0.6% of Earth',
    wind: 'Typically 10–30 km/h, gusts much higher in storms',
    sky: 'Butterscotch by day, blue sunsets',
    forecast: 'Dry and cold. Watch for dust devils in the afternoon.',
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    emoji: '♃',
    color: '#fdba74',
    body: Astronomy.Body.Jupiter,
    headline: 'A storm bigger than Earth',
    temp: '−145 °C at the cloud tops',
    pressure: 'No surface — pressure keeps rising with depth',
    wind: 'Jet streams up to ~600 km/h',
    sky: 'Ammonia-ice clouds in bands',
    forecast: 'Great Red Spot still spinning. Lightning likely in deep water clouds.',
  },
  {
    id: 'saturn',
    name: 'Saturn',
    emoji: '♄',
    color: '#fde68a',
    body: Astronomy.Body.Saturn,
    headline: 'Winds faster than a jet',
    temp: '−178 °C at the cloud tops',
    pressure: 'No surface',
    wind: 'Up to ~1,800 km/h at the equator',
    sky: 'Pale gold haze, with the rings overhead',
    forecast: 'Breezy, hexagon-shaped storm parked over the north pole.',
  },
  {
    id: 'titan',
    name: 'Titan (Saturn’s moon)',
    emoji: '🌧️',
    color: '#facc15',
    body: Astronomy.Body.Saturn,
    headline: 'The only other world with rain and lakes',
    temp: '−179 °C',
    pressure: '1.5× Earth',
    wind: 'Gentle surface breezes',
    sky: 'Thick orange smog',
    forecast: 'Chance of methane showers over the northern lakes.',
  },
  {
    id: 'uranus',
    name: 'Uranus',
    emoji: '♅',
    color: '#67e8f9',
    body: Astronomy.Body.Uranus,
    headline: 'Tipped on its side',
    temp: '−224 °C (coldest planetary atmosphere)',
    pressure: 'No surface',
    wind: 'Up to ~900 km/h',
    sky: 'Blue-green methane haze',
    forecast: 'Northern spring — the north pole is turning toward 21 years of daylight.',
  },
  {
    id: 'neptune',
    name: 'Neptune',
    emoji: '♆',
    color: '#60a5fa',
    body: Astronomy.Body.Neptune,
    headline: 'Fastest winds in the Solar System',
    temp: '−214 °C',
    pressure: 'No surface',
    wind: 'Up to ~2,100 km/h',
    sky: 'Deep blue with white methane-ice clouds',
    forecast: 'Supersonic winds. Dark storms come and go over a few years.',
  },
  {
    id: 'pluto',
    name: 'Pluto',
    emoji: '♇',
    color: '#d6d3d1',
    body: Astronomy.Body.Pluto,
    headline: 'Thin haze that snows as it freezes',
    temp: '−229 °C',
    pressure: '~1/100,000 of Earth',
    wind: 'Faint',
    sky: 'Blue haze layers, a tiny bright Sun',
    forecast: 'Getting colder: Pluto keeps moving away from the Sun until 2114.',
  },
];

export interface WorldNow {
  sunDistAu: number;
  earthDistAu: number;
  sunlightVsEarth: number;
  lightMinutes: number;
}

export function worldNow(world: WorldCard, date: Date): WorldNow | null {
  if (!world.body) return null;
  const h = Astronomy.HelioVector(world.body, date);
  const e = Astronomy.HelioVector(Astronomy.Body.Earth, date);
  const sunDistAu = Math.hypot(h.x, h.y, h.z);
  const earthDistAu = Math.hypot(h.x - e.x, h.y - e.y, h.z - e.z);
  return {
    sunDistAu,
    earthDistAu,
    sunlightVsEarth: 1 / (sunDistAu * sunDistAu),
    lightMinutes: (earthDistAu * 149_597_870.7) / 299_792.458 / 60,
  };
}

/* ---------------------------------------------------------------- data files & feeds */

export interface MarsSol {
  sol: number | null;
  earthDate: string;
  ls: number | null;
  season: string;
  minTempC: number | null;
  maxTempC: number | null;
  minGroundTempC: number | null;
  maxGroundTempC: number | null;
  pressurePa: number | null;
  sky: string | null;
  uv: string | null;
  sunrise: string | null;
  sunset: string | null;
}

export interface PlanetWeatherFile {
  generatedAt: string | null;
  mars: { source: string; sourceUrl: string; station: string; sols: MarsSol[] } | null;
}

export interface SpaceWeatherNow {
  windSpeedKms: number | null;
  windTime: string | null;
  kp: number | null;
  xrayClass: string | null;
  scales: { R: string; S: string; G: string } | null;
  fetchedAt: number;
}

function flareClass(flux: number): string {
  if (!Number.isFinite(flux) || flux <= 0) return '—';
  const classes: [string, number][] = [
    ['X', 1e-4],
    ['M', 1e-5],
    ['C', 1e-6],
    ['B', 1e-7],
    ['A', 1e-8],
  ];
  for (const [letter, base] of classes) {
    if (flux >= base) return `${letter}${(flux / base).toFixed(1)}`;
  }
  return 'A0.0';
}

/** NOAA Space Weather Prediction Center — all endpoints send CORS headers */
export async function fetchSpaceWeather(): Promise<SpaceWeatherNow> {
  const base = 'https://services.swpc.noaa.gov';
  const get = async <T,>(path: string): Promise<T | null> => {
    try {
      const r = await fetch(`${base}${path}`);
      return r.ok ? ((await r.json()) as T) : null;
    } catch {
      return null;
    }
  };
  const [wind, kp, xray, scales] = await Promise.all([
    get<{ proton_speed: number; time_tag: string }[]>('/products/summary/solar-wind-speed.json'),
    get<{ kp_index: number; estimated_kp: number }[]>('/json/planetary_k_index_1m.json'),
    get<{ flux: number; energy: string }[]>('/json/goes/primary/xrays-6-hour.json'),
    get<Record<string, { R: { Scale: string }; S: { Scale: string }; G: { Scale: string } }>>('/products/noaa-scales.json'),
  ]);
  const longBand = xray?.filter((x) => x.energy === '0.1-0.8nm') || [];
  const lastXray = longBand[longBand.length - 1];
  const lastKp = kp?.[kp.length - 1];
  const now = scales?.['0'];
  return {
    windSpeedKms: wind?.[0]?.proton_speed ?? null,
    windTime: wind?.[0]?.time_tag ?? null,
    kp: lastKp ? (lastKp.estimated_kp ?? lastKp.kp_index) : null,
    xrayClass: lastXray ? flareClass(lastXray.flux) : null,
    scales: now ? { R: now.R.Scale, S: now.S.Scale, G: now.G.Scale } : null,
    fetchedAt: Date.now(),
  };
}

export function kpLabel(kp: number) {
  if (kp >= 7) return 'Severe geomagnetic storm';
  if (kp >= 5) return 'Geomagnetic storm — auroras far from the poles';
  if (kp >= 4) return 'Unsettled — auroras possible at high latitudes';
  return 'Quiet';
}
