import React, { useMemo, useState } from 'react';
import {
  Navigation,
  ArrowUpDown,
  RotateCcw,
  Rocket,
  Zap,
  Plane,
  Compass,
  X,
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
  onClose?: () => void;
}

export const CosmicRouteCard: React.FC<Props> = React.memo(
  ({
    originObject,
    targetObject,
    originPosLy,
    targetPosLy,
    searchableObjects,
    onSetOriginId,
    onSelectTargetId,
    onFlyTo,
    onClose,
  }) => {
    const [pickingOrigin, setPickingOrigin] = useState(false);
    const [originSearch, setOriginSearch] = useState('');

    const originCandidates = useMemo(() => {
      const q = originSearch.trim().toLowerCase();
      if (!q) {
        return searchableObjects
          .filter((o) =>
            ['earth', 'mars', 'sun', 'moon', 'jupiter', 'jwst', 'voyager-1', 'andromeda'].includes(
              o.id
            )
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
      <div className="pointer-events-auto animate-panel-in w-72 sm:w-80 rounded-2xl glass-panel overflow-hidden text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Navigation className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-display font-semibold tracking-wide text-slate-100 text-xs">
              Cosmic Route & Distance
            </span>
          </div>
          <div className="flex items-center gap-1">
            {originObject?.id !== 'earth' && (
              <button
                onClick={() => onSetOriginId('earth')}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/20 border border-blue-400/40 text-[10px] font-mono text-blue-300 hover:bg-blue-500/30 transition"
                title="Reset default measurement origin back to Earth"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                Earth
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="p-3.5 space-y-3">
          {/* Origin & Destination ("Google Maps" A -> B) */}
          <div className="relative space-y-2">
            {/* Origin Row */}
            <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="min-w-0">
                <div className="text-[10px] font-mono uppercase text-slate-400">
                  Origin (Measure From)
                </div>
                <button
                  onClick={() => setPickingOrigin((v) => !v)}
                  className="text-left font-display font-semibold text-emerald-300 hover:underline truncate block max-w-[180px]"
                  title="Click to change origin point anywhere in the universe"
                >
                  {originObject?.name || 'Earth (Terra)'}
                </button>
              </div>
              <button
                onClick={() => originObject && onFlyTo(originObject.id)}
                className="p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 transition"
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
                className="absolute right-10 top-[36px] z-10 p-1 rounded-full bg-slate-900 border border-white/15 text-slate-300 hover:text-cyan-300 hover:border-cyan-400 transition"
                title="Swap Origin & Destination"
              >
                <ArrowUpDown className="w-3 h-3" />
              </button>
            )}

            {/* Origin Picker Dropdown */}
            {pickingOrigin && (
              <div className="p-2 rounded-xl bg-slate-950/95 border border-cyan-500/40 space-y-1.5">
                <input
                  type="text"
                  value={originSearch}
                  onChange={(e) => setOriginSearch(e.target.value)}
                  placeholder="Type any planet, star, galaxy..."
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-400"
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
            <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08]">
              <div className="min-w-0">
                <div className="text-[10px] font-mono uppercase text-slate-400">
                  Destination (Selected Target)
                </div>
                <div className="font-display font-semibold text-cyan-300 truncate max-w-[180px]">
                  {targetObject ? targetObject.name : 'Click any object...'}
                </div>
              </div>
              {targetObject && (
                <button
                  onClick={() => onFlyTo(targetObject.id)}
                  className="p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-cyan-300 transition"
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
              <div className="p-3 rounded-xl bg-gradient-to-br from-cyan-500/15 to-emerald-500/10 border border-cyan-400/30">
                <div className="text-[10px] font-mono uppercase text-cyan-300/85">
                  Live Point-to-Point 3D Distance
                </div>
                <div className="font-display text-lg font-bold text-white mt-0.5">
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
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.07]"
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
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.07] text-[11px] text-slate-400 leading-relaxed">
              Pinned to{' '}
              <span className="text-emerald-300 font-medium">
                {originObject?.name || 'Earth'}
              </span>
              . Click any planet, exoplanet, star, satellite, nebula, or galaxy in 3D space to
              measure live cosmic distance & travel time!
            </div>
          )}
        </div>
      </div>
    );
  }
);
