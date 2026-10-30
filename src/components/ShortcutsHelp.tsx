import React from 'react';
import { Keyboard, Mouse, X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

const KEYS: [string, string][] = [
  ['/  or  Ctrl K', 'Search everything'],
  ['F', 'Layers & filters'],
  ['T', 'Live spacecraft tracker'],
  ['M', 'Weather on other worlds'],
  ['I', 'NASA picture of the day'],
  ['R', 'Distance calculator'],
  ['P', 'Pause / play time'],
  ['L', 'Back to live time'],
  ['H', 'Home — fly to Earth'],
  ['G', 'Hop to a random galaxy'],
  ['1 – 7', 'Zoom presets: Earth → whole universe'],
  ['Esc', 'Close panels'],
  ['?', 'This help'],
];

const FLIGHT: [string, string][] = [
  ['W A S D  or  arrows', 'Fly forward, left, back, right'],
  ['Q / E', 'Fly down / up'],
  ['Shift (hold)', 'Fly faster'],
];

const MOUSE: [string, string][] = [
  ['Drag', 'Orbit around the target'],
  ['Right-drag', 'Pan (roam freely)'],
  ['Scroll / pinch', 'Zoom across scales'],
  ['Click', 'Select an object'],
  ['Double-click', 'Fly to an object'],
];

export const ShortcutsHelp: React.FC<Props> = ({ open, onClose }) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 bg-[#02050d]/60 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="animate-panel-in w-full max-w-2xl rounded-2xl glass-panel overflow-hidden max-h-[86vh] flex flex-col" role="dialog" aria-label="Controls and shortcuts">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2 font-display font-bold text-white">
            <Keyboard className="w-4 h-4 text-cyan-300" /> Controls & shortcuts
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="grid sm:grid-cols-2 gap-5 p-4 overflow-y-auto text-xs">
          <Section title="Keyboard" rows={KEYS} />
          <div className="space-y-5">
            <Section title="Flying" rows={FLIGHT} />
            <Section title="Mouse & touch" rows={MOUSE} icon={<Mouse className="w-3 h-3" />} />
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Tip: every object has its own link. Select something, then copy the address bar to share exactly what you’re
              looking at.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const Section: React.FC<{ title: string; rows: [string, string][]; icon?: React.ReactNode }> = ({ title, rows, icon }) => (
  <div>
    <h3 className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-2">
      {icon}
      {title}
    </h3>
    <dl className="space-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-3">
          <dt>
            <kbd className="px-1.5 py-0.5 rounded-md bg-white/[0.08] border border-white/10 font-mono text-[10.5px] text-slate-100 whitespace-nowrap">
              {k}
            </kbd>
          </dt>
          <dd className="text-slate-300 text-right">{v}</dd>
        </div>
      ))}
    </dl>
  </div>
);
