import React from 'react';
import { Search, Eye, Compass, Move, Home } from 'lucide-react';
import type { LayerVisibility, OpticalMode, UniverseFilters } from '../types/universe';
import type { SceneTelemetrySnapshot } from '../engine/UniverseScene';

export type ScalePreset =
  | 'earth-orbit'
  | 'solar-system'
  | 'interstellar'
  | 'milky-way'
  | 'local-group'
  | 'superclusters'
  | 'observable-universe';

interface Props {
  telemetry: SceneTelemetrySnapshot | null;
  opticalMode: OpticalMode;
  onChangeOpticalMode: (mode: OpticalMode) => void;
  onOpenSearch: () => void;
  showChips: boolean;
  onToggleFreeRoam: () => void;
  onHopGalaxy: () => void;
  onHome: () => void;
  layers: LayerVisibility;
  onChangeLayers: (layers: LayerVisibility) => void;
  filters: UniverseFilters;
  onChangeFilters: (filters: UniverseFilters) => void;
  onResetFilters: () => void;
  onJumpScale: (preset: ScalePreset) => void;
  mobileNav: React.ReactNode;
}

const OPTICAL_MODES: { value: OpticalMode; label: string }[] = [
  { value: 'true-color', label: 'True colour' },
  { value: 'apod-platesolve', label: 'Star-chart overlay' },
  { value: 'apod-sho', label: 'Hubble palette' },
  { value: 'infrared', label: 'Infrared (JWST)' },
  { value: 'deep-field', label: 'Deep field' },
  { value: 'tactical', label: 'Tactical HUD' },
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export const TopTelemetryBar: React.FC<Props> = React.memo(
  ({
    telemetry,
    opticalMode,
    onChangeOpticalMode,
    onOpenSearch,
    showChips,
    onToggleFreeRoam,
    onHopGalaxy,
    onHome,
    layers,
    onChangeLayers,
    filters,
    onChangeFilters,
    onResetFilters,
    onJumpScale,
    mobileNav,
  }) => {
    const isFiltered =
      filters.planetTypes.length > 0 ||
      filters.habitableOnly ||
      filters.recentDiscoveriesOnly ||
      filters.minEarthRadii > 0.1 ||
      filters.maxEarthRadii < 25 ||
      filters.deepSpaceCategory !== 'ALL';

    const chip = (active: boolean, color: string) =>
      `shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition border ${
        active ? 'text-white' : 'glass-pill text-slate-300 hover:text-white border-transparent'
      }`;
    const chipStyle = (active: boolean, color: string): React.CSSProperties | undefined =>
      active ? { backgroundColor: `${color}2e`, borderColor: `${color}aa` } : undefined;

    const deepPreset = (cat: 'nebula' | 'galaxy', scale: ScalePreset) => {
      if (filters.deepSpaceCategory === cat) onResetFilters();
      else {
        onChangeFilters({ ...filters, actionMode: 'isolate', deepSpaceCategory: cat });
        onJumpScale(scale);
      }
    };

    const rocky = filters.planetTypes.length === 1 && filters.planetTypes[0] === 'Rocky';
    const giants = filters.planetTypes.includes('Gas Giant');

    return (
      <header className="pointer-events-none fixed top-0 inset-x-0 z-30 p-2.5 sm:p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {/* Brand + where-am-I readout */}
          <div className="pointer-events-auto hidden md:flex items-center gap-2.5 px-3 py-2 rounded-xl glass-pill min-w-0">
            <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] shrink-0" />
            <span className="font-display text-xs font-bold tracking-wider text-white uppercase whitespace-nowrap">
              God&apos;s Universe
            </span>
            <span className="text-white/15">|</span>
            <span className="font-mono text-[11px] text-cyan-300 truncate max-w-[16rem]" title="Current zoom level">
              {telemetry?.scaleLabel || 'EARTH ORBIT'}
            </span>
            {telemetry && (
              <span className="hidden lg:inline font-mono text-[11px] text-slate-400 whitespace-nowrap" title="Width of the current view">
                {telemetry.cameraSpanLabel}
              </span>
            )}
          </div>

          {/* Search trigger — opens the command palette */}
          <button
            onClick={onOpenSearch}
            className="pointer-events-auto flex-1 md:max-w-md md:mx-auto flex items-center gap-2.5 pl-3.5 pr-2 py-2 rounded-xl glass-pill hover:border-cyan-400/50 text-left transition group min-w-0"
            aria-label="Search the universe"
          >
            <Search className="w-4 h-4 text-cyan-300 shrink-0" />
            <span className="flex-1 text-[13px] text-slate-400 group-hover:text-slate-200 truncate">
              Search planets, stars, spacecraft…
            </span>
            <kbd className="hidden sm:inline px-1.5 py-0.5 rounded-md bg-white/[0.08] font-mono text-[10px] text-slate-400 shrink-0">
              {isMac ? '⌘K' : 'Ctrl K'}
            </kbd>
          </button>

          {/* View style */}
          <label className="pointer-events-auto hidden sm:flex items-center gap-1.5 px-2.5 py-2 rounded-xl glass-pill" title="Change how the sky is rendered">
            <Eye className="w-3.5 h-3.5 text-cyan-400" />
            <span className="sr-only">View style</span>
            <select
              value={opticalMode}
              onChange={(e) => onChangeOpticalMode(e.target.value as OpticalMode)}
              className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer"
            >
              {OPTICAL_MODES.map((m) => (
                <option key={m.value} value={m.value} className="bg-slate-950">
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Mobile: tool icons */}
        <div className="md:hidden flex items-center gap-2">
          {mobileNav}
          <div className="ml-auto pointer-events-auto px-2.5 py-1.5 rounded-xl glass-pill font-mono text-[10px] text-cyan-300 max-w-[42%] truncate">
            {telemetry?.scaleLabel || 'EARTH ORBIT'}
          </div>
        </div>

        {/* Quick navigation & filter chips — one line, scrolls sideways */}
        {showChips && (
          <div className="pointer-events-auto hidden md:flex items-center gap-1.5 overflow-x-auto no-scrollbar mask-fade-right">
            <button
              onClick={onHome}
              className={chip(false, '#22d3ee')}
              title="Fly back to Earth (H)"
            >
              <span className="flex items-center gap-1">
                <Home className="w-3 h-3 text-cyan-300" /> Earth
              </span>
            </button>
            <button
              onClick={onToggleFreeRoam}
              className={chip(Boolean(telemetry?.freeRoamDragMode || telemetry?.isFreeRoam), '#34d399')}
              style={chipStyle(Boolean(telemetry?.freeRoamDragMode || telemetry?.isFreeRoam), '#34d399')}
              title="Unlock the camera and roam freely (or right-drag anytime)"
            >
              <span className="flex items-center gap-1">
                <Move className="w-3 h-3 text-emerald-400" />
                {telemetry?.freeRoamDragMode
                  ? 'Free roam: drag to pan'
                  : telemetry?.isFreeRoam
                    ? 'Free roaming'
                    : `Following ${telemetry?.anchorName || 'Earth'}`}
              </span>
            </button>
            <button onClick={onHopGalaxy} className={chip(false, '#818cf8')} title="Warp to a random galaxy (G)">
              <span className="flex items-center gap-1">
                <Compass className="w-3 h-3 text-indigo-300" /> Random galaxy
              </span>
            </button>

            <span className="shrink-0 w-px h-4 bg-white/15 mx-1" />

            <button
              onClick={() => deepPreset('nebula', 'milky-way')}
              className={chip(filters.deepSpaceCategory === 'nebula', '#fb7185')}
              style={chipStyle(filters.deepSpaceCategory === 'nebula', '#fb7185')}
            >
              Nebulae
            </button>
            <button
              onClick={() => deepPreset('galaxy', 'local-group')}
              className={chip(filters.deepSpaceCategory === 'galaxy', '#818cf8')}
              style={chipStyle(filters.deepSpaceCategory === 'galaxy', '#818cf8')}
            >
              Galaxies
            </button>
            <button
              onClick={() =>
                rocky
                  ? onResetFilters()
                  : onChangeFilters({ ...filters, actionMode: 'isolate', planetTypes: ['Rocky'], minEarthRadii: 0.1, maxEarthRadii: 1.6 })
              }
              className={chip(rocky, '#fb923c')}
              style={chipStyle(rocky, '#fb923c')}
            >
              Rocky worlds
            </button>
            <button
              onClick={() =>
                giants
                  ? onResetFilters()
                  : onChangeFilters({
                      ...filters,
                      actionMode: 'isolate',
                      planetTypes: ['Gas Giant', 'Ice Giant'],
                      minEarthRadii: 3.5,
                      maxEarthRadii: 25,
                    })
              }
              className={chip(giants, '#c084fc')}
              style={chipStyle(giants, '#c084fc')}
            >
              Gas giants
            </button>
            <button
              onClick={() => onChangeLayers({ ...layers, habitableZones: !layers.habitableZones })}
              className={chip(layers.habitableZones, '#34d399')}
              style={chipStyle(layers.habitableZones, '#34d399')}
            >
              Habitable zones
            </button>
            <button
              onClick={() => onChangeLayers({ ...layers, constellations: !layers.constellations })}
              className={chip(layers.constellations, '#22d3ee')}
              style={chipStyle(layers.constellations, '#22d3ee')}
            >
              Constellations
            </button>
            <button
              onClick={() => onChangeLayers({ ...layers, zodiacSigns: !layers.zodiacSigns })}
              className={chip(layers.zodiacSigns, '#fbbf24')}
              style={chipStyle(layers.zodiacSigns, '#fbbf24')}
            >
              Zodiac
            </button>
            {isFiltered && (
              <button
                onClick={onResetFilters}
                className="shrink-0 px-2.5 py-1 rounded-full text-[11px] bg-white/15 hover:bg-white/25 text-white transition"
              >
                Clear filter ×
              </button>
            )}
          </div>
        )}
      </header>
    );
  }
);
