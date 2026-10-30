import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft, ArrowUp, ArrowDown, Zap, Clock } from 'lucide-react';
import type { UnifiedCelestialObject } from '../types/universe';

export interface PaletteAction {
  id: string;
  label: string;
  hint: string;
  keywords: string;
  icon?: React.ReactNode;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  searchableObjects: UnifiedCelestialObject[];
  catalogById: Map<string, UnifiedCelestialObject>;
  quickPickIds: string[];
  actions: PaletteAction[];
  onSelectObject: (id: string) => void;
}

type Row =
  | { kind: 'object'; obj: UnifiedCelestialObject }
  | { kind: 'action'; action: PaletteAction };

const CATEGORY_LABEL: Record<string, string> = {
  planet: 'Planet',
  moon: 'Moon',
  'dwarf-planet': 'Dwarf planet',
  star: 'Star',
  exoplanet: 'Exoplanet',
  satellite: 'Satellite',
  spacecraft: 'Spacecraft',
  nebula: 'Nebula',
  cluster: 'Star cluster',
  galaxy: 'Galaxy',
  'black-hole': 'Black hole',
  'cosmic-structure': 'Cosmic structure',
  constellation: 'Constellation',
};

// Small boost so famous objects beat obscure catalogue entries with similar names
const CATEGORY_RANK: Record<string, number> = {
  planet: 0,
  'dwarf-planet': 1,
  moon: 1,
  spacecraft: 1,
  star: 3,
  galaxy: 2,
  nebula: 2,
  'black-hole': 2,
  constellation: 3,
  satellite: 4,
  cluster: 4,
  'cosmic-structure': 3,
  exoplanet: 5,
};

const RECENTS_KEY = 'gu-recent-searches-v1';

function loadRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]').slice(0, 6);
  } catch {
    return [];
  }
}
function saveRecent(id: string) {
  try {
    const next = [id, ...loadRecents().filter((x) => x !== id)].slice(0, 6);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable
  }
}

