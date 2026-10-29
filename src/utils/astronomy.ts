import * as Astronomy from 'astronomy-engine';
import * as satellite from 'satellite.js';
import type {
  ConstellationRecord,
  DeepSpaceBundle,
  ExoplanetRecord,
  SatelliteRecord,
  SolarSystemBody,
  StarRecord,
  UnifiedCelestialObject,
} from '../types/universe';

export const KM_PER_AU = 149_597_870.7;
export const AU_PER_LY = 63_241.07708426628;
export const KM_PER_LY = KM_PER_AU * AU_PER_LY; // ~9.4607304725808e12 km
export const RENDER_KM_UNIT = 1_000; // 1 WebGL scene unit = 1,000 km
export const RENDER_UNITS_PER_AU = KM_PER_AU / RENDER_KM_UNIT; // ~149,597.8707 units
export const RENDER_UNITS_PER_LY = KM_PER_LY / RENDER_KM_UNIT; // ~9,460,730,472.58 units

// Physical Velocities (km/s)
export const SPEED_OF_LIGHT_KMS = 299_792.458;
export const EARTH_ORBIT_SPEED_KMS = 29.784;
export const SOLAR_GALACTIC_SPEED_KMS = 230.0; // Solar System orbit around Milky Way (toward Cygnus: l=90°, b=0° -> RA=318°, Dec=+48.3°)
export const SOLAR_CMB_SPEED_KMS = 369.82; // Solar System velocity wrt Cosmic Microwave Background (toward Leo: RA=167.9°, Dec=-6.9°)
export const LOCAL_GROUP_SPEED_KMS = 627.0; // Local Group velocity toward Shapley / Great Attractor

const DEG_TO_RAD = Math.PI / 180;

export function raDecToUnitThree(raDeg: number, decDeg: number): [number, number, number] {
  const ra = raDeg * DEG_TO_RAD;
  const dec = decDeg * DEG_TO_RAD;
  const cosD = Math.cos(dec);
  return [cosD * Math.cos(ra), Math.sin(dec), -cosD * Math.sin(ra)];
}

// Unit vectors in Three.js J2000 Equatorial frame
export const SOLAR_GALACTIC_APEX_DIR = raDecToUnitThree(318.0, 48.3); // Toward Cygnus
export const SOLAR_CMB_APEX_DIR = raDecToUnitThree(167.94, -6.94); // Toward Crater/Leo boundary

const BODY_ENUM_MAP: Record<string, Astronomy.Body> = {
  mercury: Astronomy.Body.Mercury,
  venus: Astronomy.Body.Venus,
  earth: Astronomy.Body.Earth,
  mars: Astronomy.Body.Mars,
  jupiter: Astronomy.Body.Jupiter,
  saturn: Astronomy.Body.Saturn,
  uranus: Astronomy.Body.Uranus,
  neptune: Astronomy.Body.Neptune,
  pluto: Astronomy.Body.Pluto,
};

/**
 * Convert J2000 Equatorial AU vector -> Three.js Right-Handed Light-Years [x, y, z]
 */
export function eqAuToThreeLy(xAu: number, yAu: number, zAu: number): [number, number, number] {
  return [xAu / AU_PER_LY, zAu / AU_PER_LY, -yAu / AU_PER_LY];
}

/**
 * Compute live heliocentric positions (in Light-Years) for Sun, Planets, Moon, and JWST at any Date
 * Optional solarOffsetLy shifts the entire Solar System when Helical Galactic Motion is enabled!
 */
