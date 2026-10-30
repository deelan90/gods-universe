import React, { useMemo } from 'react';
import { Radio } from 'lucide-react';
import { LiveDot, SourceChip } from './PanelShell';
import {
  computeSpacecraftTelemetry,
  formatAuKm,
  formatLightTime,
  SPACECRAFT_BY_ID,
  type SpacecraftEphemerisFile,
} from '../utils/spacecraft';
import { formatLatLon, stationFix, type TrackedStation } from '../utils/stations';

interface Props {
  objectId: string;
  simTimeMs: number;
  ephem: SpacecraftEphemerisFile | null;
  stations: TrackedStation[];
}

/** Live readout shown inside the object drawer for spacecraft and crewed stations */
export const ObjectLiveStats: React.FC<Props> = ({ objectId, simTimeMs, ephem, stations }) => {
  const sec = Math.floor(simTimeMs / 1000);
  const craft = SPACECRAFT_BY_ID.get(objectId);
  const station = stations.find((s) => s.record.id === objectId);

  const t = useMemo(
    () => (craft ? computeSpacecraftTelemetry(craft, new Date(sec * 1000), ephem) : null),
    [craft, sec, ephem]
  );
  const fix = useMemo(() => (station ? stationFix(station, new Date(sec * 1000)) : null), [station, sec]);

  if (t) {
    const sun = formatAuKm(t.distSunAu);
    const earth = formatAuKm(t.distEarthAu);
    return (
      <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/[0.06] p-3">
        <div className="flex items-center gap-2 mb-2">
          {t.info.status === 'active' ? <LiveDot /> : <Radio className="w-3 h-3 text-slate-400" />}
          <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-300">Where it is now</span>
          {t.state.source === 'jpl-horizons' ? <SourceChip kind="live" /> : <SourceChip kind="model" />}
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 font-mono">
          <Item label="From Earth" value={earth.primary} sub={earth.secondary} />
          <Item label="From the Sun" value={sun.primary} sub={sun.secondary} />
          <Item label="Radio signal delay" value={formatLightTime(t.lightTimeSec)} sub="one way, from Earth" />
          {t.speedSunKms != null && (
            <Item
              label="Speed (vs Sun)"
              value={`${t.speedSunKms.toFixed(2)} km/s`}
              sub={`${Math.round(t.speedSunKms * 3600).toLocaleString()} km/h`}
            />
          )}
        </div>
        <p className="mt-2 text-[10.5px] text-slate-400">{t.info.where}</p>
      </div>
    );
  }

  if (fix && station) {
    return (
      <div className="rounded-xl border border-yellow-300/25 bg-yellow-400/[0.05] p-3">
        <div className="flex items-center gap-2 mb-2">
          <LiveDot color={station.def.color} />
          <span className="text-[10px] font-mono uppercase tracking-wider text-yellow-200">Over Earth right now</span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 font-mono">
          <Item label="Directly above" value={formatLatLon(fix.latDeg, fix.lonDeg)} wide />
          <Item label="Altitude" value={`${fix.altKm.toFixed(0)} km`} />
          <Item label="Speed" value={`${Math.round(fix.speedKms * 3600).toLocaleString()} km/h`} />
          <Item label="Lighting" value={fix.sunlit ? 'In sunlight' : 'In Earth’s shadow'} />
        </div>
      </div>
    );
  }
  return null;
};

const Item: React.FC<{ label: string; value: string; sub?: string; wide?: boolean }> = ({ label, value, sub, wide }) => (
  <div className={wide ? 'col-span-2' : ''}>
    <div className="text-[9px] uppercase tracking-wider text-slate-500 font-sans">{label}</div>
    <div className="text-[12.5px] text-white">{value}</div>
    {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
  </div>
);