export const CommandPalette: React.FC<Props> = ({
  open,
  onClose,
  searchableObjects,
  catalogById,
  quickPickIds,
  actions,
  onSelectObject,
}) => {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      setRecents(loadRecents());
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const { rows, sections } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Row[] = [];
    const secs: { title: string; start: number }[] = [];

    if (!q) {
      const recentObjs = recents.map((id) => catalogById.get(id)).filter(Boolean) as UnifiedCelestialObject[];
      if (recentObjs.length) {
        secs.push({ title: 'Recent', start: out.length });
        recentObjs.forEach((obj) => out.push({ kind: 'object', obj }));
      }
      secs.push({ title: 'Popular destinations', start: out.length });
      quickPickIds
        .filter((id) => !recents.includes(id))
        .map((id) => catalogById.get(id))
        .filter(Boolean)
        .forEach((obj) => out.push({ kind: 'object', obj: obj as UnifiedCelestialObject }));
      secs.push({ title: 'Actions', start: out.length });
      actions.forEach((action) => out.push({ kind: 'action', action }));
      return { rows: out, sections: secs };
    }

    const matchedActions = actions.filter(
      (a) => a.label.toLowerCase().includes(q) || a.keywords.toLowerCase().includes(q)
    );

    const scored: { obj: UnifiedCelestialObject; score: number }[] = [];
    for (const item of searchableObjects) {
      const nameL = item.name.toLowerCase();
      let score = -1;
      if (nameL === q) score = 0;
      else if (nameL.startsWith(q)) score = 10;
      else if (nameL.split(/[\s(\-]+/).some((w) => w.startsWith(q))) score = 20;
      else if (nameL.includes(q)) score = 30;
      else if (item.subtitle.toLowerCase().includes(q)) score = 45;
      if (score < 0) continue;
      scored.push({ obj: item, score: score + (CATEGORY_RANK[item.category] ?? 4) + nameL.length / 100 });
      if (scored.length > 400) break;
    }
    scored.sort((a, b) => a.score - b.score);
    const top = scored.slice(0, 30);

    if (top.length) {
      secs.push({ title: `Objects`, start: out.length });
      top.forEach(({ obj }) => out.push({ kind: 'object', obj }));
    }
    if (matchedActions.length) {
      secs.push({ title: 'Actions', start: out.length });
      matchedActions.forEach((action) => out.push({ kind: 'action', action }));
    }
    return { rows: out, sections: secs };
  }, [query, searchableObjects, catalogById, quickPickIds, actions, recents]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  const choose = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === 'object') {
      saveRecent(row.obj.id);
      onSelectObject(row.obj.id);
    } else {
      row.action.run();
    }
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(rows.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(rows[cursor]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[9vh] bg-[#02050d]/55 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="animate-panel-in w-full max-w-xl rounded-2xl glass-panel overflow-hidden flex flex-col max-h-[72vh]"
        role="dialog"
        aria-label="Search the universe"
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/10">
          <Search className="w-4 h-4 text-cyan-300 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search planets, stars, galaxies, spacecraft — or type a command"
            className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
            aria-autocomplete="list"
            aria-controls="palette-results"
            aria-activedescendant={`palette-row-${cursor}`}
          />
          <kbd className="hidden sm:inline px-1.5 py-0.5 rounded bg-white/10 font-mono text-[10px] text-slate-400">Esc</kbd>
        </div>

        <div ref={listRef} id="palette-results" role="listbox" className="flex-1 overflow-y-auto py-1.5">
          {rows.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-slate-400">
              Nothing matches “{query}”. Try a planet, a star name, “Voyager” or “Andromeda”.
            </div>
          )}
          {rows.map((row, idx) => {
            const section = sections.find((s) => s.start === idx);
            const isActive = idx === cursor;
            return (
              <React.Fragment key={row.kind === 'object' ? `o-${row.obj.id}-${idx}` : `a-${row.action.id}`}>
                {section && (
                  <div className="px-4 pt-2.5 pb-1 text-[10px] font-mono uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    {section.title === 'Recent' && <Clock className="w-3 h-3" />}
                    {section.title === 'Actions' && <Zap className="w-3 h-3" />}
                    {section.title}
                  </div>
                )}
                <button
                  id={`palette-row-${idx}`}
                  data-row={idx}
                  role="option"
                  aria-selected={isActive}
                  onMouseMove={() => setCursor(idx)}
                  onClick={() => choose(row)}
                  className={`w-full px-4 py-2 flex items-center gap-3 text-left transition ${
                    isActive ? 'bg-cyan-500/15' : ''
                  }`}
                >
                  {row.kind === 'object' ? (
                    <>
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: row.obj.color }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white truncate">{row.obj.name}</span>
                          {row.obj.isRecent && (
                            <span className="px-1 py-px text-[9px] font-mono rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              NEW
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">{row.obj.subtitle}</div>
                      </div>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {CATEGORY_LABEL[row.obj.category] || row.obj.category}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="w-5 h-5 rounded-md bg-white/[0.06] flex items-center justify-center text-cyan-300 shrink-0">
                        {row.action.icon || <Zap className="w-3 h-3" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-white truncate">{row.action.label}</div>
                        <div className="text-[11px] text-slate-400 truncate">{row.action.hint}</div>
                      </div>
                    </>
                  )}
                  {isActive && <CornerDownLeft className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        <div className="hidden sm:flex items-center gap-4 px-4 py-2 border-t border-white/10 text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <ArrowUp className="w-3 h-3" />
            <ArrowDown className="w-3 h-3" /> move
          </span>
          <span className="flex items-center gap-1">
            <CornerDownLeft className="w-3 h-3" /> fly there
          </span>
          <span className="ml-auto">{searchableObjects.length.toLocaleString()} objects indexed</span>
        </div>
      </div>
    </div>
  );
};
