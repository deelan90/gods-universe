import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  Satellite,
  CloudSun,
  Camera,
  SlidersHorizontal,
  Navigation,
  Keyboard,
  RefreshCw,
  Compass,
  Home,
  Move,
  RotateCcw,
  Layers,
  ZoomOut,
} from 'lucide-react';
import type {
  ApodEntry,
  ConstellationRecord,
  DeepSpaceBundle,
  ExoplanetRecord,
  LayerVisibility,
  OpticalMode,
  SatelliteRecord,
  StarRecord,
  SyncManifest,
  TelescopeImage,
  UnifiedCelestialObject,
  UniverseFilters,
} from './types/universe';
import { buildUnifiedCatalog } from './utils/astronomy';
import { IS_LOCAL_DEV_HOST, resolvePublicDataUrl } from './utils/nasaImagesClient';
import { fetchNasaApodFeed } from './utils/apodClient';
import { UniverseScene, type SceneTelemetrySnapshot } from './engine/UniverseScene';
import { TopTelemetryBar, type ScalePreset } from './components/TopTelemetryBar';
import { LayerAndFilterPanel } from './components/LayerAndFilterPanel';
import { CosmicRouteCard } from './components/CosmicRouteCard';
import { ObjectDossierDrawer } from './components/ObjectDossierDrawer';
import { TimeAndVelocityBar } from './components/TimeAndVelocityBar';
import { Telescope25DModal } from './components/Telescope25DModal';
import { DataSyncModal } from './components/DataSyncModal';
import { ApodObservatoryDrawer } from './components/ApodObservatoryDrawer';
import { NavRail, type DockPanel } from './components/NavRail';
import { CommandPalette, type PaletteAction } from './components/CommandPalette';
import { ShortcutsHelp } from './components/ShortcutsHelp';

// Tool panels load on first open to keep the initial download small
const LiveTrackerPanel = React.lazy(() =>
  import('./components/LiveTrackerPanel').then((m) => ({ default: m.LiveTrackerPanel }))
);
const WorldWeatherPanel = React.lazy(() =>
  import('./components/WorldWeatherPanel').then((m) => ({ default: m.WorldWeatherPanel }))
);
import { ObjectLiveStats } from './components/ObjectLiveStats';
import type { SpacecraftEphemerisFile } from './utils/spacecraft';
import { fetchFreshStationElements, pickStations } from './utils/stations';
import type { PlanetWeatherFile } from './utils/planetWeather';

const DEFAULT_LAYERS: LayerVisibility = {
  satellites: true,
  spacecraft: true,
  planetOrbits: true,
  constellations: true,
  zodiacSigns: true,
  habitableZones: false,
  exoplanets: true,
  deepSpace: true,
  cosmicWeb: true,
  simGrid: true,
  labels: true,
  helicalMotion: false,
  trueScaleBodies: false,
};

const DEFAULT_FILTERS: UniverseFilters = {
  actionMode: 'highlight',
  planetTypes: [],
  minEarthRadii: 0.1,
  maxEarthRadii: 25,
  habitableOnly: false,
  recentDiscoveriesOnly: false,
  discoveryFacility: 'ALL',
  minStarSolarRadii: 0.08,
  maxStarSolarRadii: 1000,
  starSpectralClasses: [],
  satelliteCategory: 'ALL',
  deepSpaceCategory: 'ALL',
};

const SCALE_PRESETS: ScalePreset[] = [
  'earth-orbit',
  'solar-system',
  'interstellar',
  'milky-way',
  'local-group',
  'superclusters',
  'observable-universe',
];

const SCALE_LABELS: Record<ScalePreset, string> = {
  'earth-orbit': 'Earth & satellites',
  'solar-system': 'Solar System',
  interstellar: 'Nearby stars',
  'milky-way': 'Milky Way',
  'local-group': 'Local Group of galaxies',
  superclusters: 'Superclusters',
  'observable-universe': 'Whole observable universe',
};

