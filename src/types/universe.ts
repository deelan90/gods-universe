export type ObjectCategory =
  | 'star'
  | 'planet'
  | 'moon'
  | 'dwarf-planet'
  | 'exoplanet'
  | 'satellite'
  | 'spacecraft'
  | 'nebula'
  | 'cluster'
  | 'galaxy'
  | 'black-hole'
  | 'cosmic-structure'
  | 'constellation';

export type PlanetComposition =
  | 'Rocky'
  | 'Super-Earth'
  | 'Ice Giant'
  | 'Gas Giant'
  | 'Lava World';

export type OpticalMode = 'true-color' | 'tactical' | 'infrared' | 'deep-field';

export type FilterActionMode = 'isolate' | 'highlight' | 'color-group';

export interface ExoplanetRecord {
  id: string;
  name: string;
  hostStar: string;
  ra: number;
  dec: number;
  distLy: number;
  posLy: [number, number, number];
  earthRadii: number;
  massEarths: number;
  tempK: number | null;
  planetType: PlanetComposition;
  orbPeriodDays: number | null;
  semiMajorAxisAu: number | null;
  eccentricity: number;
  starTeff: number;
  starRadiiSolar: number;
  starLumSolar: number;
  starSpecClass: string;
  hzInnerAu: number;
  hzOuterAu: number;
  inHabitableZone: boolean;
  discYear: number | null;
  discPubDate: string | null;
  discFacility: string;
  discMethod: string;
  isRecent: boolean;
}

export interface StarRecord {
  id: string;
  hip: number | null;
  name: string;
  proper: string | null;
  bayerFlamsteed: string | null;
  constellation: string | null;
  ra: number;
  dec: number;
  distLy: number;
  posLy: [number, number, number];
  mag: number;
  bv: number;
  teff: number;
  specClass: string;
  spectFull: string;
  lumSolar: number;
  solarRadii: number;
  hzInnerAu: number;
  hzOuterAu: number;
}

export interface ZodiacSign {
  id: string;
  name: string;
  symbol: string;
  title: string;
  element: string;
  dates: string;
  eclipticLonDeg: number;
  brightestStar: string;
  funFact: string;
}

export interface ConstellationRecord {
  id: string;
  name: string;
  latinName: string;
  raDeg: number;
  decDeg: number;
  isZodiac: boolean;
  zodiac: ZodiacSign | null;
  labelPosLy: [number, number, number];
  segments3D: [number, number, number][][];
}

export interface SatelliteRecord {
  id: string;
  noradId: number;
  name: string;
  objectId: string;
  category: string;
  omm: Record<string, unknown>;
}

export interface SolarSystemBody {
  id: string;
  name: string;
  category: 'star' | 'planet' | 'moon' | 'dwarf-planet';
  planetType: PlanetComposition | null;
  parentId?: string;
  radiusKm: number;
  earthRadii: number;
  solarRadii?: number;
  massEarths: number;
  tempK: number;
  luminositySolar?: number;
  spectralType?: string;
  semiMajorAxisAu: number;
  orbitalPeriodDays: number;
  inHabitableZone?: boolean;
  hasRings?: boolean;
  color: string;
  nasaQuery: string;
  heroImage: string;
  funFacts: string[];
}

export interface DeepSpaceRecord {
  id: string;
  name: string;
  category: 'spacecraft' | 'nebula' | 'cluster' | 'galaxy' | 'black-hole' | 'cosmic-structure';
  subType: string;
  raDeg: number;
  decDeg: number;
  distLy: number;
  posLy: [number, number, number];
  sizeLy: number;
  mag?: number;
  color: string;
  telescope?: string;
  nasaQuery: string;
  heroImage: string | null;
  renderAs25D: boolean;
  funFacts: string[];
}

export interface DeepSpaceBundle {
  solarSystem: SolarSystemBody[];
  zodiacSigns: ZodiacSign[];
  landmarks: DeepSpaceRecord[];
  catalogDsos: DeepSpaceRecord[];
}

export interface UnifiedCelestialObject {
  id: string;
  name: string;
  subtitle: string;
  category: ObjectCategory;
  planetType?: PlanetComposition | null;
  earthRadii?: number | null;
  massEarths?: number | null;
  solarRadii?: number | null;
  lumSolar?: number | null;
  tempK?: number | null;
  specClass?: string | null;
  inHabitableZone?: boolean;
  hzInnerAu?: number | null;
  hzOuterAu?: number | null;
  orbPeriodDays?: number | null;
  semiMajorAxisAu?: number | null;
  discYear?: number | null;
  discFacility?: string | null;
  isRecent?: boolean;
  color: string;
  raDeg?: number | null;
  decDeg?: number | null;
  wikiTitle?: string | null;
  nasaQuery: string;
  fallbackQuery?: string;
  heroImage?: string | null;
  renderAs25D?: boolean;
  funFacts: string[];
  /** Canonical base position in Light-Years (dynamic objects like planets & satellites update live in the engine) */
  basePosLy: [number, number, number];
  raw?: ExoplanetRecord | StarRecord | SolarSystemBody | SatelliteRecord | DeepSpaceRecord | ConstellationRecord;
}

export interface LayerVisibility {
  satellites: boolean;
  planetOrbits: boolean;
  constellations: boolean;
  zodiacSigns: boolean;
  habitableZones: boolean;
  exoplanets: boolean;
  deepSpace: boolean;
  cosmicWeb: boolean;
  labels: boolean;
  helicalMotion: boolean;
  trueScaleBodies: boolean;
}

export interface UniverseFilters {
  actionMode: FilterActionMode;
  planetTypes: PlanetComposition[]; // empty = all
  minEarthRadii: number;
  maxEarthRadii: number;
  habitableOnly: boolean;
  recentDiscoveriesOnly: boolean;
  discoveryFacility: string; // 'ALL' | 'JWST' | 'TESS' | 'Kepler'
  minStarSolarRadii: number;
  maxStarSolarRadii: number;
  starSpectralClasses: string[]; // empty = all
  satelliteCategory: string; // 'ALL' or specific category
  deepSpaceCategory: string; // 'ALL' | 'nebula' | 'galaxy' | 'black-hole' | 'cluster' | 'spacecraft' | 'cosmic-structure'
}

export interface TelescopeImage {
  id: string;
  title: string;
  description: string;
  dateCreated: string;
  center: string;
  telescope: string;
  imageUrl: string;
  contextTag: string;
  popularityScore: number;
}

export interface SyncManifest {
  version: string;
  lastSyncedAt: string;
  nextScheduledSyncAt: string;
  syncIntervalHours: number;
  durationMs: number;
  counts: {
    exoplanets: number;
    stars: number;
    constellations: number;
    zodiacSigns: number;
    satellites: number;
    solarSystemBodies: number;
    deepSpaceObjects: number;
  };
  sources: { name: string; url: string; status: string }[];
  recentDiscoveries: {
    id: string;
    name: string;
    hostStar: string;
    distLy: number;
    earthRadii: number;
    planetType: PlanetComposition;
    inHabitableZone: boolean;
    discYear: number | null;
    discPubDate: string | null;
    discFacility: string;
  }[];
  warnings?: string[];
}
