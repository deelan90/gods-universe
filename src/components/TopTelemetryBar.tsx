import React, { useMemo, useRef, useState } from 'react';
import {
  Search,
  SlidersHorizontal,
  Navigation,
  RefreshCw,
  Sparkles,
  Eye,
  X,
} from 'lucide-react';
import type {
  LayerVisibility,
  OpticalMode,
  SyncManifest,
  UnifiedCelestialObject,
  UniverseFilters,
} from '../types/universe';
import type { SceneTelemetrySnapshot } from '../engine/UniverseScene';

interface Props {
  searchableObjects: UnifiedCelestialObject[];
  telemetry: SceneTelemetrySnapshot | null;
  opticalMode: OpticalMode;
  onChangeOpticalMode: (mode: OpticalMode) => void;
  onSelectAndFly: (id: string) => void;
  manifest: SyncManifest | null;
  isSyncing: boolean;
  onOpenSyncModal: () => void;
  showLeftPanel: boolean;
  onToggleLeftPanel: () => void;
  showRouteCard: boolean;
  onToggleRouteCard: () => void;
  layers: LayerVisibility;
  onChangeLayers: (layers: LayerVisibility) => void;
  filters: UniverseFilters;
  onChangeFilters: (filters: UniverseFilters) => void;
  onResetFilters: () => void;
}

