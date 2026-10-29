import React, { useMemo, useState } from 'react';
import {
  Navigation,
  ArrowUpDown,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Rocket,
  Zap,
  Plane,
  Compass,
} from 'lucide-react';
import type { UnifiedCelestialObject } from '../types/universe';
import {
  computeGoogleMapsCosmicTravelTimes,
  distanceBetweenPosLy,
  formatCosmicDistance,
} from '../utils/astronomy';

interface Props {
  originObject: UnifiedCelestialObject | undefined;
  targetObject: UnifiedCelestialObject | undefined;
  originPosLy: [number, number, number];
  targetPosLy: [number, number, number] | null;
  searchableObjects: UnifiedCelestialObject[];
  onSetOriginId: (id: string) => void;
  onSelectTargetId: (id: string) => void;
  onFlyTo: (id: string) => void;
}

export const CosmicRouteCard: React.FC<Props> = ({
  originObject,
  targetObject,
  originPosLy,
  targetPosLy,
  searchableObjects,
  onSetOriginId,
  onSelectTargetId,
  onFlyTo,
}) => {
  const [expanded, setExpanded] = useState(true);
  const [pickingOrigin, setPickingOrigin] = useState(false);
  const [originSearch, setOriginSearch] = useState('');

  const originCandidates = useMemo(() => {
    const q = originSearch.trim().toLowerCase();
    if (!q) {
      return searchableObjects
        .filter((o) =>
          ['earth', 'mars', 'sun', 'moon', 'jupiter', 'jwst', 'voyager-1', 'andromeda'].includes(o.id)
        )
        .slice(0, 8);
    }
    return searchableObjects
      .filter((o) => o.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [originSearch, searchableObjects]);

  const metrics = useMemo(() => {
    if (!targetPosLy || !targetObject || targetObject.id === originObject?.id) {
      return null;
    }
    const d = distanceBetweenPosLy(originPosLy, targetPosLy);
    const formatted = formatCosmicDistance(d.distLy);
    const travel = computeGoogleMapsCosmicTravelTimes(d.distKm);
    return { ...d, formatted, travel };
  }, [originPosLy, targetPosLy, originObject, targetObject]);

  return (
    <div className="pointer-events-auto w-72 sm:w-80 rounded-2xl bg-slate-950/88 border border-slate-800/90 backdrop-blur-xl shadow-2xl overflow-hidden text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-800/80 bg-slate-900/50">
        <div className="flex items-center gap-2">
          <Navigation className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-mono font-semibold tracking-wider text-slate-100 uppercase text-[11px]">
            Cosmic Route // Distance
          </span>
        </div>
        <div className="flex items-center gap-1">
          {originObject?.id !== 'earth' && (
            <button
              onClick={() => onSetOriginId('earth')}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/20 border border-blue-400/40 text-[10px] font-mono text-blue-300 hover:bg-blue-500/30 transition"
              title="Reset default measurement origin back to Earth"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              Earth
            </button>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1 text-slate-400 hover:text-white"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-3.5 space-y-3">
          {/* Origin & Destination ("Google Maps" A -> B) */}
          <div className="relative space-y-2">
            {/* Origin Row */}
            <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-900/80 border border-slate-800">
              <div className="min-w-0">
                <div className="text-[10px] font-mono uppercase text-slate-400">
                  Origin (Measure From)
                </div>
                <button
                  onClick={() => setPickingOrigin((v) => !v)}
                  className="text-left font-medium text-emerald-300 hover:underline truncate block max-w-[180px]"
                  title="Click to change origin point anywhere in the universe"
                >
                  {originObject?.name || 'Earth (Terra)'}
                </button>
              </div>
              <button
                onClick={() => originObject && onFlyTo(originObject.id)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                title="Fly camera to Origin"
              >
                <Compass className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Swap A <-> B Button */}
            {targetObject && targetObject.id !== originObject?.id && (
              <button
                onClick={() => {
                  const prevOrigin = originObject?.id || 'earth';
                  onSetOriginId(targetObject.id);
                  onSelectTargetId(prevOrigin);
                }}
                className="absolute right-10 top-[34px] z-10 p-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300 hover:text-cyan-300 hover:border-cyan-400 transition"
                title="Swap Origin & Destination"
              >
                <ArrowUpDown className="w-3 h-3" />
              </button>
            )}

            {/* Origin Picker Dropdown */}
            {pickingOrigin && (
              <div className="p-2 rounded-xl bg-slate-900 border border-cyan-500/40 space-y-1.5">
                <input
                  type="text"
                  value={originSearch}
                  onChange={(e) => setOriginSearch(e.target.value)}
                  placeholder="Type any planet, star, galaxy..."
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-cyan-400"
                  autoFocus
                />
                <div className="max-h-36 overflow-y-auto space-y-0.5">
                  {originCandidates.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        onSetOriginId(c.id);
                        setPickingOrigin(false);
                        setOriginSearch('');
                      }}
                      className="w-full text-left px-2 py-1 rounded hover:bg-cyan-500/15 text-slate-200 flex items-center justify-between"
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="text-[10px] font-mono text-slate-500 ml-2">{c.category}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Destination Row */}
            <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-900/80 border border-slate-800">
              <div className="min-w-0">
                <div className="text-[10px] font-mono uppercase text-slate-400">
                  Destination (Selected Target)
                </div>
                <div className="font-medium text-cyan-300 truncate max-w-[180px]">
                  {targetObject ? targetObject.name : 'Click any object...'}
                </div>
              </div>
              {targetObject && (
                <button
                  onClick={() => onFlyTo(targetObject.id)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300"
                  title="Fly camera to Destination"
                >
                  <Compass className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Live Distance & Travel Readout */}
          {metrics ? (
            <div className="space-y-2.5 pt-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-cyan-500/15 to-emerald-500/10 border border-cyan-400/30">
                <div className="text-[10px] font-mono uppercase text-cyan-300/80">
                  Live Point-to-Point 3D Distance
                </div>
                <div className="text-lg font-bold font-mono text-white mt-0.5">
                  {metrics.formatted.primary}
                </div>
                <div className="text-[11px] font-mono text-slate-300">
                  {metrics.formatted.secondary}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  Estimated Travel Time
                </div>
                {metrics.travel.map((t, idx) => (
                  <div
                    key={t.mode}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900/70 border border-slate-800/70"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {idx === 0 ? (
                        <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      ) : idx === 3 ? (
                        <Plane className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      ) : (
                        <Rocket className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      )}
                      <div className="truncate">
                        <div className="text-[11px] text-slate-200 truncate">{t.mode}</div>
                        <div className="text-[9px] font-mono text-slate-500">{t.speedLabel}</div>
                      </div>
                    </div>
                    <span className="font-mono font-semibold text-[11px] text-emerald-300 shrink-0 ml-2">
                      {t.duration}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 text-[11px] text-slate-400 leading-relaxed">
              Pinned to <span className="text-emerald-300 font-medium">{originObject?.name || 'Earth'}</span>. Click any planet, exoplanet, star, satellite, nebula, or galaxy in 3D space to measure live cosmic distance & travel time!
            </div>
          )}
        </div>
      )}
    </div>
  );
};