export function computeSolarSystemPositionsLy(
  date: Date,
  solarOffsetLy: [number, number, number] = [0, 0, 0]
): Record<string, [number, number, number]> {
  const result: Record<string, [number, number, number]> = {
    sun: [solarOffsetLy[0], solarOffsetLy[1], solarOffsetLy[2]],
  };

  for (const [id, astroBody] of Object.entries(BODY_ENUM_MAP)) {
    const vec = Astronomy.HelioVector(astroBody, date);
    const [lx, ly, lz] = eqAuToThreeLy(vec.x, vec.y, vec.z);
    result[id] = [solarOffsetLy[0] + lx, solarOffsetLy[1] + ly, solarOffsetLy[2] + lz];
  }

  // Moon geocentric offset added to Earth
  const earthPos = result.earth;
  const moonGeo = Astronomy.GeoMoon(date);
  const [mx, my, mz] = eqAuToThreeLy(moonGeo.x, moonGeo.y, moonGeo.z);
  result.moon = [earthPos[0] + mx, earthPos[1] + my, earthPos[2] + mz];

  // JWST at Sun-Earth L2 (~1.01 AU radially outward from Sun through Earth + small halo lissajous)
  const ex = earthPos[0] - solarOffsetLy[0];
  const ey = earthPos[1] - solarOffsetLy[1];
  const ez = earthPos[2] - solarOffsetLy[2];
  const phase = (date.getTime() / (86400_000 * 180)) * Math.PI * 2;
  const haloAu = 0.0025;
  result.jwst = [
    solarOffsetLy[0] + ex * 1.01005 + (Math.cos(phase) * haloAu) / AU_PER_LY,
    solarOffsetLy[1] + ey * 1.01005 + (Math.sin(phase) * haloAu) / AU_PER_LY,
    solarOffsetLy[2] + ez * 1.01005,
  ];

  return result;
}

/**
 * Sample full 3D orbital ellipse for a Solar System planet or Moon
 */
export function computeOrbitRingLy(body: SolarSystemBody, refDate: Date): [number, number, number][] {
  const segments = 128;
  const pts: [number, number, number][] = [];
  if (body.id === 'sun' || body.orbitalPeriodDays <= 0) return pts;

  if (body.id === 'moon') {
    for (let i = 0; i <= segments; i++) {
      const dt = new Date(refDate.getTime() + (i / segments) * body.orbitalPeriodDays * 86400_000);
      const m = Astronomy.GeoMoon(dt);
      pts.push(eqAuToThreeLy(m.x, m.y, m.z));
    }
    return pts;
  }

  const astroBody = BODY_ENUM_MAP[body.id];
  if (!astroBody) return pts;

  for (let i = 0; i <= segments; i++) {
    const dt = new Date(refDate.getTime() + (i / segments) * body.orbitalPeriodDays * 86400_000);
    const v = Astronomy.HelioVector(astroBody, dt);
    pts.push(eqAuToThreeLy(v.x, v.y, v.z));
  }
  return pts;
}

export function getEarthSiderealRotationRad(date: Date): number {
  // SiderealTime returns Greenwich Apparent Sidereal Time in sidereal hours [0, 24)
  const gastHours = Astronomy.SiderealTime(date);
  return (gastHours / 24) * Math.PI * 2;
}

export interface CompiledSatellite {
  record: SatelliteRecord;
  satrec: satellite.SatRec;
}

export function compileSatellites(records: SatelliteRecord[]): CompiledSatellite[] {
  const out: CompiledSatellite[] = [];
  for (const rec of records) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const satrec = satellite.json2satrec(rec.omm as any);
      if (satrec && !satrec.error) {
        out.push({ record: rec, satrec });
      }
    } catch {
      // Skip malformed OMM
    }
  }
  return out;
}

/**
 * Propagate satellite ECI offset from Earth center in km -> Three.js [xKm, yKm, zKm]
 */
export function propagateSatelliteOffsetKm(
  satrec: satellite.SatRec,
  date: Date
): { posKm: [number, number, number]; speedKms: number; altitudeKm: number } | null {
  try {
    const pv = satellite.propagate(satrec, date);
    if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
    const { x, y, z } = pv.position;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    const r = Math.hypot(x, y, z);
    if (r < 6380 || r > 500_000) return null;

    let speedKms = 7.6;
    if (pv.velocity && typeof pv.velocity !== 'boolean') {
      speedKms = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z);
    }
    // Map ECI (x, y, z=North) -> Three.js (x, z, -y)
    return {
      posKm: [x, z, -y],
      speedKms,
      altitudeKm: r - 6371.0,
    };
  } catch {
    return null;
  }
}

