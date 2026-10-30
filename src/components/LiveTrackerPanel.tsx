import React, { useMemo, useState } from 'react';
import { Satellite, Rocket, Sun, Moon, Telescope, Orbit, Compass } from 'lucide-react';
import { PanelShell, LiveDot, SourceChip } from './PanelShell';
import { WORLD_LAND_PATH } from '../data/worldLand';
import {
  formatLatLon,
  groundTrackSegments,
  stationFix,
  type TrackedStation,
} from '../utils/stations';
import {
  computeSpacecraftTelemetry,
  formatAuKm,
  formatLightTime,
  SPACECRAFT_FLEET,
  type SpacecraftEphemerisFile,
  type SpacecraftGroup,
  type SpacecraftTelemetry,
} from '../utils/spacecraft';
import * as Astronomy from 'astronomy-engine';

interface Props {
  simTimeMs: number;
  isLiveTime: boolean;
  stations: TrackedStation[];
  stationsRefreshedLive: boolean;
  ephem: SpacecraftEphemerisFile | null;
  onFlyTo: (id: string) => void;
  onClose: () => void;
}

const GROUPS: { key: SpacecraftGroup[]; title: string; icon: React.ReactNode }[] = [
  { key: ['interstellar'], title: 'Leaving the Solar System', icon: <Rocket className="w-3.5 h-3.5" /> },
  { key: ['cruise', 'orbiting', 'surface'], title: 'Exploring the planets & Sun', icon: <Orbit className="w-3.5 h-3.5" /> },
  { key: ['observatory'], title: 'Space telescopes', icon: <Telescope className="w-3.5 h-3.5" /> },
];

const ONE_LIGHT_DAY_S = 86_400;

