import React from 'react';
import {
  X,
  RefreshCw,
  CheckCircle2,
  Sparkles,
  ExternalLink,
  Database,
  Clock,
  Compass,
} from 'lucide-react';
import type { SyncManifest } from '../types/universe';

interface Props {
  open: boolean;
  manifest: SyncManifest | null;
  isSyncing: boolean;
  syncIntervalHours: number;
  onClose: () => void;
  onTriggerSync: (newIntervalHours?: number) => void;
  onSelectDiscovery: (id: string) => void;
}

export const DataSyncModal: React.FC<Props> = ({
  open,
  manifest,
  isSyncing,
  syncIntervalHours,
  onClose,
  onTriggerSync,
  onSelectDiscovery,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-6">
      <div className="relative flex flex-col w-full max-w-3xl max-h-[86vh] rounded-2xl bg-slate-950/95 border border-slate-800 shadow-2xl overflow-hidden text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <Database className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white">
                Continual Astronomical Data Sync & Discovery Feed
              </h2>
              <p className="text-[11px] text-slate-400">
                Automatically synchronizes with public space agency archives every few days
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Auto-Sync Controls & Schedule */}
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-slate-200 font-medium">
                <Clock className="w-4 h-4 text-emerald-400" />
                <span>
                  Last Synced:{' '}
                  <span className="font-mono text-cyan-300">
                    {manifest?.lastSyncedAt
                      ? new Date(manifest.lastSyncedAt).toLocaleString()
                      : 'Bundled Baseline'}
                  </span>
                </span>
              </div>
              <div className="text-[11px] text-slate-400">
                Next Scheduled Check:{' '}
                <span className="font-mono text-slate-300">
                  {manifest?.nextScheduledSyncAt
                    ? new Date(manifest.nextScheduledSyncAt).toLocaleString()
                    : 'Auto-Scheduled'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={syncIntervalHours}
                onChange={(e) => onTriggerSync(Number(e.target.value))}
                className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 font-mono text-xs"
              >
                <option value={24}>Auto-Check: Every 24 Hours</option>
                <option value={72}>Auto-Check: Every 3 Days (72h)</option>
                <option value={168}>Auto-Check: Every 7 Days</option>
              </select>

              <button
                onClick={() => onTriggerSync()}
                disabled={isSyncing}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-60 text-slate-950 font-semibold transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Syncing Archives...' : 'Check & Update Now'}</span>
              </button>
            </div>
          </div>

          {/* Catalog Counts */}
          {manifest?.counts && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                ['Confirmed Exoplanets', manifest.counts.exoplanets.toLocaleString(), 'text-cyan-300'],
                ['3D HYG Stars', manifest.counts.stars.toLocaleString(), 'text-amber-300'],
                ['Live NORAD Satellites', manifest.counts.satellites.toLocaleString(), 'text-emerald-300'],
                ['Constellations & DSOs', `${manifest.counts.constellations} + ${manifest.counts.deepSpaceObjects}`, 'text-purple-300'],
              ].map(([label, val, cls]) => (
                <div key={label} className="p-3 rounded-xl bg-slate-900/70 border border-slate-800">
                  <div className="text-[10px] font-mono uppercase text-slate-400">{label}</div>
                  <div className={`text-base font-bold font-mono mt-0.5 ${cls}`}>{val}</div>
                </div>
              ))}
            </div>
          )}

          {/* Authoritative Public Data Sources */}
          <div className="space-y-2">
            <h3 className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
              Verified Public Science Data Feeds
            </h3>
            <div className="grid sm:grid-cols-2 gap-2">
              {(manifest?.sources || []).map((src) => (
                <a
                  key={src.name}
                  href={src.url}
                  target="_blank"
                  rel="noreferrer"
                  className="p-3 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800 flex items-center justify-between gap-2 transition"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-slate-200 font-medium truncate">{src.name}</span>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                </a>
              ))}
            </div>
          </div>

          {/* Newly Discovered Exoplanets Feed */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-amber-300">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Recently Discovered & Cataloged Exoplanets (Click to Visit in 3D)</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {(manifest?.recentDiscoveries || []).slice(0, 12).map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    onSelectDiscovery(d.id);
                    onClose();
                  }}
                  className="p-3 rounded-xl bg-slate-900/75 hover:bg-cyan-500/15 border border-slate-800 hover:border-cyan-400/50 text-left flex items-center justify-between gap-2 transition"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-white truncate">{d.name}</span>
                      {d.inHabitableZone && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-[9px] font-mono text-emerald-300">
                          HZ
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate mt-0.5">
                      {d.planetType} ({d.earthRadii}× R⊕) • {d.distLy} ly • {d.discFacility}
                    </div>
                  </div>
                  <Compass className="w-4 h-4 text-cyan-400 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
