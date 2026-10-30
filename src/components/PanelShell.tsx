import React from 'react';
import { X } from 'lucide-react';

interface Props {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  accent?: string;
  onClose: () => void;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  widthClass?: string;
}

/** Shared docked panel: fixed header, scrollable body. Docks beside the nav rail on desktop. */
export const PanelShell: React.FC<Props> = ({
  icon,
  title,
  subtitle,
  accent = '#22d3ee',
  onClose,
  headerExtra,
  children,
  widthClass = 'sm:w-[23rem]',
}) => (
  <aside
    className={`pointer-events-auto animate-panel-in w-full ${widthClass} max-h-[calc(100dvh-13rem)] sm:max-h-[calc(100dvh-12.25rem)] flex flex-col rounded-2xl glass-panel overflow-hidden text-xs`}
    role="dialog"
    aria-label={title}
  >
    <header className="flex items-start justify-between gap-2 px-3.5 pt-3 pb-2.5 border-b border-white/10 bg-white/[0.02] shrink-0">
      <div className="flex items-start gap-2.5 min-w-0">
        <div
          className="mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border"
          style={{ color: accent, borderColor: `${accent}55`, backgroundColor: `${accent}18` }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-sm font-bold text-white leading-tight">{title}</h2>
          {subtitle && <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {headerExtra}
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
          title="Close (Esc)"
          aria-label="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
    <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
  </aside>
);

export const LiveDot: React.FC<{ color?: string; title?: string }> = ({ color = '#34d399', title }) => (
  <span className="relative inline-flex w-2 h-2 shrink-0" title={title}>
    <span className="absolute inset-0 rounded-full animate-ping opacity-60" style={{ backgroundColor: color }} />
    <span className="relative inline-flex w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
  </span>
);

export const SourceChip: React.FC<{ kind: 'live' | 'computed' | 'typical' | 'model' }> = ({ kind }) => {
  const map = {
    live: ['LIVE', 'bg-emerald-500/15 text-emerald-300 border-emerald-400/40', 'Measured by a spacecraft or observatory'],
    computed: ['TODAY', 'bg-cyan-500/15 text-cyan-300 border-cyan-400/40', 'Calculated for the current date'],
    typical: ['TYPICAL', 'bg-white/[0.05] text-slate-300 border-white/15', 'Typical conditions — no live feed exists for this world'],
    model: ['MODEL', 'bg-amber-500/15 text-amber-300 border-amber-400/40', 'Estimated from a trajectory model'],
  } as const;
  const [label, cls, tip] = map[kind];
  return (
    <span className={`px-1.5 py-px rounded border text-[9px] font-mono tracking-wide ${cls}`} title={tip}>
      {label}
    </span>
  );
};
