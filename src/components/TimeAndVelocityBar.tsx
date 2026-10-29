import React from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Orbit,
  Gauge,
} from 'lucide-react';
import type { SceneTelemetrySnapshot } from '../engine/UniverseScene';
import {
  EARTH_ORBIT_SPEED_KMS,
  SOLAR_CMB_SPEED_KMS,
  SOLAR_GALACTIC_SPEED_KMS,
} from '../utils/astronomy';

interface Props {
  playing: boolean;
  timeScale: number;
  helicalMotion: boolean;
  telemetry: SceneTelemetrySnapshot | null;
  onTogglePlay: () => void;
  onChangeTimeScale: (scale: number) => void;
  onResetLive: () => void;
  onToggleHelicalMotion: () => void;
  onJumpScale: (
    preset:
      | 'earth-orbit'
      | 'solar-system'
      | 'interstellar'
      | 'milky-way'
      | 'local-group'
      | 'observable-universe'
  ) => void;
}

const TIME_SCALE_OPTIONS = [
  { value: 1, label: '1× Real-Time' },
  { value: 60, label: '60× (1 min/s)' },
  { value: 3600, label: '3,600× (1 hr/s)' },
  { value: 86400, label: '86,400× (1 day/s)' },
  { value: 2_629_800, label: '2.6M× (1 mo/s)' },
  { value: 31_557_600, label: '31.5M× (1 yr/s)' },
];

function formatKmOdometer(km: number): string {
  if (km < 1_000_000) {
    return `${km.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  }
  if (km < 1_000_000_000) {
    return `${(km / 1e6).toFixed(2)}M km`;
  }
  if (km < 1e12) {
    return `${(km / 1e9).toFixed(2)}B km`;
  }
  return `${(km / 9.4607e12).toFixed(3)} ly`;
}

export const TimeAndVelocityBar: React.FC<Props> = React.memo(
  ({
    playing,
    timeScale,
    helicalMotion,
    telemetry,
    onTogglePlay,
    onChangeTimeScale,
    onResetLive,
    onToggleHelicalMotion,
    onJumpScale,
  }) => {
    const simDateStr = telemetry
      ? new Date(telemetry.simTimeMs).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
      : 'LIVE UTC';

    return (
      <footer className="pointer-events-none fixed bottom-0 inset-x-0 z-20 p-2.5 sm:p-3.5 flex flex-col gap-2">
        {/* Quick Scale Jump Pills (Scrollable on Mobile, Centered on Desktop) */}
        <div className="pointer-events-auto mx-auto max-w-full overflow-x-auto flex items-center gap-1 px-2 py-1 rounded-full glass-pill">
          {(
            [
              ['earth-orbit', 'Earth & Satellites'],
              ['solar-system', 'Solar System'],
              ['interstellar', 'Stars & Exoplanets'],
              ['milky-way', 'Milky Way'],
              ['local-group', 'Local Group'],
              ['observable-universe', 'Observable Universe (93 Gly)'],
            ] as const
          ).map(([preset, label]) => (
            <button
              key={preset}
              onClick={() => onJumpScale(preset)}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium text-slate-300 hover:text-cyan-200 hover:bg-cyan-500/15 whitespace-nowrap transition"
            >
              {label}
            </button>
          ))}
        </div>

        {/* Main Bottom Command & Real-Time Solar System Velocity Bar */}
        <div className="pointer-events-auto mx-auto w-full max-w-6xl rounded-2xl glass-panel px-3 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Left: Play/Pause, Live Reset & Time-Scale Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={onTogglePlay}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold border transition ${
                playing
                  ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                  : 'bg-amber-500/20 border-amber-400/60 text-amber-200'
              }`}
              title={playing ? 'Pause Universe Motion' : 'Resume Universe Motion'}
            >
              {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{playing ? 'Running' : 'Paused'}</span>
            </button>

            <select
              value={timeScale}
              onChange={(e) => onChangeTimeScale(Number(e.target.value))}
              className="px-2.5 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 font-mono text-xs text-white focus:outline-none focus:border-cyan-400 cursor-pointer"
              title="Change Time Scaling of the Universe"
            >
              {TIME_SCALE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-slate-950">
                  {opt.label}
                </option>
              ))}
            </select>

            <button
              onClick={onResetLive}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/10 text-slate-300 hover:text-white font-mono text-[11px] transition"
              title="Reset clock to Live Real-Time (1×) & clear distance stopwatch"
            >
              <RotateCcw className="w-3 h-3 text-emerald-400" />
              <span>LIVE 1×</span>
            </button>

            <span className="hidden xl:inline font-mono text-[11px] text-slate-400 pl-1">
              {simDateStr}
            </span>
          </div>

          {/* Center/Right: Solar System Speed & Distance Odometer + Helical Motion Toggle */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.08] font-mono">
              <div className="flex items-center gap-1.5 text-slate-400">
                <Gauge className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="text-[10px] uppercase tracking-wider hidden lg:inline">
                  Solar Velocity:
                </span>
              </div>

              <div title="Earth orbital velocity around the Sun (29.78 km/s = 107,222 km/h)">
                <div className="text-[9px] text-slate-500">EARTH ({EARTH_ORBIT_SPEED_KMS} km/s)</div>
                <div className="text-[11px] font-semibold text-blue-300">
                  {formatKmOdometer(telemetry?.earthTraveledKm || 0)}
                </div>
              </div>

              <span className="text-white/10">|</span>

              <div title="Solar System galactic orbit around Milky Way Center (230 km/s = 828,000 km/h)">
                <div className="text-[9px] text-slate-500">GALACTIC ({SOLAR_GALACTIC_SPEED_KMS} km/s)</div>
                <div className="text-[11px] font-semibold text-cyan-300">
                  {formatKmOdometer(telemetry?.galacticTraveledKm || 0)}
                </div>
              </div>

              <span className="text-white/10 hidden md:inline">|</span>

              <div
                className="hidden md:block"
                title="Solar System velocity relative to the Cosmic Microwave Background rest frame (369.82 km/s = 1.33 Million km/h!)"
              >
                <div className="text-[9px] text-slate-500">CMB ({SOLAR_CMB_SPEED_KMS} km/s)</div>
                <div className="text-[11px] font-semibold text-amber-300">
                  {formatKmOdometer(telemetry?.cmbTraveledKm || 0)}
                </div>
              </div>
            </div>

            <button
              onClick={onToggleHelicalMotion}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-medium transition ${
                helicalMotion
                  ? 'bg-cyan-500/25 border-cyan-400 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.28)]'
                  : 'bg-white/[0.04] border-white/10 text-slate-300 hover:text-white hover:border-white/25'
              }`}
              title="Visualize Solar System speed in 3D space with real-time velocity lattice & helical planetary vortex trails"
            >
              <Orbit className="w-3.5 h-3.5 text-cyan-400" />
              <span>{helicalMotion ? '3D Helical Motion: ON' : 'Visualize Solar Speed'}</span>
            </button>
          </div>
        </div>
      </footer>
    );
  }
);
