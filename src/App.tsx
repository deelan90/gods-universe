import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type {
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
import {
  UniverseScene,
  type ProjectedHudMarker,
  type SceneTelemetrySnapshot,
} from './engine/UniverseScene';
import { TopTelemetryBar } from './components/TopTelemetryBar';
import { LayerAndFilterPanel } from './components/LayerAndFilterPanel';
import { CosmicRouteCard } from './components/CosmicRouteCard';
import { ObjectDossierDrawer } from './components/ObjectDossierDrawer';
import { TimeAndVelocityBar } from './components/TimeAndVelocityBar';
import { Telescope25DModal } from './components/Telescope25DModal';
import { DataSyncModal } from './components/DataSyncModal';

const DEFAULT_LAYERS: LayerVisibility = {
  satellites: true,
  planetOrbits: true,
  constellations: true,
  zodiacSigns: true,
  habitableZones: false,
  exoplanets: true,
  deepSpace: true,
  cosmicWeb: true,
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

  // Time & Animation State
  const [playing, setPlaying] = useState(true);
  const [timeScale, setTimeScale] = useState(1);

  // Selection & "Google Maps for the Universe" Route Origin (Default: Earth!)
  const [routeOriginId, setRouteOriginId] = useState<string>('earth');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Panels & Modals (Responsive defaults for Desktop vs Mobile)
  const [showLeftPanel, setShowLeftPanel] = useState<boolean>(() => window.innerWidth >= 1024);
  const [showRouteCard, setShowRouteCard] = useState<boolean>(() => window.innerWidth >= 768);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [modal25D, setModal25D] = useState<{
    image: TelescopeImage;
    spherical: boolean;
  } | null>(null);

  // HUD Projections & Telemetry
  const [hudMarkers, setHudMarkers] = useState<ProjectedHudMarker[]>([]);
  const [telemetry, setTelemetry] = useState<SceneTelemetrySnapshot | null>(null);

  // Continual Data Sync State
  const [manifest, setManifest] = useState<SyncManifest | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncIntervalHours, setSyncIntervalHours] = useState(72);

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

      const { byId, searchable } = buildUnifiedCatalog({
        exoplanets,
        stars,
        constellations,
        satellites,
        deepSpace,
      });

      setCatalogById(byId);
      setSearchableObjects(searchable);
      setManifest(manifestJson);
      if (manifestJson?.syncIntervalHours) {
        setSyncIntervalHours(manifestJson.syncIntervalHours);
      }

      if (sceneRef.current) {
        sceneRef.current.loadDatasets({
          exoplanets,
          stars,
          constellations,
          satellites,
          deepSpace,
          catalogById: byId,
        });
      }
      setLoading(false);
    } catch (err) {
      setLoadError((err as Error).message);
      setLoading(false);
    }
  }, []);

  // Initialize Three.js Multi-Scale Universe Engine
  useEffect(() => {
    if (!viewportRef.current) return;
    const engine = new UniverseScene(viewportRef.current, DEFAULT_LAYERS, DEFAULT_FILTERS, {
      onSelectObject: (id) => {
        setSelectedId(id);
      },
      onMarkersUpdate: (markers) => {
        setHudMarkers(markers);
      },
      onTelemetryUpdate: (snap) => {
        setTelemetry(snap);
      },
    });
    sceneRef.current = engine;
    loadAllUniverseData();

    return () => {
      engine.dispose();
      sceneRef.current = null;
    };
  }, [loadAllUniverseData]);

  // Continual Background Freshness Check on App Mount (checks every 72 hours automatically)
  useEffect(() => {
    if (!IS_LOCAL_DEV_HOST) return;
    fetch('/api/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (s?.manifest) setManifest(s.manifest);
        if (typeof s?.isSyncing === 'boolean') setIsSyncing(s.isSyncing);
        if (s?.syncIntervalHours) setSyncIntervalHours(s.syncIntervalHours);
      })
      .catch(() => {
        // Static mode fallback
      });
  }, []);

  const handleChangeLayers = (next: LayerVisibility) => {
    setLayers(next);
    sceneRef.current?.setLayers(next);
  };

  const handleChangeFilters = (next: UniverseFilters) => {
    setFilters(next);
    sceneRef.current?.setFilters(next);
  };

  const handleResetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    sceneRef.current?.setFilters(DEFAULT_FILTERS);
  };

  const handleOpticalMode = (mode: OpticalMode) => {
    setOpticalMode(mode);
    sceneRef.current?.setOpticalMode(mode);
  };

  const handleTogglePlay = () => {
    const next = !playing;
    setPlaying(next);
    sceneRef.current?.setTimeControls(next, timeScale);
  };

  const handleTimeScale = (scale: number) => {
    setTimeScale(scale);
    sceneRef.current?.setTimeControls(playing, scale);
  };

  const handleResetLive = () => {
    setPlaying(true);
    setTimeScale(1);
    sceneRef.current?.resetToLiveNow();
  };

  const handleSelectAndFly = (id: string) => {
    setSelectedId(id);
    sceneRef.current?.selectObject(id, true);
  };

  const handleSetOrigin = (id: string) => {
    setRouteOriginId(id);
    sceneRef.current?.setRouteOrigin(id);
    setShowRouteCard(true);
  };

  const handleTriggerSync = async (newIntervalHours?: number) => {
    if (newIntervalHours) setSyncIntervalHours(newIntervalHours);
    setIsSyncing(true);
    try {
      if (IS_LOCAL_DEV_HOST) {
        const res = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            force: !newIntervalHours,
            syncIntervalHours: newIntervalHours || syncIntervalHours,
          }),
        });
        const json = await res.json();
        if (json?.manifest) {
          setManifest(json.manifest);
          if (!newIntervalHours) {
            await loadAllUniverseData(true);
          }
        }
      } else {
        // On GitHub Pages, re-fetch latest cloud-synced astronomical bundles with cache-busting
        await loadAllUniverseData(true);
      }
    } catch {
      // Ignore if offline
    } finally {
      setIsSyncing(false);
    }
  };

  const selectedObject = useMemo(
    () => (selectedId ? catalogById.get(selectedId) || null : null),
    [selectedId, catalogById]
  );

  const originObject = useMemo(
    () => catalogById.get(routeOriginId),
    [routeOriginId, catalogById]
  );

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#02050d] text-slate-100 select-none">
      {/* 3D WebGL Multi-Scale Observable Universe Canvas */}
      <div ref={viewportRef} className="absolute inset-0 w-full h-full" />

      {/* Subtle Tactical HUD Corner Reticles (gods-eye-view aesthetic) */}
      <div className="pointer-events-none fixed inset-3 sm:inset-5 z-10 border border-cyan-500/[0.07] rounded-2xl">
        <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-cyan-400/35 rounded-tl-lg" />
        <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-cyan-400/35 rounded-tr-lg" />
        <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-cyan-400/35 rounded-bl-lg" />
        <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-cyan-400/35 rounded-br-lg" />
      </div>

      {/* Projected Clickable 3D Celestial Name Markers */}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {hudMarkers.map((m) => (
          <button
            key={m.id}
            onClick={() => {
              setSelectedId(m.id);
              sceneRef.current?.selectObject(m.id, false);
            }}
            onDoubleClick={() => handleSelectAndFly(m.id)}
            style={{
              transform: `translate3d(${m.x}px, ${m.y}px, 0) translate(-50%, -50%)`,
            }}
            className={`pointer-events-auto absolute top-0 left-0 flex items-center gap-1.5 px-2 py-0.5 rounded-md border backdrop-blur-sm transition hover:scale-105 ${
              m.isHighlighted
                ? 'bg-cyan-950/85 border-cyan-400 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.4)] z-20'
                : m.isZodiac
                  ? 'bg-amber-950/65 border-amber-400/45 text-amber-200 hover:border-amber-300'
                  : 'bg-slate-950/65 border-slate-700/60 text-slate-200 hover:border-cyan-400/70 hover:text-white'
            }`}
            title="Click for Fun Facts & Imagery • Double-click to Fly Here"
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: m.color }}
            />
            <span className="text-[11px] font-medium whitespace-nowrap">{m.name}</span>
            {m.tag && (
              <span className="text-[9px] font-mono px-1 rounded bg-cyan-500/20 text-cyan-300">
                {m.tag}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Top Omnisearch, Scale Indicator, Optical Mode & Sync Bar */}
      <TopTelemetryBar
        searchableObjects={searchableObjects}
        telemetry={telemetry}
        opticalMode={opticalMode}
        onChangeOpticalMode={handleOpticalMode}
        onSelectAndFly={handleSelectAndFly}
        manifest={manifest}
        isSyncing={isSyncing}
        onOpenSyncModal={() => setSyncModalOpen(true)}
        showLeftPanel={showLeftPanel}
        onToggleLeftPanel={() => setShowLeftPanel((v) => !v)}
        showRouteCard={showRouteCard}
        onToggleRouteCard={() => setShowRouteCard((v) => !v)}
      />

      {/* Left Dock: Layers & Multi-Metric Celestial Filters */}
      {showLeftPanel && (
        <div className="pointer-events-none fixed top-24 md:top-16 left-2.5 sm:left-3.5 z-30">
          <LayerAndFilterPanel
            layers={layers}
            onChangeLayers={handleChangeLayers}
            filters={filters}
            onChangeFilters={handleChangeFilters}
            onResetFilters={handleResetFilters}
            matchedCounts={
              telemetry?.matchedCounts || { exoplanets: 0, stars: 0, satellites: 0 }
            }
            onCloseMobile={() => setShowLeftPanel(false)}
          />
        </div>
      )}

      {/* Floating "Google Maps for the Universe" Distance & Travel Route Card */}
      {showRouteCard && (
        <div
          className={`pointer-events-none fixed top-24 md:top-16 z-20 transition-all ${
            selectedObject
              ? 'right-2.5 sm:right-[25.2rem]'
              : 'right-2.5 sm:right-3.5'
          }`}
        >
          <CosmicRouteCard
            originObject={originObject}
            targetObject={selectedObject || undefined}
            originPosLy={telemetry?.originPosLy || [0, 0, 0]}
            targetPosLy={telemetry?.targetPosLy || null}
            searchableObjects={searchableObjects}
            onSetOriginId={handleSetOrigin}
            onSelectTargetId={(id) => {
              setSelectedId(id);
              sceneRef.current?.selectObject(id, false);
            }}
            onFlyTo={(id) => sceneRef.current?.flyToObject(id)}
          />
        </div>
      )}

      {/* Right Drawer: Object Fun Facts, Telemetry & Popular/Recent Telescope Imagery */}
      <ObjectDossierDrawer
        object={selectedObject}
        originObject={originObject}
        objectPosLy={telemetry?.targetPosLy || null}
        originPosLy={telemetry?.originPosLy || [0, 0, 0]}
        onClose={() => {
          setSelectedId(null);
          sceneRef.current?.selectObject(null, false);
        }}
        onFlyTo={(id) => sceneRef.current?.flyToObject(id)}
        onSetAsOrigin={handleSetOrigin}
        onOpen25DImage={(image, spherical) => setModal25D({ image, spherical })}
      />

      {/* Bottom Time Controls, Scale Jumps & Real-Time Solar System Velocity Odometer */}
      <TimeAndVelocityBar
        playing={playing}
        timeScale={timeScale}
        helicalMotion={layers.helicalMotion}
        telemetry={telemetry}
        onTogglePlay={handleTogglePlay}
        onChangeTimeScale={handleTimeScale}
        onResetLive={handleResetLive}
        onToggleHelicalMotion={() =>
          handleChangeLayers({ ...layers, helicalMotion: !layers.helicalMotion })
        }
        onJumpScale={(preset) => sceneRef.current?.jumpToScalePreset(preset)}
      />

      {/* Interactive 2.5D / 3D Telescope Image Perspective Synthesis Modal */}
      <Telescope25DModal
        image={modal25D?.image || null}
        defaultSpherical={modal25D?.spherical ?? true}
        onClose={() => setModal25D(null)}
      />

      {/* Continual Auto-Update & New Planetary Discoveries Modal */}
      <DataSyncModal
        open={syncModalOpen}
        manifest={manifest}
        isSyncing={isSyncing}
        syncIntervalHours={syncIntervalHours}
        onClose={() => setSyncModalOpen(false)}
        onTriggerSync={handleTriggerSync}
        onSelectDiscovery={handleSelectAndFly}
      />

      {/* Initial Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#02050d] gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
          <div className="font-mono text-sm tracking-widest text-cyan-300 uppercase">
            Initializing Observable Universe Telemetry...
          </div>
          <p className="text-xs text-slate-400">
            Loading NASA Exoplanet Archive, HYG 3D Stars, NORAD Satellites & Deep-Sky Catalogs
          </p>
        </div>
      )}

      {/* Error Banner if Data Missing */}
      {loadError && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#02050d]/95 p-6 text-center gap-3">
          <div className="text-red-400 font-mono font-bold text-sm">DATA INITIALIZATION ERROR</div>
          <p className="text-xs text-slate-300 max-w-md">{loadError}</p>
        </div>
      )}
    </div>
  );
};

export default App;