const QUICK_PICKS = [
  'earth',
  'moon',
  'mars',
  'sat-25544',
  'sat-48274',
  'voyager-1',
  'voyager-2',
  'jwst',
  'parker-solar-probe',
  'saturn',
  'exo-trappist-1-e',
  'orion-nebula',
  'andromeda',
  'sagittarius-a-star',
];

const HASH_PREFIX = '#/o/';

function readHashTarget(): string | null {
  const h = window.location.hash;
  if (!h.startsWith(HASH_PREFIX)) return null;
  try {
    return decodeURIComponent(h.slice(HASH_PREFIX.length)) || null;
  } catch {
    return null;
  }
}

async function fetchOptionalJson<T>(file: string, qs: string): Promise<T | null> {
  try {
    const r = await fetch(resolvePublicDataUrl(`${file}${qs}`));
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

function isTypingTarget(el: Element | null) {
  if (!el) return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

export const App: React.FC = () => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<UniverseScene | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [catalogById, setCatalogById] = useState<Map<string, UnifiedCelestialObject>>(new Map());
  const [searchableObjects, setSearchableObjects] = useState<UnifiedCelestialObject[]>([]);

  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS);
  const [filters, setFilters] = useState<UniverseFilters>(DEFAULT_FILTERS);
  const [opticalMode, setOpticalMode] = useState<OpticalMode>('true-color');

  const [playing, setPlaying] = useState(true);
  const [timeScale, setTimeScale] = useState(1);

  const [routeOriginId, setRouteOriginId] = useState<string>('earth');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // One docked tool panel at a time keeps the view uncluttered
  const [panel, setPanel] = useState<DockPanel | null>(null);
  const [showRouteCard, setShowRouteCard] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [apodEntries, setApodEntries] = useState<ApodEntry[]>([]);
  const [modal25D, setModal25D] = useState<{ image: TelescopeImage; spherical: boolean } | null>(null);

  const [telemetry, setTelemetry] = useState<SceneTelemetrySnapshot | null>(null);

  const [manifest, setManifest] = useState<SyncManifest | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncIntervalHours, setSyncIntervalHours] = useState(72);

  // Live feeds
  const [spacecraftEphem, setSpacecraftEphem] = useState<SpacecraftEphemerisFile | null>(null);
  const [planetWeather, setPlanetWeather] = useState<PlanetWeatherFile | null>(null);
  const [stationRecords, setStationRecords] = useState<SatelliteRecord[]>([]);
  const [stationsLive, setStationsLive] = useState(false);
  const pendingHashTarget = useRef<string | null>(readHashTarget());

  const loadAllUniverseData = useCallback(async (cacheBust = false) => {
    try {
      const qs = cacheBust ? `?t=${Date.now()}` : '';
      const [exoRes, starsRes, constRes, satRes, deepRes, manRes] = await Promise.all([
        fetch(resolvePublicDataUrl(`exoplanets.json${qs}`)),
        fetch(resolvePublicDataUrl(`stars.json${qs}`)),
        fetch(resolvePublicDataUrl(`constellations.json${qs}`)),
        fetch(resolvePublicDataUrl(`satellites.json${qs}`)),
        fetch(resolvePublicDataUrl(`deepSpace.json${qs}`)),
        fetch(resolvePublicDataUrl(`syncManifest.json${qs}`)),
      ]);

      if (!exoRes.ok || !starsRes.ok || !deepRes.ok) {
        throw new Error('Astronomical catalog files missing. Run `npm run sync-data` first.');
      }

      const [exoplanets, stars, constellations, satellites, deepSpace, manifestJson]: [
        ExoplanetRecord[],
        StarRecord[],
        ConstellationRecord[],
        SatelliteRecord[],
        DeepSpaceBundle,
        SyncManifest,
      ] = await Promise.all([
        exoRes.json(),
        starsRes.json(),
        constRes.json(),
        satRes.json(),
        deepRes.json(),
        manRes.json(),
      ]);

      const { byId, searchable } = buildUnifiedCatalog({ exoplanets, stars, constellations, satellites, deepSpace });

      setCatalogById(byId);
      setSearchableObjects(searchable);
      setManifest(manifestJson);
      if (manifestJson?.syncIntervalHours) setSyncIntervalHours(manifestJson.syncIntervalHours);
      setStationRecords(satellites.filter((s) => s.category === 'Space Station'));

      sceneRef.current?.loadDatasets({ exoplanets, stars, constellations, satellites, deepSpace, catalogById: byId });
      setLoading(false);

      // Optional live files — the app works without them
      const [ephem, weather] = await Promise.all([
        fetchOptionalJson<SpacecraftEphemerisFile>('spacecraft.json', qs),
        fetchOptionalJson<PlanetWeatherFile>('planetWeather.json', qs),
      ]);
      if (ephem) {
        setSpacecraftEphem(ephem);
        sceneRef.current?.setSpacecraftEphemeris(ephem);
      }
      if (weather) setPlanetWeather(weather);
    } catch (err) {
      setLoadError((err as Error).message);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!viewportRef.current) return;
    const engine = new UniverseScene(viewportRef.current, DEFAULT_LAYERS, DEFAULT_FILTERS, {
      onSelectObject: (id) => setSelectedId(id),
      onTelemetryUpdate: (snap) => setTelemetry(snap),
    });
    sceneRef.current = engine;
    loadAllUniverseData();
    return () => {
      engine.dispose();
      sceneRef.current = null;
    };
  }, [loadAllUniverseData]);

  // Refresh crewed-station orbits straight from CelesTrak if the synced copy is stale
  useEffect(() => {
    if (!stationRecords.length || stationsLive) return;
    let alive = true;
    fetchFreshStationElements(stationRecords).then((fresh) => {
      if (!alive || !fresh) return;
      const byNorad = new Map(fresh.map((r) => [r.noradId, r]));
      setStationRecords((prev) => {
        const merged = prev.map((r) => byNorad.get(r.noradId) || r);
        for (const r of fresh) if (!prev.some((p) => p.noradId === r.noradId)) merged.push(r);
        return merged;
      });
      sceneRef.current?.updateSatelliteElements(fresh);
      setStationsLive(true);
    });
    return () => {
      alive = false;
    };
  }, [stationRecords, stationsLive]);

  const trackedStations = useMemo(() => pickStations(stationRecords), [stationRecords]);

  useEffect(() => {
    let active = true;
    fetchNasaApodFeed()
      .then((items) => {
        if (active && items.length > 0) setApodEntries(items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!IS_LOCAL_DEV_HOST) return;
    fetch('/api/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (s?.manifest) setManifest(s.manifest);
        if (typeof s?.isSyncing === 'boolean') setIsSyncing(s.isSyncing);
        if (s?.syncIntervalHours) setSyncIntervalHours(s.syncIntervalHours);
      })
      .catch(() => {});
  }, []);

  /* ------------------------------------------------------------ handlers */

  const handleChangeLayers = useCallback((next: LayerVisibility) => {
    setLayers(next);
    sceneRef.current?.setLayers(next);
  }, []);

  const handleChangeFilters = useCallback((next: UniverseFilters) => {
    setFilters(next);
    sceneRef.current?.setFilters(next);
  }, []);

  const handleResetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    sceneRef.current?.setFilters(DEFAULT_FILTERS);
  }, []);

  const handleOpticalMode = useCallback((mode: OpticalMode) => {
    setOpticalMode(mode);
    sceneRef.current?.setOpticalMode(mode);
  }, []);

  const handleTogglePlay = useCallback(() => {
    setPlaying((prev) => {
      const next = !prev;
      sceneRef.current?.setTimeControls(next, timeScale);
      return next;
    });
  }, [timeScale]);

  const handleTimeScale = useCallback(
    (scale: number) => {
      setTimeScale(scale);
      sceneRef.current?.setTimeControls(playing, scale);
    },
    [playing]
  );

  const handleResetLive = useCallback(() => {
    setPlaying(true);
    setTimeScale(1);
    sceneRef.current?.resetToLiveNow();
  }, []);

  const handleSelectAndFly = useCallback((id: string) => {
    setSelectedId(id);
    sceneRef.current?.selectObject(id, true);
  }, []);

  const handleSetOrigin = useCallback((id: string) => {
    setRouteOriginId(id);
    sceneRef.current?.setRouteOrigin(id);
    setShowRouteCard(true);
  }, []);

  const handleSelectTargetOnly = useCallback((id: string) => {
    setSelectedId(id);
    sceneRef.current?.selectObject(id, false);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setSelectedId(null);
    sceneRef.current?.selectObject(null, false);
  }, []);

  const handleOpen25DImage = useCallback((image: TelescopeImage, spherical: boolean) => {
    setModal25D({ image, spherical });
  }, []);

  const handleToggleFreeRoam = useCallback(() => sceneRef.current?.toggleFreeRoam(), []);

  const handleHopGalaxy = useCallback(() => {
    const id = sceneRef.current?.flyToRandomGalaxy();
    if (id) setSelectedId(id);
  }, []);

  const handleJumpScale = useCallback((preset: ScalePreset) => {
    sceneRef.current?.jumpToScalePreset(preset);
  }, []);

  const handleHome = useCallback(() => {
    setSelectedId(null);
    sceneRef.current?.selectObject(null, false);
    sceneRef.current?.jumpToScalePreset('earth-orbit');
  }, []);

  const togglePanel = useCallback((p: DockPanel) => setPanel((cur) => (cur === p ? null : p)), []);

  const handleTriggerSync = async (newIntervalHours?: number) => {
    if (newIntervalHours) setSyncIntervalHours(newIntervalHours);
    setIsSyncing(true);
    try {
      if (IS_LOCAL_DEV_HOST) {
        const res = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: !newIntervalHours, syncIntervalHours: newIntervalHours || syncIntervalHours }),
        });
        const json = await res.json();
        if (json?.manifest) {
          setManifest(json.manifest);
          if (!newIntervalHours) {
            await loadAllUniverseData(true);
            fetchNasaApodFeed().then((items) => items.length > 0 && setApodEntries(items));
          }
        }
      } else {
        await loadAllUniverseData(true);
        fetchNasaApodFeed().then((items) => items.length > 0 && setApodEntries(items));
      }
    } catch {
      // offline
    } finally {
      setIsSyncing(false);
    }
  };

  /* ------------------------------------------------------------ deep links */

  // Fly to #/o/<id> once the catalog has loaded
  useEffect(() => {
    const target = pendingHashTarget.current;
    if (!target || catalogById.size === 0) return;
    pendingHashTarget.current = null;
    if (catalogById.has(target)) setTimeout(() => handleSelectAndFly(target), 600);
  }, [catalogById, handleSelectAndFly]);

  // Keep the address bar in step with the selection so links are shareable
  useEffect(() => {
    if (loading || pendingHashTarget.current) return;
    const want = selectedId ? `${HASH_PREFIX}${encodeURIComponent(selectedId)}` : '';
    if (window.location.hash !== want) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}${want}`);
    }
  }, [selectedId, loading]);

  useEffect(() => {
    const onHash = () => {
      const id = readHashTarget();
      if (id && id !== selectedId && catalogById.has(id)) handleSelectAndFly(id);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [catalogById, selectedId, handleSelectAndFly]);

  /* ------------------------------------------------------------ keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape') {
        if (paletteOpen) setPaletteOpen(false);
        else if (helpOpen) setHelpOpen(false);
        else if (modal25D) setModal25D(null);
        else if (syncModalOpen) setSyncModalOpen(false);
        else if (panel) setPanel(null);
        else if (showRouteCard) setShowRouteCard(false);
        else if (selectedId) handleCloseDrawer();
        return;
      }
      if (paletteOpen || helpOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(document.activeElement)) return;

      const k = e.key;
      if (k === '/') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (k === '?') setHelpOpen(true);
      else if (k === 'f' || k === 'F') togglePanel('layers');
      else if (k === 't' || k === 'T') togglePanel('tracker');
      else if (k === 'm' || k === 'M') togglePanel('weather');
      else if (k === 'i' || k === 'I') togglePanel('apod');
      else if (k === 'r' || k === 'R') setShowRouteCard((v) => !v);
      else if (k === 'p' || k === 'P') handleTogglePlay();
      else if (k === 'l' || k === 'L') handleResetLive();
      else if (k === 'h' || k === 'H') handleHome();
      else if (k === 'g' || k === 'G') handleHopGalaxy();
      else if (/^[1-7]$/.test(k)) handleJumpScale(SCALE_PRESETS[Number(k) - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    paletteOpen,
    helpOpen,
    modal25D,
    syncModalOpen,
    panel,
    showRouteCard,
    selectedId,
    togglePanel,
    handleCloseDrawer,
    handleTogglePlay,
    handleResetLive,
    handleHome,
    handleHopGalaxy,
    handleJumpScale,
  ]);

  /* ------------------------------------------------------------ derived */

  const selectedObject = useMemo(
    () => (selectedId ? catalogById.get(selectedId) || null : null),
    [selectedId, catalogById]
  );
  const originObject = useMemo(() => catalogById.get(routeOriginId), [routeOriginId, catalogById]);

  const filtersActive =
    filters.planetTypes.length > 0 ||
    filters.habitableOnly ||
    filters.recentDiscoveriesOnly ||
    filters.minEarthRadii > 0.1 ||
    filters.maxEarthRadii < 25 ||
    filters.deepSpaceCategory !== 'ALL';

  const paletteActions: PaletteAction[] = useMemo(() => {
    const i = 'w-3 h-3';
    return [
      { id: 'tracker', label: 'Live spacecraft tracker', hint: 'ISS, Tiangong, Voyagers, JWST and more · T', keywords: 'iss station voyager track live satellites probes', icon: <Satellite className={i} />, run: () => setPanel('tracker') },
      { id: 'weather', label: 'Weather on other worlds', hint: 'Mars today, the Sun’s space weather · M', keywords: 'mars weather temperature space weather sun aurora planets', icon: <CloudSun className={i} />, run: () => setPanel('weather') },
      { id: 'apod', label: 'NASA picture of the day', hint: 'APOD gallery · I', keywords: 'apod nasa image photo picture', icon: <Camera className={i} />, run: () => setPanel('apod') },
      { id: 'layers', label: 'Layers & filters', hint: 'Show or hide things · F', keywords: 'layers filters toggle show hide', icon: <SlidersHorizontal className={i} />, run: () => setPanel('layers') },
      { id: 'route', label: 'Distance calculator', hint: 'How far, and how long to get there · R', keywords: 'distance route travel time calculator', icon: <Navigation className={i} />, run: () => setShowRouteCard(true) },
      { id: 'home', label: 'Fly home to Earth', hint: 'H', keywords: 'home earth reset', icon: <Home className={i} />, run: handleHome },
      { id: 'hop', label: 'Warp to a random galaxy', hint: 'G', keywords: 'random galaxy hop warp surprise', icon: <Compass className={i} />, run: handleHopGalaxy },
      { id: 'roam', label: 'Toggle free roam', hint: 'Unlock the camera', keywords: 'free roam pan camera unlock', icon: <Move className={i} />, run: handleToggleFreeRoam },
      { id: 'live', label: 'Back to live time', hint: 'L', keywords: 'now live reset time clock', icon: <RotateCcw className={i} />, run: handleResetLive },
      ...SCALE_PRESETS.map((p, idx) => ({
        id: `zoom-${p}`,
        label: `Zoom to: ${SCALE_LABELS[p]}`,
        hint: `Key ${idx + 1}`,
        keywords: `zoom scale ${p} ${SCALE_LABELS[p]}`,
        icon: <ZoomOut className={i} />,
        run: () => handleJumpScale(p),
      })),
      ...(['spacecraft', 'satellites', 'constellations', 'exoplanets', 'labels', 'habitableZones'] as (keyof LayerVisibility)[]).map(
        (key) => ({
          id: `layer-${key}`,
          label: `${layers[key] ? 'Hide' : 'Show'} ${key === 'habitableZones' ? 'habitable zones' : key}`,
          hint: 'Layer',
          keywords: `layer toggle ${key}`,
          icon: <Layers className={i} />,
          run: () => handleChangeLayers({ ...layers, [key]: !layers[key] }),
        })
      ),
      { id: 'sync', label: 'Data sources & updates', hint: 'Where the data comes from', keywords: 'sync data sources update discoveries', icon: <RefreshCw className={i} />, run: () => setSyncModalOpen(true) },
      { id: 'help', label: 'Controls & keyboard shortcuts', hint: '?', keywords: 'help keys shortcuts controls', icon: <Keyboard className={i} />, run: () => setHelpOpen(true) },
    ];
  }, [layers, handleHome, handleHopGalaxy, handleToggleFreeRoam, handleResetLive, handleJumpScale, handleChangeLayers]);

  const simTimeMs = telemetry?.simTimeMs ?? Date.now();
  const isLiveTime = playing && timeScale === 1 && Math.abs(simTimeMs - Date.now()) < 90_000;

  const railProps = {
    active: panel,
    onToggle: togglePanel,
    routeOpen: showRouteCard,
    onToggleRoute: () => setShowRouteCard((v) => !v),
    onOpenSearch: () => setPaletteOpen(true),
    onOpenSync: () => setSyncModalOpen(true),
    onOpenHelp: () => setHelpOpen(true),
    isSyncing,
    newDiscoveries: manifest?.recentDiscoveries?.length || 0,
    filtersActive,
  };

  const liveStats =
    selectedObject &&
    (selectedObject.category === 'spacecraft' || trackedStations.some((s) => s.record.id === selectedObject.id)) ? (
      <ObjectLiveStats objectId={selectedObject.id} simTimeMs={simTimeMs} ephem={spacecraftEphem} stations={trackedStations} />
    ) : null;

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#02050d] text-slate-100 select-none">
      <div ref={viewportRef} className="absolute inset-0 w-full h-full" />

      <div className="pointer-events-none fixed inset-0 z-10 bg-[radial-gradient(circle_at_center,transparent_62%,rgba(2,5,13,0.52)_100%)]" />

      <TopTelemetryBar
        telemetry={telemetry}
        opticalMode={opticalMode}
        onChangeOpticalMode={handleOpticalMode}
        onOpenSearch={() => setPaletteOpen(true)}
        showChips={!panel}
        onToggleFreeRoam={handleToggleFreeRoam}
        onHopGalaxy={handleHopGalaxy}
        onHome={handleHome}
        layers={layers}
        onChangeLayers={handleChangeLayers}
        filters={filters}
        onChangeFilters={handleChangeFilters}
        onResetFilters={handleResetFilters}
        onJumpScale={handleJumpScale}
        mobileNav={<NavRail {...railProps} orientation="horizontal" />}
      />

      {/* Desktop navigation rail */}
      <div className="hidden md:block pointer-events-none fixed left-3 top-1/2 -translate-y-1/2 z-30">
        <NavRail {...railProps} orientation="vertical" />
      </div>

      {/* Docked tool panel (one at a time) */}
      {panel && (
        <div className="pointer-events-none fixed z-30 inset-x-2 top-[6.4rem] md:inset-x-auto md:left-[4.6rem] md:top-16">
          <React.Suspense
            fallback={
              <div className="pointer-events-auto w-full sm:w-[23rem] rounded-2xl glass-panel p-4 flex items-center gap-2 text-xs text-slate-300">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-300" /> Loading…
              </div>
            }
          >
          {panel === 'layers' && (
            <LayerAndFilterPanel
              layers={layers}
              onChangeLayers={handleChangeLayers}
              filters={filters}
              onChangeFilters={handleChangeFilters}
              onResetFilters={handleResetFilters}
              matchedCounts={telemetry?.matchedCounts || { exoplanets: 0, stars: 0, satellites: 0 }}
              onCloseMobile={() => setPanel(null)}
            />
          )}
          {panel === 'apod' && (
            <ApodObservatoryDrawer
              entries={apodEntries}
              catalogById={catalogById}
              searchableObjects={searchableObjects}
              onClose={() => setPanel(null)}
              onSelectAndFly={handleSelectAndFly}
              onInspect25D={handleOpen25DImage}
            />
          )}
          {panel === 'tracker' && (
            <LiveTrackerPanel
              simTimeMs={simTimeMs}
              isLiveTime={isLiveTime}
              stations={trackedStations}
              stationsRefreshedLive={stationsLive}
              ephem={spacecraftEphem}
              onFlyTo={handleSelectAndFly}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === 'weather' && (
            <WorldWeatherPanel data={planetWeather} onFlyTo={handleSelectAndFly} onClose={() => setPanel(null)} />
          )}
          </React.Suspense>
        </div>
      )}

      {showRouteCard && (
        <div
          className={`pointer-events-none fixed top-[6.4rem] md:top-16 z-20 transition-all duration-300 ${
            selectedObject ? 'right-2.5 sm:right-[25.8rem]' : 'right-2.5 sm:right-3.5'
          }`}
        >
          <CosmicRouteCard
            originObject={originObject}
            targetObject={selectedObject || undefined}
            originPosLy={telemetry?.originPosLy || [0, 0, 0]}
            targetPosLy={telemetry?.targetPosLy || null}
            searchableObjects={searchableObjects}
            onSetOriginId={handleSetOrigin}
            onSelectTargetId={handleSelectTargetOnly}
            onFlyTo={(id) => sceneRef.current?.flyToObject(id)}
            onClose={() => setShowRouteCard(false)}
          />
        </div>
      )}

      <ObjectDossierDrawer
        object={selectedObject}
        originObject={originObject}
        objectPosLy={telemetry?.targetPosLy || null}
        originPosLy={telemetry?.originPosLy || [0, 0, 0]}
        onClose={handleCloseDrawer}
        onFlyTo={(id) => sceneRef.current?.flyToObject(id)}
        onSetAsOrigin={handleSetOrigin}
        onOpen25DImage={handleOpen25DImage}
        liveContent={liveStats}
      />

      <TimeAndVelocityBar
        playing={playing}
        timeScale={timeScale}
        helicalMotion={layers.helicalMotion}
        telemetry={telemetry}
        onTogglePlay={handleTogglePlay}
        onChangeTimeScale={handleTimeScale}
        onResetLive={handleResetLive}
        onToggleHelicalMotion={() => handleChangeLayers({ ...layers, helicalMotion: !layers.helicalMotion })}
        onJumpScale={handleJumpScale}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        searchableObjects={searchableObjects}
        catalogById={catalogById}
        quickPickIds={QUICK_PICKS}
        actions={paletteActions}
        onSelectObject={handleSelectAndFly}
      />

      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

      <Telescope25DModal
        image={modal25D?.image || null}
        defaultSpherical={modal25D?.spherical ?? true}
        onClose={() => setModal25D(null)}
      />

      <DataSyncModal
        open={syncModalOpen}
        manifest={manifest}
        isSyncing={isSyncing}
        syncIntervalHours={syncIntervalHours}
        onClose={() => setSyncModalOpen(false)}
        onTriggerSync={handleTriggerSync}
        onSelectDiscovery={handleSelectAndFly}
      />

      {loading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#02050d] gap-3.5 px-6 text-center">
          <div className="relative flex items-center justify-center">
            <div className="w-14 h-14 rounded-full border border-cyan-400/25 animate-ping absolute" />
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
          </div>
          <div className="font-display text-base font-bold tracking-wider text-white uppercase">God&apos;s Universe</div>
          <p className="text-xs text-slate-400">Loading 6,400+ exoplanets, thousands of stars and galaxies, and live spacecraft…</p>
        </div>
      )}

      {loadError && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#02050d]/95 p-6 text-center gap-3">
          <div className="text-red-400 font-mono font-bold text-sm">Couldn’t load the universe data</div>
          <p className="text-xs text-slate-300 max-w-md">{loadError}</p>
        </div>
      )}
    </div>
  );
};

export default App;