export const TopTelemetryBar: React.FC<Props> = React.memo(
  ({
    searchableObjects,
    telemetry,
    opticalMode,
    onChangeOpticalMode,
    onSelectAndFly,
    manifest,
    isSyncing,
    onOpenSyncModal,
    showLeftPanel,
    onToggleLeftPanel,
    showRouteCard,
    onToggleRouteCard,
    layers,
    onChangeLayers,
    filters,
    onChangeFilters,
    onResetFilters,
  }) => {
    const [query, setQuery] = useState('');
    const [focused, setFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const searchResults = useMemo(() => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const exact: UnifiedCelestialObject[] = [];
      const starts: UnifiedCelestialObject[] = [];
      const contains: UnifiedCelestialObject[] = [];

      for (const item of searchableObjects) {
        const nameL = item.name.toLowerCase();
        const subL = item.subtitle.toLowerCase();
        if (nameL === q) exact.push(item);
        else if (nameL.startsWith(q)) starts.push(item);
        else if (nameL.includes(q) || subL.includes(q)) contains.push(item);
        if (exact.length + starts.length + contains.length > 45) break;
      }
      return [...exact, ...starts, ...contains].slice(0, 12);
    }, [query, searchableObjects]);

    const recentCount = manifest?.recentDiscoveries?.length || 0;
    const isFiltered =
      filters.planetTypes.length > 0 ||
      filters.habitableOnly ||
      filters.recentDiscoveriesOnly ||
      filters.minEarthRadii > 0.1 ||
      filters.maxEarthRadii < 25;

    return (
      <header className="pointer-events-none fixed top-0 inset-x-0 z-30 p-2.5 sm:p-3.5 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          {/* Left: Brand & Scale HUD + Filter Toggle */}
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              onClick={onToggleLeftPanel}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl transition text-xs font-medium ${
                showLeftPanel
                  ? 'bg-cyan-500/25 border border-cyan-400/70 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.28)] backdrop-blur-xl'
                  : 'glass-pill text-slate-200 hover:border-cyan-400/40 hover:text-white'
              }`}
              title="Toggle 3D Layers & Smart Celestial Filters"
            >
              <SlidersHorizontal className="w-4 h-4 text-cyan-400" />
              <span className="hidden sm:inline">Layers & Filters</span>
              {isFiltered && (
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
              )}
            </button>

            <div className="hidden lg:flex items-center gap-3 px-3.5 py-1.5 rounded-xl glass-pill">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-pulse" />
                <span className="font-display text-xs font-bold tracking-wider text-white uppercase">
                  God&apos;s Universe
                </span>
              </div>
              <span className="text-white/15">|</span>
              <div className="font-mono text-[11px] text-cyan-300 tracking-wide">
                {telemetry?.scaleLabel || 'EARTH ORBIT // LEO–GEO'}
              </div>
              {telemetry && (
                <span className="font-mono text-[11px] text-slate-400">
                  {telemetry.cameraSpanLabel}
                </span>
              )}
            </div>
          </div>

          {/* Center: Omnisearch across Planets, 6,400+ Exoplanets, Stars, Satellites, Nebulae & Galaxies */}
          <div className="pointer-events-auto relative flex-1 max-w-md">
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onFocus={() => setFocused(true)}
                onBlur={() => setTimeout(() => setFocused(false), 180)}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Earth, TRAPPIST-1e, ISS, Andromeda, Orion, Sirius..."
                className="w-full pl-9 pr-8 py-2 rounded-xl glass-pill focus:border-cyan-400/75 focus:outline-none text-xs sm:text-sm text-white placeholder:text-slate-400/80 transition"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {focused && searchResults.length > 0 && (
              <div className="animate-panel-in absolute top-full mt-1.5 inset-x-0 rounded-2xl glass-panel overflow-hidden max-h-80 overflow-y-auto z-50">
                {searchResults.map((item) => (
                  <button
                    key={item.id}
                    onMouseDown={() => {
                      onSelectAndFly(item.id);
                      setQuery('');
                      setFocused(false);
                    }}
                    className="w-full px-3.5 py-2.5 text-left hover:bg-cyan-500/15 flex items-center justify-between gap-2 border-b border-white/[0.06] last:border-none transition"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="font-display text-xs sm:text-sm font-semibold text-white truncate">
                          {item.name}
                        </span>
                        {item.isRecent && (
                          <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            NEW
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">{item.subtitle}</p>
                    </div>
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-md bg-white/[0.05] text-slate-300 shrink-0">
                      {item.category}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: Cosmic Route Toggle, Optical Mode & Continual Data Auto-Sync */}
          <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={onToggleRouteCard}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl transition text-xs font-medium ${
                showRouteCard
                  ? 'bg-emerald-500/25 border border-emerald-400/70 text-emerald-100 shadow-[0_0_20px_rgba(52,211,153,0.22)] backdrop-blur-xl'
                  : 'glass-pill text-slate-200 hover:border-emerald-400/40 hover:text-white'
              }`}
              title="Cosmic Distance & Travel Calculator (Google Maps for the Universe)"
            >
              <Navigation className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden md:inline">Cosmic Distance</span>
            </button>

            {/* Optical Sensor Selector */}
            <div className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl glass-pill">
              <Eye className="w-3.5 h-3.5 text-cyan-400 mr-0.5" />
              <select
                value={opticalMode}
                onChange={(e) => onChangeOpticalMode(e.target.value as OpticalMode)}
                className="bg-transparent text-xs font-mono text-slate-200 focus:outline-none cursor-pointer pr-1"
                title="Sensor Optical Filter"
              >
                <option value="true-color" className="bg-slate-950">TRUE COLOR</option>
                <option value="tactical" className="bg-slate-950">TACTICAL HUD</option>
                <option value="infrared" className="bg-slate-950">JWST THERMAL IR</option>
                <option value="deep-field" className="bg-slate-950">DEEP FIELD</option>
              </select>
            </div>

            {/* Live Data Auto-Sync & New Discoveries Pill */}
            <button
              onClick={onOpenSyncModal}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl glass-pill hover:border-cyan-400/50 text-xs transition"
              title="Data Sources, Auto-Sync Schedule & New Planetary Discoveries"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-cyan-400 ${isSyncing ? 'animate-spin' : ''}`}
              />
              <span className="hidden xl:inline text-slate-200 font-medium">Data Sync</span>
              {recentCount > 0 && (
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/40 text-[10px] font-mono text-amber-300">
                  <Sparkles className="w-2.5 h-2.5" />
                  {recentCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Sleek Floating Quick-Filter Chips (Hidden when Left Drawer is open to keep view airy) */}
        {!showLeftPanel && (
          <div className="pointer-events-auto hidden md:flex items-center gap-1.5 self-start">
            <button
              onClick={() =>
                onChangeLayers({ ...layers, constellations: !layers.constellations })
              }
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition ${
                layers.constellations
                  ? 'bg-cyan-500/18 border border-cyan-400/45 text-cyan-200 backdrop-blur-md'
                  : 'glass-pill text-slate-400 hover:text-white'
              }`}
            >
              Constellations
            </button>
            <button
              onClick={() => onChangeLayers({ ...layers, zodiacSigns: !layers.zodiacSigns })}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition ${
                layers.zodiacSigns
                  ? 'bg-amber-500/18 border border-amber-400/45 text-amber-200 backdrop-blur-md'
                  : 'glass-pill text-slate-400 hover:text-white'
              }`}
            >
              Zodiac Signs
            </button>
            <button
              onClick={() =>
                onChangeLayers({ ...layers, habitableZones: !layers.habitableZones })
              }
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition ${
                layers.habitableZones
                  ? 'bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 backdrop-blur-md'
                  : 'glass-pill text-slate-400 hover:text-white'
              }`}
            >
              Habitable Zones
            </button>
            <button
              onClick={() => {
                const active =
                  filters.planetTypes.length === 1 && filters.planetTypes[0] === 'Rocky';
                if (active) onResetFilters();
                else
                  onChangeFilters({
                    ...filters,
                    actionMode: 'isolate',
                    planetTypes: ['Rocky'],
                    minEarthRadii: 0.1,
                    maxEarthRadii: 1.6,
                  });
              }}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition ${
                filters.planetTypes.length === 1 && filters.planetTypes[0] === 'Rocky'
                  ? 'bg-orange-500/25 border border-orange-400/60 text-orange-200 backdrop-blur-md'
                  : 'glass-pill text-slate-400 hover:text-white'
              }`}
            >
              Rocky Worlds
            </button>
            <button
              onClick={() => {
                const active = filters.planetTypes.includes('Gas Giant');
                if (active) onResetFilters();
                else
                  onChangeFilters({
                    ...filters,
                    actionMode: 'isolate',
                    planetTypes: ['Gas Giant', 'Ice Giant'],
                    minEarthRadii: 3.5,
                    maxEarthRadii: 25,
                  });
              }}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition ${
                filters.planetTypes.includes('Gas Giant')
                  ? 'bg-purple-500/25 border border-purple-400/60 text-purple-200 backdrop-blur-md'
                  : 'glass-pill text-slate-400 hover:text-white'
              }`}
            >
              Gas Giants
            </button>
            {isFiltered && (
              <button
                onClick={onResetFilters}
                className="px-2.5 py-1 rounded-full text-[11px] font-mono bg-white/10 hover:bg-white/20 text-white transition"
              >
                Clear Filter ×
              </button>
            )}
          </div>
        )}

        {/* Compact mobile scale banner */}
        <div className="flex lg:hidden items-center justify-between px-3 py-1 rounded-lg glass-pill text-[10px] font-mono text-cyan-300">
          <span className="truncate">{telemetry?.scaleLabel || 'EARTH ORBIT'}</span>
          <span className="text-slate-400 shrink-0 ml-2">{telemetry?.cameraSpanLabel}</span>
        </div>
      </header>
    );
  }
);