export const LiveTrackerPanel: React.FC<Props> = React.memo(
  ({ simTimeMs, isLiveTime, stations, stationsRefreshedLive, ephem, onFlyTo, onClose }) => {
    const [tab, setTab] = useState<'stations' | 'deep'>('stations');
    const [focusStation, setFocusStation] = useState(0);

    // Recompute once per (simulated) second — plenty for a readout
    const secondKey = Math.floor(simTimeMs / 1000);
    const date = useMemo(() => new Date(secondKey * 1000), [secondKey]);

    const fixes = useMemo(() => stations.map((s) => stationFix(s, date)), [stations, date]);

    const trackKey = Math.floor(simTimeMs / 20_000);
    const tracked = stations[Math.min(focusStation, stations.length - 1)];
    const track = useMemo(
      () => (tracked ? groundTrackSegments(tracked, new Date(trackKey * 20_000)) : null),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [tracked, trackKey]
    );

    const craftTelemetry = useMemo(() => {
      if (tab !== 'deep') return [];
      const e = Astronomy.HelioVector(Astronomy.Body.Earth, date);
      const earth: [number, number, number] = [e.x, e.y, e.z];
      return SPACECRAFT_FLEET.map((c) => computeSpacecraftTelemetry(c, date, ephem, earth));
    }, [tab, date, ephem]);

    const voyager1 = craftTelemetry.find((t) => t.info.id === 'voyager-1');
    const ephemDate = ephem?.generatedAt ? new Date(ephem.generatedAt) : null;

    return (
      <PanelShell
        icon={<Satellite className="w-4 h-4" />}
        title="Live spacecraft"
        subtitle={isLiveTime ? 'Real-time positions, updated every second' : 'Showing positions at the simulated time'}
        accent="#34d399"
        onClose={onClose}
      >
        <div className="sticky top-0 z-10 px-3.5 pt-3 pb-2 bg-[#070d1f]/95 backdrop-blur border-b border-white/[0.06]">
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            {(
              [
                ['stations', 'Space stations'],
                ['deep', 'Deep space'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`py-1.5 rounded-lg text-[11px] font-medium transition ${
                  tab === key ? 'bg-emerald-500/20 text-emerald-100 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.5)]' : 'text-slate-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'stations' ? (
          <div className="p-3.5 space-y-3">
            {/* Ground-track map */}
            <div className="rounded-xl overflow-hidden border border-white/[0.08] bg-[#04122a]">
              <svg viewBox="0 0 360 180" className="w-full h-auto block" role="img" aria-label="Map of where the space stations are right now">
                <rect width="360" height="180" fill="#05162f" />
                {[30, 60, 90, 120, 150].map((y) => (
                  <line key={y} x1="0" x2="360" y1={y} y2={y} stroke="rgba(148,163,184,0.08)" strokeWidth="0.4" />
                ))}
                {[60, 120, 180, 240, 300].map((x) => (
                  <line key={x} y1="0" y2="180" x1={x} x2={x} stroke="rgba(148,163,184,0.08)" strokeWidth="0.4" />
                ))}
                <path d={WORLD_LAND_PATH} fill="#1e3a5f" stroke="#2d5b8a" strokeWidth="0.3" />
                {track?.past.map((pts, i) => (
                  <polyline key={`p${i}`} points={pts} fill="none" stroke={tracked?.def.color} strokeOpacity="0.35" strokeWidth="0.8" />
                ))}
                {track?.future.map((pts, i) => (
                  <polyline key={`f${i}`} points={pts} fill="none" stroke={tracked?.def.color} strokeOpacity="0.9" strokeWidth="0.8" strokeDasharray="2 1.5" />
                ))}
                {stations.map((s, i) => {
                  const f = fixes[i];
                  if (!f) return null;
                  const x = f.lonDeg + 180;
                  const y = 90 - f.latDeg;
                  const isFocus = i === focusStation;
                  return (
                    <g key={s.def.key} onClick={() => setFocusStation(i)} style={{ cursor: 'pointer' }}>
                      <circle cx={x} cy={y} r={isFocus ? 5 : 3.5} fill={s.def.color} fillOpacity="0.18">
                        <animate attributeName="r" values={isFocus ? '4;8;4' : '3;5;3'} dur="2s" repeatCount="indefinite" />
                      </circle>
                      <circle cx={x} cy={y} r="2" fill={s.def.color} stroke="#02050d" strokeWidth="0.6" />
                      <text x={x + 4} y={y - 3} fontSize="6" fill="#e2e8f0" fontFamily="Inter, sans-serif">
                        {s.def.key === 'iss' ? 'ISS' : s.def.key === 'tiangong' ? 'Tiangong' : s.record.name}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <div className="px-2.5 py-1.5 flex items-center justify-between text-[10px] text-slate-400 border-t border-white/[0.06]">
                <span>Solid line: last 45 min · Dashed: next 90 min</span>
                {tracked && <span style={{ color: tracked.def.color }}>{tracked.def.key === 'iss' ? 'ISS' : 'Tiangong'}</span>}
              </div>
            </div>

            {stations.length === 0 && (
              <p className="text-slate-400">No station orbit data loaded yet.</p>
            )}

            {stations.map((s, i) => {
              const f = fixes[i];
              return (
                <div
                  key={s.def.key}
                  className={`rounded-xl border p-3 transition cursor-pointer ${
                    i === focusStation ? 'bg-white/[0.05] border-white/20' : 'bg-white/[0.02] border-white/[0.07] hover:border-white/15'
                  }`}
                  onClick={() => setFocusStation(i)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <LiveDot color={s.def.color} />
                        <span className="font-semibold text-[13px] text-white truncate">{s.def.name}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{s.def.flag} · {s.def.crewNote}</div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onFlyTo(s.record.id);
                      }}
                      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/40 text-emerald-200 text-[11px] transition"
                    >
                      <Compass className="w-3 h-3" /> Fly to
                    </button>
                  </div>
                  {f ? (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2.5 font-mono text-[11px]">
                      <Stat label="Position" value={formatLatLon(f.latDeg, f.lonDeg)} wide />
                      <Stat label="Altitude" value={`${f.altKm.toFixed(0)} km`} />
                      <Stat label="Speed" value={`${Math.round(f.speedKms * 3600).toLocaleString()} km/h`} />
                      <Stat
                        label="Lighting"
                        value={
                          <span className="flex items-center gap-1">
                            {f.sunlit ? <Sun className="w-3 h-3 text-amber-300" /> : <Moon className="w-3 h-3 text-indigo-300" />}
                            {f.sunlit ? 'In sunlight' : 'In Earth’s shadow'}
                          </span>
                        }
                      />
                      <Stat
                        label="Orbit data age"
                        value={`${Math.abs(f.elementAgeHours) < 48 ? `${Math.abs(f.elementAgeHours).toFixed(0)} h` : `${(Math.abs(f.elementAgeHours) / 24).toFixed(1)} days`}`}
                      />
                    </div>
                  ) : (
                    <p className="mt-2 text-slate-500">Position unavailable for this time.</p>
                  )}
                </div>
              );
            })}

            <p className="text-[10px] text-slate-500 leading-relaxed">
              Orbits from NORAD via CelesTrak{stationsRefreshedLive ? ' (refreshed live in your browser)' : ''}, propagated with the
              SGP4 model. Expect accuracy within a few kilometres while the orbit data is under a day old.
            </p>
          </div>
        ) : (
          <div className="p-3.5 space-y-4">
            {voyager1 && <LightDayBanner t={voyager1} />}

            {GROUPS.map((g) => {
              const list = craftTelemetry
                .filter((t) => g.key.includes(t.info.group))
                .sort((a, b) => b.distEarthAu - a.distEarthAu);
              if (!list.length) return null;
              return (
                <section key={g.title}>
                  <h3 className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">
                    {g.icon}
                    {g.title}
                  </h3>
                  <div className="space-y-1.5">
                    {list.map((t) => (
                      <CraftRow key={t.info.id} t={t} onFlyTo={onFlyTo} />
                    ))}
                  </div>
                </section>
              );
            })}

            <p className="text-[10px] text-slate-500 leading-relaxed">
              {ephemDate
                ? `Positions from NASA/JPL Horizons (updated ${ephemDate.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}), interpolated in real time.`
                : 'Positions from a built-in trajectory model based on NASA/JPL Horizons data from 30 Oct 2026.'}{' '}
              “Speed” is relative to the Sun. Signal delay is the one-way radio travel time from Earth.
            </p>
          </div>
        )}
      </PanelShell>
    );
  }
);

const Stat: React.FC<{ label: string; value: React.ReactNode; wide?: boolean }> = ({ label, value, wide }) => (
  <div className={wide ? 'col-span-2' : ''}>
    <div className="text-[9px] uppercase tracking-wider text-slate-500 font-sans">{label}</div>
    <div className="text-slate-100">{value}</div>
  </div>
);

const CraftRow: React.FC<{ t: SpacecraftTelemetry; onFlyTo: (id: string) => void }> = ({ t, onFlyTo }) => {
  const d = formatAuKm(t.distEarthAu);
  const statusColor = t.info.status === 'active' ? '#34d399' : t.info.status === 'silent' ? '#64748b' : '#fbbf24';
  return (
    <button
      onClick={() => onFlyTo(t.info.id)}
      className="w-full text-left rounded-xl bg-white/[0.025] hover:bg-white/[0.06] border border-white/[0.07] hover:border-white/15 px-3 py-2 transition group"
      title={`Fly to ${t.info.name}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {t.info.status === 'active' ? (
            <LiveDot color={statusColor} title="Active" />
          ) : (
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: statusColor }}
              title={t.info.status === 'silent' ? 'No longer transmitting' : 'Status uncertain'}
            />
          )}
          <span className="font-semibold text-[12.5px] text-white truncate">{t.info.name}</span>
          {t.state.source !== 'jpl-horizons' && <SourceChip kind="model" />}
        </div>
        <span className="font-mono text-[12px] text-white shrink-0">{d.primary}</span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <span className="text-[10.5px] text-slate-400 truncate">{t.info.where}</span>
        <span className="text-[10px] font-mono text-slate-500 shrink-0">{d.secondary}</span>
      </div>
      <div className="flex items-center gap-3 mt-1 text-[10.5px] font-mono text-slate-300">
        <span title="One-way radio signal delay from Earth">📡 {formatLightTime(t.lightTimeSec)}</span>
        {t.speedSunKms != null && <span title="Speed relative to the Sun">⚡ {t.speedSunKms.toFixed(1)} km/s</span>}
        <span className="ml-auto text-cyan-300 opacity-0 group-hover:opacity-100 transition font-sans">Fly to →</span>
      </div>
    </button>
  );
};

const LightDayBanner: React.FC<{ t: SpacecraftTelemetry }> = ({ t }) => {
  const over = t.lightTimeSec >= ONE_LIGHT_DAY_S;
  const gapMin = Math.round((ONE_LIGHT_DAY_S - t.lightTimeSec) / 60);
  return (
    <div className="rounded-xl p-3 border border-sky-400/30 bg-gradient-to-br from-sky-500/15 to-indigo-500/10">
      <div className="text-[10px] font-mono uppercase tracking-wider text-sky-300">Voyager 1 · farthest human-made object</div>
      <div className="font-display text-lg font-bold text-white mt-0.5">{formatLightTime(t.lightTimeSec)} away by radio</div>
      <p className="text-[11px] text-slate-300 mt-1 leading-snug">
        {over
          ? 'It is now more than one light-day from Earth — a message sent today arrives tomorrow.'
          : `Just ${gapMin} minutes of signal time short of one light-day from Earth. It crosses that line on about 19 November 2026.`}
      </p>
    </div>
  );
};