export function computeSatelliteOrbitTrackKm(
  satrec: satellite.SatRec,
  date: Date
): [number, number, number][] {
  const meanMotionRevPerDay = (satrec.no * 1440) / (2 * Math.PI);
  const periodMinutes = meanMotionRevPerDay > 0.1 ? 1440 / meanMotionRevPerDay : 92;
  const pts: [number, number, number][] = [];
  const steps = 96;
  for (let i = 0; i <= steps; i++) {
    const dt = new Date(date.getTime() + (i / steps) * periodMinutes * 60_000);
    const prop = propagateSatelliteOffsetKm(satrec, dt);
    if (prop) pts.push(prop.posKm);
  }
  return pts;
}

/**
 * Exact 3D Euclidean / Comoving distance between any two points in Light-Years
 */
export function distanceBetweenPosLy(
  a: [number, number, number],
  b: [number, number, number]
): { distLy: number; distAu: number; distKm: number } {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  const distLy = Math.hypot(dx, dy, dz);
  return {
    distLy,
    distAu: distLy * AU_PER_LY,
    distKm: distLy * KM_PER_LY,
  };
}

export function formatCosmicDistance(distLy: number): {
  primary: string;
  secondary: string;
} {
  const distKm = distLy * KM_PER_LY;
  const distAu = distLy * AU_PER_LY;

  if (distKm < 1_000_000) {
    return {
      primary: `${distKm.toLocaleString(undefined, { maximumFractionDigits: 0 })} km`,
      secondary: `${(distKm / 6371).toFixed(1)} Earth radii`,
    };
  }
  if (distAu < 0.05) {
    const lightSec = distKm / SPEED_OF_LIGHT_KMS;
    return {
      primary: `${(distKm / 1e6).toFixed(2)} Million km`,
      secondary: `${lightSec.toFixed(1)} light-seconds`,
    };
  }
  if (distLy < 0.01) {
    const lightMin = distKm / SPEED_OF_LIGHT_KMS / 60;
    return {
      primary: `${distAu.toFixed(3)} AU`,
      secondary:
        lightMin < 120
          ? `${lightMin.toFixed(1)} light-minutes (${(distKm / 1e6).toFixed(0)}M km)`
          : `${(lightMin / 60).toFixed(1)} light-hours`,
    };
  }
  if (distLy < 1_000) {
    return {
      primary: `${distLy.toFixed(2)} ly`,
      secondary: `${(distLy / 3.26156).toFixed(2)} pc • ${(distKm / 1e12).toFixed(1)} trillion km`,
    };
  }
  if (distLy < 1_000_000) {
    return {
      primary: `${(distLy / 1_000).toFixed(2)} kly`,
      secondary: `${distLy.toLocaleString(undefined, { maximumFractionDigits: 0 })} light-years`,
    };
  }
  if (distLy < 1_000_000_000) {
    return {
      primary: `${(distLy / 1_000_000).toFixed(2)} Million ly`,
      secondary: `${(distLy / 3_261_563.78).toFixed(2)} Mpc`,
    };
  }
  return {
    primary: `${(distLy / 1_000_000_000).toFixed(2)} Billion ly`,
    secondary: `${(distLy / 3_261_563_777).toFixed(2)} Gpc comoving`,
  };
}

export function formatTravelDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 sec';
  if (seconds < 60) return `${seconds.toFixed(2)} sec`;
  const mins = seconds / 60;
  if (mins < 60) return `${mins.toFixed(1)} min`;
  const hours = mins / 60;
  if (hours < 48) return `${hours.toFixed(1)} hrs`;
  const days = hours / 24;
  if (days < 365.25) return `${days.toFixed(1)} days`;
  const years = days / 365.25;
  if (years < 1_000) return `${years.toFixed(1)} yrs`;
  if (years < 1_000_000) return `${(years / 1_000).toFixed(1)} kyr`;
  if (years < 1_000_000_000) return `${(years / 1_000_000).toFixed(2)} Myr`;
  if (years < 1_000_000_000_000) return `${(years / 1_000_000_000).toFixed(2)} Gyr`;
  return `${(years / 1e12).toExponential(2)} Tyr`;
}

