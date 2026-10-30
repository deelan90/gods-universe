import React from 'react';
import {
  SlidersHorizontal,
  Satellite,
  CloudSun,
  Camera,
  Navigation,
  RefreshCw,
  Keyboard,
  Search,
} from 'lucide-react';

export type DockPanel = 'layers' | 'tracker' | 'weather' | 'apod';

interface Props {
  active: DockPanel | null;
  onToggle: (panel: DockPanel) => void;
  routeOpen: boolean;
  onToggleRoute: () => void;
  onOpenSearch: () => void;
  onOpenSync: () => void;
  onOpenHelp: () => void;
  isSyncing: boolean;
  newDiscoveries: number;
  filtersActive: boolean;
  orientation: 'vertical' | 'horizontal';
}

interface Item {
  key: string;
  label: string;
  shortcut: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  accent: string;
  badge?: React.ReactNode;
  hideOnMobile?: boolean;
}

export const NavRail: React.FC<Props> = React.memo(
  ({
    active,
    onToggle,
    routeOpen,
    onToggleRoute,
    onOpenSearch,
    onOpenSync,
    onOpenHelp,
    isSyncing,
    newDiscoveries,
    filtersActive,
    orientation,
  }) => {
    const items: Item[] = [
      {
        key: 'search',
        label: 'Search',
        shortcut: '/',
        icon: <Search className="w-[18px] h-[18px]" />,
        active: false,
        onClick: onOpenSearch,
        accent: '#22d3ee',
        hideOnMobile: true,
      },
      {
        key: 'layers',
        label: 'Layers & filters',
        shortcut: 'F',
        icon: <SlidersHorizontal className="w-[18px] h-[18px]" />,
        active: active === 'layers',
        onClick: () => onToggle('layers'),
        accent: '#22d3ee',
        badge: filtersActive ? <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-cyan-300" /> : null,
      },
      {
        key: 'tracker',
        label: 'Live spacecraft',
        shortcut: 'T',
        icon: <Satellite className="w-[18px] h-[18px]" />,
        active: active === 'tracker',
        onClick: () => onToggle('tracker'),
        accent: '#34d399',
        badge: <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />,
      },
      {
        key: 'weather',
        label: 'Weather on other worlds',
        shortcut: 'M',
        icon: <CloudSun className="w-[18px] h-[18px]" />,
        active: active === 'weather',
        onClick: () => onToggle('weather'),
        accent: '#fb923c',
      },
      {
        key: 'apod',
        label: 'NASA picture of the day',
        shortcut: 'I',
        icon: <Camera className="w-[18px] h-[18px]" />,
        active: active === 'apod',
        onClick: () => onToggle('apod'),
        accent: '#a78bfa',
      },
      {
        key: 'route',
        label: 'Distance calculator',
        shortcut: 'R',
        icon: <Navigation className="w-[18px] h-[18px]" />,
        active: routeOpen,
        onClick: onToggleRoute,
        accent: '#34d399',
      },
      {
        key: 'sync',
        label: 'Data sources & updates',
        shortcut: '',
        icon: <RefreshCw className={`w-[18px] h-[18px] ${isSyncing ? 'animate-spin' : ''}`} />,
        active: false,
        onClick: onOpenSync,
        accent: '#22d3ee',
        badge:
          newDiscoveries > 0 ? (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-amber-400 text-slate-950 text-[9px] font-bold flex items-center justify-center">
              {newDiscoveries > 99 ? '99+' : newDiscoveries}
            </span>
          ) : null,
      },
      {
        key: 'help',
        label: 'Controls & shortcuts',
        shortcut: '?',
        icon: <Keyboard className="w-[18px] h-[18px]" />,
        active: false,
        onClick: onOpenHelp,
        accent: '#94a3b8',
        hideOnMobile: true,
      },
    ];

    const vertical = orientation === 'vertical';

    return (
      <nav
        aria-label="Observatory tools"
        className={
          vertical
            ? 'pointer-events-auto flex flex-col items-center gap-1 p-1.5 rounded-2xl glass-pill'
            : 'pointer-events-auto flex items-center gap-1 p-1 rounded-2xl glass-pill overflow-x-auto no-scrollbar'
        }
      >
        {items.map((it, i) => {
          if (!vertical && it.hideOnMobile) return null;
          return (
            <React.Fragment key={it.key}>
              {vertical && (i === 1 || i === 6) && <span className="w-6 h-px bg-white/10 my-0.5" />}
              <button
                onClick={it.onClick}
                aria-pressed={it.active}
                aria-label={it.label}
                className={`group relative shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition ${
                  it.active ? 'text-white' : 'text-slate-400 hover:text-white hover:bg-white/[0.07]'
                }`}
                style={
                  it.active
                    ? { backgroundColor: `${it.accent}2b`, boxShadow: `inset 0 0 0 1px ${it.accent}99` }
                    : undefined
                }
              >
                <span style={it.active ? { color: it.accent } : undefined}>{it.icon}</span>
                {it.badge}
                {vertical && (
                  <span className="pointer-events-none absolute left-full ml-2.5 px-2 py-1 rounded-lg bg-slate-950/95 border border-white/10 text-[11px] text-slate-100 whitespace-nowrap opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 transition flex items-center gap-2 shadow-xl z-50">
                    {it.label}
                    {it.shortcut && (
                      <kbd className="px-1.5 py-px rounded bg-white/10 font-mono text-[10px] text-slate-300">
                        {it.shortcut}
                      </kbd>
                    )}
                  </span>
                )}
              </button>
            </React.Fragment>
          );
        })}
      </nav>
    );
  }
);
