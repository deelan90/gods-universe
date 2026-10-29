import React, { useState } from 'react';
import {
  Layers,
  Filter,
  Sparkles,
  RotateCcw,
  Sun,
  Globe,
  Satellite,
  X,
} from 'lucide-react';
import type {
  FilterActionMode,
  LayerVisibility,
  PlanetComposition,
  UniverseFilters,
} from '../types/universe';

interface Props {
  layers: LayerVisibility;
  onChangeLayers: (layers: LayerVisibility) => void;
  filters: UniverseFilters;
  onChangeFilters: (filters: UniverseFilters) => void;
  onResetFilters: () => void;
  matchedCounts: { exoplanets: number; stars: number; satellites: number };
  onCloseMobile?: () => void;
}

const PLANET_TYPES: PlanetComposition[] = [
  'Rocky',
  'Super-Earth',
  'Ice Giant',
  'Gas Giant',
  'Lava World',
];

const SPECTRAL_CLASSES = ['O', 'B', 'A', 'F', 'G', 'K', 'M'];

export const LayerAndFilterPanel: React.FC<Props> = React.memo(
  ({
    layers,
    onChangeLayers,
    filters,
    onChangeFilters,
    onResetFilters,
    matchedCounts,
    onCloseMobile,
  }) => {
    const [activeTab, setActiveTab] = useState<'layers' | 'filters'>('layers');

    const toggleLayer = (key: keyof LayerVisibility) => {
      onChangeLayers({ ...layers, [key]: !layers[key] });
    };

    const togglePlanetType = (t: PlanetComposition) => {
      const exists = filters.planetTypes.includes(t);
      const next = exists
        ? filters.planetTypes.filter((x) => x !== t)
        : [...filters.planetTypes, t];
      onChangeFilters({ ...filters, planetTypes: next });
    };

    const toggleSpectral = (s: string) => {
      const exists = filters.starSpectralClasses.includes(s);
      const next = exists
        ? filters.starSpectralClasses.filter((x) => x !== s)
        : [...filters.starSpectralClasses, s];
      onChangeFilters({ ...filters, starSpectralClasses: next });
    };

    return (
      <aside className="pointer-events-auto animate-panel-in w-80 max-w-[92vw] max-h-[calc(100vh-155px)] flex flex-col rounded-2xl glass-panel overflow-hidden text-xs">
        {/* Tab Switcher */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2.5 border-b border-white/10 bg-white/[0.02]">
          <div className="grid grid-cols-2 gap-1.5 flex-1">
            <button
              onClick={() => setActiveTab('layers')}
              className={`flex items-center justify-center gap-1.5 py-1.5 rounded-xl font-medium transition ${
                activeTab === 'layers'
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50'
                  : 'text-slate-400 hover:text-white bg-white/[0.03]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              View Layers
            </button>
            <button
              onClick={() => setActiveTab('filters')}
              className={`flex items-center justify-center gap-1.5 py-1.5 rounded-xl font-medium transition ${
                activeTab === 'filters'
                  ? 'bg-purple-500/20 text-purple-200 border border-purple-400/50'
                  : 'text-slate-400 hover:text-white bg-white/[0.03]'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              Smart Filters
            </button>
          </div>
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="ml-2 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
              title="Close Panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
          {activeTab === 'layers' ? (
            <div className="space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1">
                Toggle 3D Observatory Overlays
              </div>

              {(
                [
                  ['satellites', 'Live Earth Satellites (NORAD SGP4)', '458 active LEO/MEO/GEO spacecraft'],
                  ['planetOrbits', 'Solar System Orbital Paths', '3D J2000 elliptical trajectories'],
                  ['constellations', '88 IAU Constellations (3D)', 'True 3D Hipparcos star stick vectors'],
                  ['zodiacSigns', '12 Zodiac Star Signs & Ecliptic', '♈–♓ star signs & ecliptic ring'],
                  ['habitableZones', 'Star Habitable Zones (Goldilocks)', 'Liquid-water orbital rings around stars'],
                  ['exoplanets', 'NASA Confirmed Exoplanets', '6,400+ worlds from Caltech TAP archive'],
                  ['deepSpace', '2.5D Telescope Nebulae & Galaxies', 'JWST, Hubble & EHT 3D-perspective models'],
                  ['cosmicWeb', 'Milky Way, Cosmic Web & CMB', 'Spiral arms, filaments & 46.5 Gly horizon'],
                  ['helicalMotion', 'Solar System Velocity & Vortex Trail', 'Real-time 230 km/s galactic corkscrew'],
                  ['labels', 'Interactive Name Markers', 'Zero-lag 120Hz HUD telemetry labels'],
                  ['trueScaleBodies', 'Strict 1:1 Planet Radii', 'Disable adaptive readable size boost'],
                ] as [keyof LayerVisibility, string, string][]
              ).map(([key, title, desc]) => (
                <label
                  key={key}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.07] cursor-pointer transition"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-100">{title}</div>
                    <div className="text-[10px] text-slate-400 truncate mt-0.5">{desc}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={layers[key]}
                    onChange={() => toggleLayer(key)}
                    className="w-4 h-4 accent-cyan-400 rounded cursor-pointer shrink-0"
                  />
                </label>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Filter Action Mode & Reset */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    Filter Behavior
                  </span>
                  <button
                    onClick={onResetFilters}
                    className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset All
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      ['isolate', 'Filter Out'],
                      ['highlight', 'Highlight'],
                      ['color-group', 'Group Color'],
                    ] as [FilterActionMode, string][]
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      onClick={() => onChangeFilters({ ...filters, actionMode: mode })}
                      className={`py-1.5 rounded-lg text-[11px] font-medium border transition ${
                        filters.actionMode === mode
                          ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                          : 'bg-white/[0.03] border-white/10 text-slate-400 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* One-Click Presets */}
              <div className="space-y-1.5">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  Quick Discovery Presets
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() =>
                      onChangeFilters({
                        ...filters,
                        planetTypes: ['Rocky'],
                        minEarthRadii: 0.1,
                        maxEarthRadii: 1.6,
                        habitableOnly: false,
                      })
                    }
                    className="px-2.5 py-1 rounded-lg bg-orange-500/15 border border-orange-400/40 text-orange-200 hover:bg-orange-500/25 transition"
                  >
                    Rocky Planets
                  </button>
                  <button
                    onClick={() =>
                      onChangeFilters({
                        ...filters,
                        planetTypes: ['Gas Giant', 'Ice Giant'],
                        minEarthRadii: 3.5,
                        maxEarthRadii: 25,
                        habitableOnly: false,
                      })
                    }
                    className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-400/40 text-amber-200 hover:bg-amber-500/25 transition"
                  >
                    Gas & Ice Giants
                  </button>
                  <button
                    onClick={() =>
                      onChangeFilters({
                        ...filters,
                        planetTypes: ['Rocky', 'Super-Earth'],
                        minEarthRadii: 0.5,
                        maxEarthRadii: 2.2,
                        habitableOnly: true,
                      })
                    }
                    className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/25 transition"
                  >
                    Habitable Earth-Likes
                  </button>
                  <button
                    onClick={() =>
                      onChangeFilters({
                        ...filters,
                        recentDiscoveriesOnly: !filters.recentDiscoveriesOnly,
                      })
                    }
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border transition ${
                      filters.recentDiscoveriesOnly
                        ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200'
                        : 'bg-white/[0.03] border-white/10 text-slate-300'
                    }`}
                  >
                    <Sparkles className="w-3 h-3 text-amber-400" />
                    New Discoveries
                  </button>
                </div>
              </div>

              {/* Planets & Exoplanets Metrics */}
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-display font-semibold text-slate-100">
                    <Globe className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Planets & Exoplanets</span>
                  </div>
                  <span className="font-mono text-[11px] text-cyan-300">
                    {matchedCounts.exoplanets.toLocaleString()} matched
                  </span>
                </div>

                {/* Composition Chips */}
                <div className="flex flex-wrap gap-1">
                  {PLANET_TYPES.map((t) => {
                    const active = filters.planetTypes.includes(t);
                    return (
                      <button
                        key={t}
                        onClick={() => togglePlanetType(t)}
                        className={`px-2 py-1 rounded-md text-[11px] border transition ${
                          active
                            ? 'bg-cyan-500/25 border-cyan-400 text-white'
                            : 'bg-slate-950/70 border-white/10 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>

                {/* Size Multiplier vs Earth (× R⊕) */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] font-mono">
                    <span className="text-slate-400">Size vs. Earth:</span>
                    <span className="text-cyan-300">
                      {filters.minEarthRadii.toFixed(1)}× –{' '}
                      {filters.maxEarthRadii >= 25
                        ? '25×+ R⊕'
                        : `${filters.maxEarthRadii.toFixed(1)}× R⊕`}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Min × Earth</span>
                      <input
                        type="range"
                        min={0.1}
                        max={20}
                        step={0.1}
                        value={filters.minEarthRadii}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          onChangeFilters({
                            ...filters,
                            minEarthRadii: Math.min(v, filters.maxEarthRadii),
                          });
                        }}
                        className="w-full accent-cyan-400"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Max × Earth</span>
                      <input
                        type="range"
                        min={0.5}
                        max={25}
                        step={0.5}
                        value={filters.maxEarthRadii}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          onChangeFilters({
                            ...filters,
                            maxEarthRadii: Math.max(v, filters.minEarthRadii),
                          });
                        }}
                        className="w-full accent-cyan-400"
                      />
                    </div>
                  </div>
                  <div className="flex gap-1 pt-0.5">
                    {[
                      ['~1× Earth', 0.7, 1.4],
                      ['2×–5× Earth', 2.0, 5.0],
                      ['5×–15× Giants', 5.0, 15.0],
                    ].map(([lbl, mn, mx]) => (
                      <button
                        key={lbl as string}
                        onClick={() =>
                          onChangeFilters({
                            ...filters,
                            minEarthRadii: mn as number,
                            maxEarthRadii: mx as number,
                          })
                        }
                        className="flex-1 py-1 rounded bg-slate-950/80 border border-white/10 hover:border-cyan-400/50 text-[10px] text-slate-300"
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Habitable Zone & Discovery Observatory */}
                <label className="flex items-center justify-between pt-1 cursor-pointer">
                  <span className="text-slate-300">Inside Habitable Zone Only</span>
                  <input
                    type="checkbox"
                    checked={filters.habitableOnly}
                    onChange={(e) =>
                      onChangeFilters({ ...filters, habitableOnly: e.target.checked })
                    }
                    className="w-4 h-4 accent-emerald-400"
                  />
                </label>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Telescope:</span>
                  <select
                    value={filters.discoveryFacility}
                    onChange={(e) =>
                      onChangeFilters({ ...filters, discoveryFacility: e.target.value })
                    }
                    className="bg-slate-950 border border-white/10 rounded-lg px-2 py-1 text-slate-200 focus:outline-none"
                  >
                    <option value="ALL">All Observatories</option>
                    <option value="Webb">JWST (James Webb)</option>
                    <option value="TESS">NASA TESS</option>
                    <option value="Kepler">Kepler / K2</option>
                    <option value="La Silla">ESO / HARPS</option>
                  </select>
                </div>
              </div>

              {/* Stars Filter & Habitable Zones */}
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-display font-semibold text-slate-100">
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                    <span>Stars & Habitable Zones</span>
                  </div>
                  <span className="font-mono text-[11px] text-amber-300">
                    {matchedCounts.stars.toLocaleString()} stars
                  </span>
                </div>

                <label className="flex items-center justify-between p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 cursor-pointer">
                  <span className="text-emerald-200 font-medium">Show 3D Star Habitable Zones</span>
                  <input
                    type="checkbox"
                    checked={layers.habitableZones}
                    onChange={() => toggleLayer('habitableZones')}
                    className="w-4 h-4 accent-emerald-400"
                  />
                </label>

                {/* Star Size Range (× R☉) */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-mono">
                    <span className="text-slate-400">Star Radius:</span>
                    <span className="text-amber-300">
                      {filters.minStarSolarRadii.toFixed(1)} –{' '}
                      {filters.maxStarSolarRadii >= 1000
                        ? '1000+ R☉'
                        : `${filters.maxStarSolarRadii} R☉`}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {[
                      ['All', 0.08, 1000],
                      ['Dwarfs', 0.08, 0.7],
                      ['Sun-like', 0.7, 1.6],
                      ['Giants', 8, 1000],
                    ].map(([lbl, mn, mx]) => (
                      <button
                        key={lbl as string}
                        onClick={() =>
                          onChangeFilters({
                            ...filters,
                            minStarSolarRadii: mn as number,
                            maxStarSolarRadii: mx as number,
                          })
                        }
                        className="flex-1 py-1 rounded bg-slate-950/80 border border-white/10 hover:border-amber-400/50 text-[10px] text-slate-300"
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Spectral Class O B A F G K M */}
                <div>
                  <div className="text-[10px] text-slate-400 mb-1">
                    Spectral Class (Hot O → Cool M):
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {SPECTRAL_CLASSES.map((s) => {
                      const active = filters.starSpectralClasses.includes(s);
                      return (
                        <button
                          key={s}
                          onClick={() => toggleSpectral(s)}
                          className={`py-1 rounded font-mono font-bold border transition ${
                            active
                              ? 'bg-amber-500/25 border-amber-400 text-amber-200'
                              : 'bg-slate-950/80 border-white/10 text-slate-400 hover:text-white'
                          }`}
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Satellites & Deep Space Category Filters */}
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-2.5">
                <div className="flex items-center gap-1.5 font-display font-semibold text-slate-100">
                  <Satellite className="w-3.5 h-3.5 text-purple-400" />
                  <span>Satellites & Deep-Sky Objects</span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Satellites:</span>
                  <select
                    value={filters.satelliteCategory}
                    onChange={(e) =>
                      onChangeFilters({ ...filters, satelliteCategory: e.target.value })
                    }
                    className="bg-slate-950 border border-white/10 rounded-lg px-2 py-1 text-slate-200 focus:outline-none max-w-[165px]"
                  >
                    <option value="ALL">All ({matchedCounts.satellites})</option>
                    <option value="Space Station">Space Stations (ISS/CSS)</option>
                    <option value="Space Telescope / Science">Space Telescopes</option>
                    <option value="GPS / Navigation (MEO)">GPS Navigation</option>
                    <option value="Starlink Megaconstellation">Starlink LEO</option>
                    <option value="Weather / Earth Obs">Weather Satellites</option>
                    <option value="Bright LEO Satellite">Bright Visual LEO</option>
                  </select>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Deep Space:</span>
                  <select
                    value={filters.deepSpaceCategory}
                    onChange={(e) =>
                      onChangeFilters({ ...filters, deepSpaceCategory: e.target.value })
                    }
                    className="bg-slate-950 border border-white/10 rounded-lg px-2 py-1 text-slate-200 focus:outline-none max-w-[165px]"
                  >
                    <option value="ALL">All Deep-Space Objects</option>
                    <option value="nebula">Nebulae & Nurseries</option>
                    <option value="galaxy">Galaxies</option>
                    <option value="black-hole">Black Holes & Quasars</option>
                    <option value="cluster">Star Clusters</option>
                    <option value="spacecraft">Deep-Space Probes</option>
                    <option value="cosmic-structure">Superclusters & Voids</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    );
  }
);