export function computeGoogleMapsCosmicTravelTimes(distKm: number) {
  return [
    {
      mode: 'Speed of Light (Photon)',
      speedLabel: '299,792 km/s (1.0 c)',
      duration: formatTravelDuration(distKm / SPEED_OF_LIGHT_KMS),
    },
    {
      mode: 'Parker Solar Probe',
      speedLabel: '192 km/s (Fastest Craft)',
      duration: formatTravelDuration(distKm / 192.0),
    },
    {
      mode: 'Voyager 1 Interstellar',
      speedLabel: '17.0 km/s (61,200 km/h)',
      duration: formatTravelDuration(distKm / 17.0),
    },
    {
      mode: 'Commercial Airliner',
      speedLabel: '900 km/h (0.25 km/s)',
      duration: formatTravelDuration(distKm / 0.25),
    },
  ];
}

export function starColorFromTempOrClass(teff: number, specClass?: string | null): string {
  const s = (specClass || '').toUpperCase();
  if (s === 'O' || teff >= 28000) return '#7dd3fc';
  if (s === 'B' || teff >= 10000) return '#bae6fd';
  if (s === 'A' || teff >= 7500) return '#f8fafc';
  if (s === 'F' || teff >= 6000) return '#fef9c3';
  if (s === 'G' || teff >= 5200) return '#fde047';
  if (s === 'K' || teff >= 3700) return '#fb923c';
  return '#f87171';
}

export function exoplanetColorFromType(planetType: string, inHz: boolean): string {
  if (inHz) return '#34d399';
  switch (planetType) {
    case 'Rocky':
      return '#fb923c';
    case 'Super-Earth':
      return '#38bdf8';
    case 'Ice Giant':
      return '#818cf8';
    case 'Gas Giant':
      return '#f59e0b';
    case 'Lava World':
      return '#ef4444';
    default:
      return '#94a3b8';
  }
}

/**
 * Unifies all fetched astronomical datasets into a fast lookup & search index with rich Fun Facts
 */
