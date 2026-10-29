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
  OpticalMode,
  SyncManifest,
  UnifiedCelestialObject,
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
}

export const TopTelemetryBar: React.FC<Props> = ({
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

  return (
    <header className="pointer-events-none fixed top-0 inset-x-0 z-30 p-2.5 sm:p-3.5 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        {/* Left: Brand & Scale HUD + Filter Toggle */}
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            onClick={onToggleLeftPanel}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border backdrop-blur-md transition text-xs font-medium ${
              showLeftPanel
                ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200 shadow-[0_0_20px_rgba(34,211,238,0.2)]'
                : 'bg-slate-950/80 border-slate-800/90 text-slate-200 hover:border-slate-700'
            }`}
            title="Toggle Layers & Celestial Filters"
          >
            <SlidersHorizontal className="w-4 h-4 text-cyan-400" />
            <span className="hidden sm:inline">Layers & Filters</span>
          </button>

          <div className="hidden md:flex items-center gap-3 px-3.5 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800/90 backdrop-blur-md">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <span className="font-mono text-xs font-bold tracking-widest text-white">
                GOD&apos;S UNIVERSE
              </span>
            </div>
            <span className="text-slate-700">|</span>
            <div className="font-mono text-[11px] text-cyan-300 tracking-wider">
              {telemetry?.scaleLabel || 'EARTH ORBIT // LEO–GEO'}
            </div>
            {telemetry && (
              <span className="font-mono text-[11px] text-slate-400">
                FOV Span: {telemetry.cameraSpanLabel}
              </span>
            )}
          </div>
        </div>

        {/* Center: Omnisearch across Planets, 6,400+ Exoplanets, Stars, Satellites, Nebulae & Galaxies */}
        <div className="pointer-events-auto relative flex-1 max-w-md">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 180)}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Earth, TRAPPIST-1e, ISS, Andromeda, Orion, Sirius..."
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-950/85 border border-slate-800/90 focus:border-cyan-400/70 focus:outline-none text-xs sm:text-sm text-white placeholder:text-slate-500 backdrop-blur-md transition"
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
            <div className="absolute top-full mt-1.5 inset-x-0 rounded-xl bg-slate-950/95 border border-slate-800 shadow-2xl backdrop-blur-xl overflow-hidden max-h-80 overflow-y-auto z-50">
              {searchResults.map((item) => (
                <button
                  key={item.id}
                  onMouseDown={() => {
                    onSelectAndFly(item.id);
                    setQuery('');
                    setFocused(false);
                  }}
                  className="w-full px-3.5 py-2.5 text-left hover:bg-cyan-500/15 flex items-center justify-between gap-2 border-b border-slate-900/80 last:border-none transition"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-xs sm:text-sm font-medium text-white truncate">
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
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-900 text-slate-300 shrink-0">
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
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl border backdrop-blur-md transition text-xs font-medium ${
              showRouteCard
                ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200'
                : 'bg-slate-950/80 border-slate-800/90 text-slate-300 hover:text-white'
            }`}
            title="Cosmic Distance & Travel Calculator (Google Maps for the Universe)"
          >
            <Navigation className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden lg:inline">Cosmic Distance</span>
          </button>

          {/* Optical Sensor Selector (inspired by gods-eye-view) */}
          <div className="hidden sm:flex items-center gap-1 px-2 py-1.5 rounded-xl bg-slate-950/80 border border-slate-800/90 backdrop-blur-md">
            <Eye className="w-3.5 h-3.5 text-cyan-400 ml-1 mr-0.5" />
            <select
              value={opticalMode}
              onChange={(e) => onChangeOpticalMode(e.target.value as OpticalMode)}
              className="bg-transparent text-xs font-mono text-slate-200 focus:outline-none cursor-pointer pr-1"
              title="Sensor Optical Filter"
            >
              <option value="true-color" className="bg-slate-950">OPTIC: TRUE COLOR</option>
              <option value="tactical" className="bg-slate-950">OPTIC: TACTICAL HUD</option>
              <option value="infrared" className="bg-slate-950">OPTIC: JWST THERMAL IR</option>
              <option value="deep-field" className="bg-slate-950">OPTIC: DEEP FIELD</option>
            </select>
          </div>

          {/* Live Data Auto-Sync & New Discoveries Pill */}
          <button
            onClick={onOpenSyncModal}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl bg-slate-950/85 border border-slate-800/90 hover:border-cyan-400/50 backdrop-blur-md text-xs transition"
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

      {/* Compact mobile scale banner */}
      <div className="flex md:hidden items-center justify-between px-3 py-1 rounded-lg bg-slate-950/75 border border-slate-800/80 backdrop-blur-md text-[10px] font-mono text-cyan-300">
        <span className="truncate">{telemetry?.scaleLabel || 'EARTH ORBIT'}</span>
        <span className="text-slate-400 shrink-0 ml-2">{telemetry?.cameraSpanLabel}</span>
      </div>
    </header>
  );
};
