import React, { useEffect, useMemo, useState } from 'react';
import { CloudSun, Compass, Thermometer, Gauge, Wind, Eye, Sunrise, Sun, ExternalLink } from 'lucide-react';
import { PanelShell, SourceChip } from './PanelShell';
import {
  fetchSpaceWeather,
  formatClock,
  kpLabel,
  marsClock,
  marsLocalSolarTime,
  marsSeason,
  WORLDS,
  worldNow,
  type PlanetWeatherFile,
  type SpaceWeatherNow,
} from '../utils/planetWeather';

interface Props {
  data: PlanetWeatherFile | null;
  onFlyTo: (id: string) => void;
  onClose: () => void;
}

type Pick = 'sun' | (typeof WORLDS)[number]['id'];

const FLY_TARGET: Record<string, string> = { titan: 'saturn' };

export const WorldWeatherPanel: React.FC<Props> = React.memo(({ data, onFlyTo, onClose }) => {
  const [pick, setPick] = useState<Pick>('mars');
  const [now, setNow] = useState(() => new Date());
  const [space, setSpace] = useState<SpaceWeatherNow | null>(null);
  const [spaceErr, setSpaceErr] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchSpaceWeather()
        .then((s) => {
          if (!alive) return;
          setSpace(s);
          setSpaceErr(s.windSpeedKms == null && s.kp == null);
        })
        .catch(() => alive && setSpaceErr(true));
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const world = WORLDS.find((w) => w.id === pick);
  const live = useMemo(() => (world ? worldNow(world, now) : null), [world, now]);

  return (
    <PanelShell
      icon={<CloudSun className="w-4 h-4" />}
      title="Weather on other worlds"
      subtitle="What it’s like out there today"
      accent="#fb923c"
      onClose={onClose}
    >
      {/* World picker */}
      <div className="sticky top-0 z-10 px-3 pt-3 pb-2 bg-[#070d1f]/95 backdrop-blur border-b border-white/[0.06]">
        <div className="flex gap-1 overflow-x-auto no-scrollbar pb-0.5">
          <PickerChip active={pick === 'sun'} color="#fbbf24" onClick={() => setPick('sun')} label="☉ Sun" live />
          {WORLDS.map((w) => (
            <PickerChip
              key={w.id}
              active={pick === w.id}
              color={w.color}
              onClick={() => setPick(w.id)}
              label={`${w.emoji} ${w.name.replace(' (Saturn’s moon)', '')}`}
              live={w.id === 'mars'}
            />
          ))}
        </div>
      </div>

      <div className="p-3.5 space-y-3">
        {pick === 'sun' ? (
          <SunCard space={space} failed={spaceErr} />
        ) : world ? (
          <>
            <div className="rounded-xl border border-white/[0.08] overflow-hidden">
              <div
                className="px-3.5 py-3"
                style={{ background: `linear-gradient(135deg, ${world.color}26, transparent 70%)` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-lg font-bold text-white leading-tight">
                      <span className="mr-1.5" aria-hidden>
                        {world.emoji}
                      </span>
                      {world.name}
                    </div>
                    <div className="text-[11.5px] text-slate-300 mt-0.5">{world.headline}</div>
                  </div>
                  <button
                    onClick={() => onFlyTo(FLY_TARGET[world.id] || world.id)}
                    className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 text-slate-100 text-[11px] transition"
                  >
                    <Compass className="w-3 h-3" /> Fly to
                  </button>
                </div>
                <p className="mt-2.5 text-[12px] text-white/90 leading-snug">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mr-1.5">Forecast</span>
                  {world.forecast}
                </p>
              </div>

            </div>

            {world.id === 'mars' && <MarsLive data={data} now={now} />}

            <div className="rounded-xl border border-white/[0.08] overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.02]">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Usual conditions</span>
                <SourceChip kind="typical" />
              </div>
              <div className="grid grid-cols-2 gap-px bg-white/[0.06]">
                <Cell icon={<Thermometer className="w-3 h-3" />} label="Temperature" value={world.temp} kind="typical" />
                <Cell icon={<Gauge className="w-3 h-3" />} label="Air pressure" value={world.pressure} kind="typical" />
                <Cell icon={<Wind className="w-3 h-3" />} label="Wind" value={world.wind} kind="typical" />
                <Cell icon={<Eye className="w-3 h-3" />} label="Sky" value={world.sky} kind="typical" />
              </div>
            </div>

            {live && (
              <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/[0.06] p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-300">Today</span>
                  <SourceChip kind="computed" />
                </div>
                <div className="grid grid-cols-3 gap-2 font-mono">
                  <Mini label="From the Sun" value={`${live.sunDistAu.toFixed(2)} AU`} />
                  <Mini
                    label="Sunlight vs Earth"
                    value={
                      live.sunlightVsEarth >= 1
                        ? `${live.sunlightVsEarth.toFixed(1)}×`
                        : `${(live.sunlightVsEarth * 100).toFixed(live.sunlightVsEarth < 0.01 ? 2 : 1)}%`
                    }
                  />
                  <Mini
                    label="Signal delay"
                    value={live.lightMinutes >= 60 ? `${(live.lightMinutes / 60).toFixed(1)} h` : `${live.lightMinutes.toFixed(1)} min`}
                  />
                </div>
              </div>
            )}
          </>
        ) : null}

        <p className="text-[10px] text-slate-500 leading-relaxed">
          <SourceChip kind="live" /> measured · <SourceChip kind="computed" /> calculated for today ·{' '}
          <SourceChip kind="typical" /> usual conditions (no live feed exists for that world yet).
        </p>
      </div>
    </PanelShell>
  );
});

const PickerChip: React.FC<{ active: boolean; color: string; label: string; onClick: () => void; live?: boolean }> = ({
  active,
  color,
  label,
  onClick,
  live,
}) => (
  <button
    onClick={onClick}
    className={`relative shrink-0 px-2.5 py-1 rounded-full text-[11px] whitespace-nowrap border transition ${
      active ? 'text-white' : 'text-slate-400 border-white/10 hover:text-white hover:border-white/25'
    }`}
    style={active ? { borderColor: `${color}aa`, backgroundColor: `${color}22` } : undefined}
  >
    {label}
    {live && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400" />}
  </button>
);

const Cell: React.FC<{ icon: React.ReactNode; label: string; value: string; kind: 'typical' | 'live' }> = ({
  icon,
  label,
  value,
}) => (
  <div className="bg-[#070d1f] px-3 py-2">
    <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-wider text-slate-500">
      {icon}
      {label}
    </div>
    <div className="text-[11.5px] text-slate-100 mt-0.5 leading-snug">{value}</div>
  </div>
);

const Mini: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div className="text-[9px] uppercase tracking-wider text-slate-500 font-sans">{label}</div>
    <div className="text-[12.5px] text-white">{value}</div>
  </div>
);

/* ---------------------------------------------------------------- Mars */

const MarsLive: React.FC<{ data: PlanetWeatherFile | null; now: Date }> = ({ data, now }) => {
  const clock = marsClock(now);
  const season = marsSeason(clock.ls);
  const galeTime = marsLocalSolarTime(now, 137.4);
  const jezeroTime = marsLocalSolarTime(now, 77.45);
  const sols = data?.mars?.sols || [];
  const latest = sols[0];

  // Estimate today's Curiosity sol from the latest report
  let solToday: number | null = null;
  if (latest?.sol != null && latest.earthDate) {
    const reportMsd = marsClock(new Date(`${latest.earthDate}T12:00:00Z`)).msd;
    solToday = latest.sol + Math.round(clock.msd - reportMsd);
  }

  const daysOld = latest ? Math.round((now.getTime() - Date.parse(`${latest.earthDate}T12:00:00Z`)) / 86_400_000) : null;
  const series = sols.slice(0, 14).reverse();

  return (
    <>
      <div className="rounded-xl border border-white/[0.08] p-3 space-y-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-orange-300">On Mars right now</span>
          <SourceChip kind="computed" />
        </div>
        <div className="grid grid-cols-2 gap-2 font-mono">
          <Mini label="Gale Crater (Curiosity)" value={`${formatClock(galeTime)} local`} />
          <Mini label="Jezero (Perseverance)" value={`${formatClock(jezeroTime)} local`} />
          <Mini label="North / South" value={`${cap(season.north)} / ${season.south}`} />
          <Mini label="Season angle (Ls)" value={`${clock.ls.toFixed(1)}°`} />
        </div>
        <p className="text-[11px] text-slate-300 leading-snug">
          {season.dustSeason
            ? 'It’s dust-storm season — Mars is near its closest point to the Sun, and regional storms can grow planet-wide.'
            : 'Outside the main dust-storm season. Skies are usually clearer, with thin water-ice clouds.'}
          {solToday != null && ` Curiosity is on about sol ${solToday.toLocaleString()} of its mission.`}
        </p>
      </div>

      <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.05] p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-300">
              Latest Curiosity weather report
            </span>
            <SourceChip kind="live" />
          </div>
          {data?.mars?.sourceUrl && (
            <a
              href={data.mars.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-slate-400 hover:text-white"
              title="Open NASA’s Mars weather page"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
        {latest ? (
          <>
            <div className="text-[11px] text-slate-400 mb-2">
              Sol {latest.sol?.toLocaleString()} · {new Date(`${latest.earthDate}T12:00:00Z`).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono">
              <Mini label="Air high / low" value={`${fmtC(latest.maxTempC)} / ${fmtC(latest.minTempC)}`} />
              <Mini label="Ground high / low" value={`${fmtC(latest.maxGroundTempC)} / ${fmtC(latest.minGroundTempC)}`} />
              <Mini label="Pressure" value={latest.pressurePa != null ? `${latest.pressurePa} Pa` : '—'} />
              <Mini label="Sky" value={latest.sky || '—'} />
              <Mini label="UV level" value={latest.uv || '—'} />
              <Mini
                label="Sunrise / sunset"
                value={latest.sunrise && latest.sunset ? `${latest.sunrise} / ${latest.sunset}` : '—'}
              />
            </div>
            {series.length > 2 && <TempSparkline series={series} />}
            <p className="text-[10px] text-slate-500 mt-2 leading-snug">
              {daysOld != null && daysOld > 3
                ? `Curiosity’s weather data reaches the public with a delay — this report is ${daysOld} days old. `
                : ''}
              Earth’s average pressure is about 101,325 Pa — Mars has well under 1% of that.
            </p>
          </>
        ) : (
          <p className="text-slate-400">The Mars weather feed hasn’t been synced yet.</p>
        )}
      </div>
    </>
  );
};

const TempSparkline: React.FC<{ series: { minTempC: number | null; maxTempC: number | null; sol: number | null }[] }> = ({
  series,
}) => {
  const vals = series.flatMap((s) => [s.minTempC, s.maxTempC]).filter((v): v is number => v != null);
  if (!vals.length) return null;
  const lo = Math.min(...vals) - 3;
  const hi = Math.max(...vals) + 3;
  const W = 300;
  const H = 54;
  const x = (i: number) => (i / Math.max(1, series.length - 1)) * (W - 8) + 4;
  const y = (v: number) => H - 6 - ((v - lo) / (hi - lo)) * (H - 14);
  const line = (key: 'minTempC' | 'maxTempC') =>
    series
      .map((s, i) => (s[key] == null ? null : `${x(i).toFixed(1)},${y(s[key] as number).toFixed(1)}`))
      .filter(Boolean)
      .join(' ');
  return (
    <div className="mt-2.5">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Daily high and low air temperature over recent sols">
        <polyline points={line('maxTempC')} fill="none" stroke="#fb923c" strokeWidth="1.6" strokeLinejoin="round" />
        <polyline points={line('minTempC')} fill="none" stroke="#60a5fa" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-[9.5px] text-slate-500 font-mono">
        <span>sol {series[0].sol}</span>
        <span>
          <span className="text-orange-300">— high</span> <span className="text-blue-300">— low</span>
        </span>
        <span>sol {series[series.length - 1].sol}</span>
      </div>
    </div>
  );
};

/* ---------------------------------------------------------------- Sun / space weather */

const SunCard: React.FC<{ space: SpaceWeatherNow | null; failed: boolean }> = ({ space, failed }) => {
  const kp = space?.kp ?? null;
  const scale = (s?: string) => (s && s !== '0' ? s : '0');
  return (
    <div className="rounded-xl border border-amber-400/25 overflow-hidden">
      <div className="px-3.5 py-3 bg-gradient-to-br from-amber-500/20 to-transparent">
        <div className="flex items-center gap-1.5">
          <Sun className="w-4 h-4 text-amber-300" />
          <span className="font-display text-lg font-bold text-white">The Sun’s weather</span>
          <SourceChip kind="live" />
        </div>
        <p className="text-[11.5px] text-slate-300 mt-1 leading-snug">
          Space weather measured near Earth by NOAA’s solar-wind monitors and GOES satellites.
        </p>
      </div>
      {failed && !space?.windSpeedKms ? (
        <p className="p-3 text-slate-400">Couldn’t reach NOAA right now. Try again in a few minutes.</p>
      ) : !space ? (
        <div className="p-3 space-y-2">
          <div className="h-4 rounded shimmer-bg" />
          <div className="h-4 rounded shimmer-bg w-2/3" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px bg-white/[0.06]">
            <div className="bg-[#070d1f] px-3 py-2">
              <div className="text-[9.5px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <Wind className="w-3 h-3" /> Solar wind
              </div>
              <div className="text-[15px] font-mono text-white">
                {space.windSpeedKms != null ? `${Math.round(space.windSpeedKms)} km/s` : '—'}
              </div>
              <div className="text-[10px] text-slate-400">
                {space.windSpeedKms != null
                  ? space.windSpeedKms > 600
                    ? 'Fast stream'
                    : space.windSpeedKms > 450
                      ? 'Moderate'
                      : 'Calm'
                  : ''}
              </div>
            </div>
            <div className="bg-[#070d1f] px-3 py-2">
              <div className="text-[9.5px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <Gauge className="w-3 h-3" /> Geomagnetic (Kp)
              </div>
              <div className="text-[15px] font-mono text-white">{kp != null ? kp.toFixed(1) : '—'}</div>
              <div className="text-[10px] text-slate-400">{kp != null ? kpLabel(kp) : ''}</div>
            </div>
            <div className="bg-[#070d1f] px-3 py-2">
              <div className="text-[9.5px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <Sunrise className="w-3 h-3" /> X-ray level
              </div>
              <div className="text-[15px] font-mono text-white">{space.xrayClass || '—'}</div>
              <div className="text-[10px] text-slate-400">
                {space.xrayClass?.startsWith('X')
                  ? 'Major flare in progress'
                  : space.xrayClass?.startsWith('M')
                    ? 'Moderate flare'
                    : 'No big flare'}
              </div>
            </div>
            <div className="bg-[#070d1f] px-3 py-2">
              <div className="text-[9.5px] uppercase tracking-wider text-slate-500">NOAA scales</div>
              <div className="text-[13px] font-mono text-white mt-0.5">
                R{scale(space.scales?.R)} · S{scale(space.scales?.S)} · G{scale(space.scales?.G)}
              </div>
              <div className="text-[10px] text-slate-400">Radio · Radiation · Storms (0–5)</div>
            </div>
          </div>
          <p className="px-3 py-2 text-[10.5px] text-slate-400 leading-snug">
            {kp != null && kp >= 5
              ? 'Aurora alert: skies at mid-latitudes could light up tonight.'
              : 'Auroras mostly limited to polar regions right now.'}{' '}
            Updated {new Date(space.fetchedAt).toLocaleTimeString(undefined, { timeStyle: 'short' })} · refreshes every 5 min.
          </p>
        </>
      )}
    </div>
  );
};

function fmtC(v: number | null) {
  return v == null ? '—' : `${v} °C`;
}
function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
