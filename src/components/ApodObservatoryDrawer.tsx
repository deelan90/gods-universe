import React, { useMemo, useState } from 'react';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Compass,
  Crosshair,
  ExternalLink,
  Layers,
  X,
} from 'lucide-react';
import type { ApodEntry, TelescopeImage, UnifiedCelestialObject } from '../types/universe';
import { apodToTelescopeImage, matchApodToCatalog } from '../utils/apodClient';

interface Props {
  entries: ApodEntry[];
  catalogById: Map<string, UnifiedCelestialObject>;
  searchableObjects: UnifiedCelestialObject[];
  onClose: () => void;
  onSelectAndFly: (id: string) => void;
  onInspect25D: (image: TelescopeImage, spherical: boolean) => void;
}

export const ApodObservatoryDrawer: React.FC<Props> = React.memo(
  ({
    entries,
    catalogById,
    searchableObjects,
    onClose,
    onSelectAndFly,
    onInspect25D,
  }) => {
    const [index, setIndex] = useState(0);
    const [showPlateOverlay, setShowPlateOverlay] = useState(true);

    const active = entries[index] || null;
    const matchedTarget = useMemo(
      () =>
        active ? matchApodToCatalog(active, catalogById, searchableObjects) : null,
      [active, catalogById, searchableObjects]
    );

    if (!active) return null;

    const proxiedThumb = `https://wsrv.nl/?url=${encodeURIComponent(active.imageUrl)}&w=960&output=jpg`;
    const isSphericalBody = matchedTarget
      ? ['planet', 'moon', 'dwarf-planet', 'star', 'exoplanet'].includes(
          matchedTarget.category
        )
      : false;

    const raDecStr =
      matchedTarget?.raDeg != null && matchedTarget?.decDeg != null
        ? `RA ${matchedTarget.raDeg.toFixed(2)}°  •  Dec ${
            matchedTarget.decDeg >= 0 ? '+' : ''
          }${matchedTarget.decDeg.toFixed(2)}°`
        : 'SOLAR EPHEMERIS // LIVE J2000';

    return (
      <section className="pointer-events-auto animate-panel-in w-[380px] max-w-[93vw] max-h-[calc(100vh-155px)] flex flex-col rounded-2xl glass-panel border border-cyan-400/25 overflow-hidden text-xs shadow-2xl">
        {/* Top Astrometric Plate-Solve Header */}
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-cyan-400/20 bg-[#030917]/90">
          <div className="flex items-center gap-2 min-w-0">
            <Camera className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <div className="min-w-0">
              <div className="font-mono text-[10px] tracking-widest uppercase text-cyan-300 font-semibold">
                NASA APOD // ASTROMETRY FEED
              </div>
              <div className="font-mono text-[10px] text-slate-400 truncate">
                OBS DATE: {active.date} • PLATE {index + 1}/{entries.length}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setIndex((i) => Math.min(entries.length - 1, i + 1))}
              disabled={index >= entries.length - 1}
              className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] disabled:opacity-30 text-slate-200 transition"
              title="Older APOD Capture"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index <= 0}
              className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] disabled:opacity-30 text-slate-200 transition"
              title="Newer APOD Capture"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition ml-0.5"
              title="Close NASA APOD Panel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
          {/* Interactive Plate-Solved APOD Viewport */}
          <div className="relative rounded-xl overflow-hidden border border-cyan-400/25 bg-[#02050c] group aspect-[16/10]">
            <img
              src={proxiedThumb}
              alt={active.title}
              onError={(e) => {
                const img = e.currentTarget;
                if (img.src !== active.imageUrl) img.src = active.imageUrl;
              }}
              className="w-full h-full object-cover"
            />

            {/* NASA APOD / Astrometry.net 1px Plate-Solve Reticle & Coordinate Overlay */}
            {showPlateOverlay && (
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_45%,rgba(2,6,18,0.58)_100%)]">
                {/* Corner fiducial brackets */}
                <div className="absolute top-2.5 left-2.5 w-3 h-3 border-t border-l border-cyan-300/80" />
                <div className="absolute top-2.5 right-2.5 w-3 h-3 border-t border-r border-cyan-300/80" />
                <div className="absolute bottom-2.5 left-2.5 w-3 h-3 border-b border-l border-cyan-300/80" />
                <div className="absolute bottom-2.5 right-2.5 w-3 h-3 border-b border-r border-cyan-300/80" />

                {/* Astrometry.net Center Plate-Solve Circle & Crosshair */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="relative w-24 h-24 rounded-full border border-cyan-300/65 shadow-[0_0_20px_rgba(34,211,238,0.18)]">
                    <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-[1px] h-3 bg-cyan-300/85" />
                    <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-[1px] h-3 bg-cyan-300/85" />
                    <span className="absolute top-1/2 -left-1.5 -translate-y-1/2 h-[1px] w-3 bg-cyan-300/85" />
                    <span className="absolute top-1/2 -right-1.5 -translate-y-1/2 h-[1px] w-3 bg-cyan-300/85" />
                    {matchedTarget && (
                      <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-[#020814]/90 border border-cyan-400/40 font-mono text-[9px] text-cyan-200 whitespace-nowrap">
                        {matchedTarget.name}
                      </span>
                    )}
                  </div>
                </div>

                {/* Top-left J2000 Astrometric Telemetry Stamp */}
                <div className="absolute top-2.5 left-7 font-mono text-[9.5px] text-cyan-200/95 bg-[#020814]/75 px-1.5 py-0.5 rounded border border-cyan-400/25">
                  {raDecStr}
                </div>
              </div>
            )}

            <button
              onClick={() => setShowPlateOverlay((v) => !v)}
              className="absolute bottom-2 right-2 px-2 py-1 rounded-md bg-[#020816]/85 hover:bg-cyan-950/90 border border-cyan-400/35 font-mono text-[9.5px] text-cyan-200 flex items-center gap-1 transition"
              title="Toggle Astrometry.net Plate-Solve Annotation Overlay"
            >
              <Crosshair className="w-3 h-3" />
              {showPlateOverlay ? 'Plate-Solve ON' : 'Clean Photo'}
            </button>
          </div>

          {/* Title & Credit */}
          <div>
            <h3 className="font-display text-sm font-bold text-white leading-snug">
              {active.title}
            </h3>
            <div className="font-mono text-[10px] text-slate-400 mt-0.5 flex items-center justify-between gap-2">
              <span className="truncate">Credit: {active.credit}</span>
              <a
                href={active.articleUrl}
                target="_blank"
                rel="noreferrer"
                className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-0.5 shrink-0"
              >
                NASA <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
          </div>

          {/* Action Buttons: Warp to 3D Target + 2.5D Depth Relief */}
          <div className="grid grid-cols-2 gap-2">
            {matchedTarget ? (
              <button
                onClick={() => onSelectAndFly(matchedTarget.id)}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/60 text-cyan-100 font-medium transition"
                title={`Warp 3D camera straight to ${matchedTarget.name}`}
              >
                <Compass className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                <span className="truncate">Warp to 3D Locus</span>
              </button>
            ) : (
              <div className="flex items-center justify-center px-2.5 py-2 rounded-xl bg-white/[0.03] border border-white/10 text-slate-400 font-mono text-[10px]">
                Wide-Field Sky Capture
              </div>
            )}

            <button
              onClick={() => onInspect25D(apodToTelescopeImage(active), isSphericalBody)}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-400/55 text-indigo-100 font-medium transition"
              title="Project this NASA APOD capture as an interactive 2.5D depth-parallax model!"
            >
              <Layers className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
              <span>2.5D Depth Sim</span>
            </button>
          </div>

          {/* Astronomer Explanation */}
          <div className="p-2.5 rounded-xl bg-white/[0.025] border border-white/[0.07] text-[11.5px] text-slate-300 leading-relaxed">
            {active.explanation}
          </div>

          {/* Recent APOD Filmstrip */}
          <div>
            <div className="font-mono text-[9.5px] uppercase tracking-wider text-slate-400 mb-1.5">
              Recent NASA APOD Archive ({entries.length} Plates)
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {entries.slice(0, 12).map((item, i) => {
                const thumb = `https://wsrv.nl/?url=${encodeURIComponent(item.imageUrl)}&w=160&h=100&fit=cover&output=jpg`;
                return (
                  <button
                    key={item.id}
                    onClick={() => setIndex(i)}
                    className={`relative w-16 h-11 rounded-lg overflow-hidden shrink-0 border transition ${
                      i === index
                        ? 'border-cyan-400 ring-1 ring-cyan-400/60'
                        : 'border-white/10 opacity-65 hover:opacity-100'
                    }`}
                    title={`${item.date} — ${item.title}`}
                  >
                    <img
                      src={thumb}
                      alt={item.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    );
  }
);