export function buildUnifiedCatalog(params: {
  exoplanets: ExoplanetRecord[];
  stars: StarRecord[];
  constellations: ConstellationRecord[];
  satellites: SatelliteRecord[];
  deepSpace: DeepSpaceBundle;
}): {
  byId: Map<string, UnifiedCelestialObject>;
  searchable: UnifiedCelestialObject[];
} {
  const byId = new Map<string, UnifiedCelestialObject>();
  const searchable: UnifiedCelestialObject[] = [];

  const register = (obj: UnifiedCelestialObject, addToSearch = true) => {
    byId.set(obj.id, obj);
    if (addToSearch) searchable.push(obj);
  };

  // 1. Solar System
  for (const b of params.deepSpace.solarSystem) {
    register({
      id: b.id,
      name: b.name,
      subtitle:
        b.category === 'star'
          ? `G2V Main-Sequence Star • Solar System Anchor`
          : `${b.planetType || 'Solar'} ${b.category === 'moon' ? 'Moon' : b.category === 'dwarf-planet' ? 'Dwarf Planet' : 'Planet'} • ${b.semiMajorAxisAu} AU`,
      category: b.category,
      planetType: b.planetType,
      earthRadii: b.earthRadii,
      massEarths: b.massEarths,
      solarRadii: b.solarRadii ?? null,
      lumSolar: b.luminositySolar ?? null,
      tempK: b.tempK,
      specClass: b.spectralType ? b.spectralType[0] : null,
      inHabitableZone: b.inHabitableZone ?? false,
      hzInnerAu: b.id === 'sun' ? 0.95 : null,
      hzOuterAu: b.id === 'sun' ? 1.67 : null,
      orbPeriodDays: b.orbitalPeriodDays,
      semiMajorAxisAu: b.semiMajorAxisAu,
      color: b.color,
      nasaQuery: b.nasaQuery,
      heroImage: b.heroImage,
      renderAs25D: false,
      funFacts: b.funFacts,
      basePosLy: [0, 0, 0],
      raw: b,
    });
  }

  // 2. Deep-Space Landmarks & Catalog DSOs
  for (const d of [...params.deepSpace.landmarks, ...params.deepSpace.catalogDsos]) {
    register({
      id: d.id,
      name: d.name,
      subtitle: `${d.subType} • ${formatCosmicDistance(d.distLy).primary}`,
      category: d.category,
      color: d.color,
      nasaQuery: d.nasaQuery,
      fallbackQuery: d.category === 'galaxy' ? 'Hubble Webb spiral galaxy' : 'Hubble Webb nebula',
      heroImage: d.heroImage,
      renderAs25D: d.renderAs25D,
      funFacts: d.funFacts,
      basePosLy: d.posLy,
      raw: d,
    });
  }

  // 3. Satellites
  for (const s of params.satellites) {
    const isIss = s.name.includes('ISS');
    const isHubble = s.name.includes('HST') || s.name.toUpperCase().includes('HUBBLE');
    register({
      id: s.id,
      name: s.name,
      subtitle: `${s.category} • NORAD #${s.noradId}`,
      category: 'satellite',
      color: isIss ? '#fde047' : isHubble ? '#c084fc' : '#38bdf8',
      nasaQuery: isIss
        ? 'International Space Station Earth orbit'
        : isHubble
          ? 'Hubble Space Telescope orbit'
          : `${s.name.split(' ')[0]} satellite NASA Earth orbit`,
      fallbackQuery: 'Earth observation satellite orbit NASA',
      heroImage: null,
      renderAs25D: false,
      funFacts: [
        `Active orbital spacecraft tracked live via NORAD GP/SGP4 telemetry (Catalog #${s.noradId}, Designator ${s.objectId || 'LEO'}).`,
        isIss
          ? 'Continuously inhabited human outpost orbiting ~420 km above Earth at 7.66 km/s—completing 15.5 sunrises every 24 hours!'
          : `Propagated in real time relative to Earth’s equatorial frame as part of the ${s.category} fleet.`,
      ],
      basePosLy: [0, 0, 0],
      raw: s,
    });
  }

  // 4. Exoplanets (6,400+ NASA Exoplanet Archive worlds)
  for (const p of params.exoplanets) {
    const gravityEst = p.massEarths && p.earthRadii ? (p.massEarths / (p.earthRadii * p.earthRadii)).toFixed(2) : null;
    const facts: string[] = [
      `Confirmed ${p.planetType} exoplanet orbiting host star ${p.hostStar} at ${p.distLy} light-years from Earth, discovered in ${p.discYear || 'recent survey'} via ${p.discMethod} (${p.discFacility}).`,
      `Measures ${p.earthRadii}× Earth’s radius (${p.massEarths}× Earth’s mass)${gravityEst ? `, giving an estimated surface/cloud-top gravity of ~${gravityEst} g` : ''}.`,
    ];
    if (p.inHabitableZone) {
      facts.push(
        `Orbits INSIDE ${p.hostStar}’s circumstellar Habitable Zone (${p.hzInnerAu}–${p.hzOuterAu} AU), where surface temperatures (${p.tempK ?? '~260'} K) could permit liquid water!`
      );
    } else if (p.orbPeriodDays) {
      facts.push(
        `Completes one full "year" around ${p.hostStar} in just ${p.orbPeriodDays < 10 ? p.orbPeriodDays.toFixed(2) : Math.round(p.orbPeriodDays)} Earth days${p.tempK ? ` with an equilibrium temperature near ${p.tempK} K (${Math.round(p.tempK - 273.15)}°C)` : ''}.`
      );
    }

    register({
      id: p.id,
      name: p.name,
      subtitle: `${p.planetType} Exoplanet (${p.earthRadii}× R⊕)${p.inHabitableZone ? ' • Habitable Zone' : ''} • ${p.distLy} ly`,
      category: 'exoplanet',
      planetType: p.planetType,
      earthRadii: p.earthRadii,
      massEarths: p.massEarths,
      tempK: p.tempK,
      specClass: p.starSpecClass,
      inHabitableZone: p.inHabitableZone,
      hzInnerAu: p.hzInnerAu,
      hzOuterAu: p.hzOuterAu,
      orbPeriodDays: p.orbPeriodDays,
      semiMajorAxisAu: p.semiMajorAxisAu,
      discYear: p.discYear,
      discFacility: p.discFacility,
      isRecent: p.isRecent,
      color: exoplanetColorFromType(p.planetType, p.inHabitableZone),
      nasaQuery: `${p.name} exoplanet`,
      fallbackQuery: `${p.discFacility.includes('JWST') || p.discFacility.includes('Webb') ? 'Webb' : p.discFacility.includes('TESS') ? 'TESS' : 'Kepler'} exoplanet ${p.planetType}`,
      heroImage: null,
      renderAs25D: false,
      funFacts: facts,
      basePosLy: p.posLy,
      raw: p,
    });
  }

  // 5. Stars (6,800+ 3D HYG stars)
  for (const st of params.stars) {
    const isNamed = Boolean(st.proper);
    const facts: string[] = [
      `${st.spectFull}-class star located ${st.distLy} light-years away${st.constellation ? ` in the constellation ${st.constellation}` : ''}, shining with ${st.lumSolar >= 10 ? Math.round(st.lumSolar).toLocaleString() : st.lumSolar}× the luminosity of our Sun.`,
      `Photosphere temperature is ~${st.teff.toLocaleString()} K with an estimated stellar radius of ${st.solarRadii}× R☉; its liquid-water Habitable Zone spans ${st.hzInnerAu} to ${st.hzOuterAu} AU.`,
    ];
    if (st.distLy < 15) {
      facts.push(`One of our Solar System’s closest stellar neighbors—light leaving this star today reaches Earth in just ${st.distLy.toFixed(1)} years!`);
    }

    register(
      {
        id: st.id,
        name: st.name,
        subtitle: `${st.spectFull} Star (${st.solarRadii}× R☉) • ${st.distLy} ly`,
        category: 'star',
        solarRadii: st.solarRadii,
        lumSolar: st.lumSolar,
        tempK: st.teff,
        specClass: st.specClass,
        hzInnerAu: st.hzInnerAu,
        hzOuterAu: st.hzOuterAu,
        color: starColorFromTempOrClass(st.teff, st.specClass),
        nasaQuery: isNamed ? `${st.proper} star Hubble` : `star cluster ${st.specClass} type Hubble`,
        fallbackQuery: 'Hubble star field stellar',
        heroImage: null,
        renderAs25D: false,
        funFacts: facts,
        basePosLy: st.posLy,
        raw: st,
      },
      isNamed || st.distLy < 35 || st.mag < 3.8 // Keep omnisearch ultra-snappy while indexing all named/bright/nearby stars
    );
  }

  // 6. Constellations & Zodiac Star Signs
  for (const c of params.constellations) {
    register({
      id: `const-${c.id}`,
      name: c.zodiac ? `${c.zodiac.symbol} ${c.name} (${c.zodiac.title})` : `${c.name} Constellation`,
      subtitle: c.zodiac
        ? `Zodiac Star Sign (${c.zodiac.dates}) • ${c.zodiac.element} Sign`
        : `IAU Constellation (${c.id})`,
      category: 'constellation',
      color: c.isZodiac ? '#fbbf24' : '#60a5fa',
      nasaQuery: `${c.name} constellation nebula`,
      fallbackQuery: 'deep sky nebula star cluster Hubble',
      heroImage: null,
      renderAs25D: false,
      funFacts: c.zodiac
        ? [
            `${c.zodiac.symbol} ${c.name} ("${c.zodiac.title}") is one of the 12 ecliptic Zodiac constellations (${c.zodiac.dates}), anchored by ${c.zodiac.brightestStar}.`,
            c.zodiac.funFact,
            'Fly away from Earth to watch its 2D sky pattern stretch across hundreds of light-years in true 3D interstellar depth!',
          ]
        : [
            `One of the 88 official International Astronomical Union (IAU) constellations; its stars appear connected from Earth yet span vastly different 3D distances in our Milky Way.`,
          ],
      basePosLy: c.labelPosLy,
      raw: c,
    });
  }

  return { byId, searchable };
}
