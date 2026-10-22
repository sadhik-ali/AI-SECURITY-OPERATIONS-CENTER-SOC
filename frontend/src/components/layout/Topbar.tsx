import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, Pause, Play, Search, Server, User as UserIcon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLive } from '../../context/LiveContext';
import type { ConnectionMode } from '../../services/ws';
import { DATA_SOURCE, IS_MOCK } from '../../services/api';

const MODE_TONE: Record<ConnectionMode, { dot: string; text: string; label: string }> = {
  connecting: { dot: 'bg-slate-400', text: 'text-slate-300', label: 'Connecting' },
  websocket: { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'WebSocket' },
  polling: { dot: 'bg-amber-400', text: 'text-amber-300', label: 'Polling' },
  'sample-feed': { dot: 'bg-sky-400', text: 'text-sky-300', label: 'Sample feed' },
  offline: { dot: 'bg-red-500', text: 'text-red-300', label: 'Offline' },
};

function LiveIndicator() {
  const { status, paused, togglePaused } = useLive();
  const tone = MODE_TONE[status.mode];
  return (
    <div className="flex items-center gap-2 rounded-md border border-soc-700 bg-soc-800/70 px-2.5 py-1.5">
      <span className={`size-2 rounded-full ${tone.dot} ${status.mode === 'offline' ? '' : 'animate-pulse-dot'}`} />
      <div className="hidden leading-tight md:block">
        <p className={`text-[11px] font-semibold ${tone.text}`}>{paused ? `${tone.label} · paused` : tone.label}</p>
        <p className="text-[10px] text-soc-400">
          {status.frames} frame{status.frames === 1 ? '' : 's'}
          {status.lastFrameAt ? ` · ${new Date(status.lastFrameAt).toLocaleTimeString()}` : ''}
        </p>
      </div>
      <button
        type="button"
        onClick={togglePaused}
        className="rounded p-1 text-soc-300 hover:bg-soc-750 hover:text-soc-100"
        title={paused ? 'Resume the live view' : 'Pause the live view'}
        aria-label={paused ? 'Resume live view' : 'Pause live view'}
      >
        {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
      </button>
    </div>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const initials = user.full_name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md border border-soc-700 bg-soc-800/70 px-2 py-1.5 text-left hover:border-soc-600"
        aria-expanded={open}
      >
        <span className="grid size-7 place-items-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">{initials}</span>
        <span className="hidden leading-tight lg:block">
          <span className="block max-w-[9rem] truncate text-xs font-medium text-soc-100">{user.full_name}</span>
          <span className="block text-[10px] uppercase tracking-wide text-soc-400">{user.role}</span>
        </span>
        <ChevronDown className="size-3.5 text-soc-400" />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1.5 w-64 animate-fade-in rounded-lg border border-soc-700 bg-soc-900 p-1.5 shadow-panel">
          <div className="border-b border-soc-800 px-2.5 pb-2.5 pt-1.5">
            <p className="flex items-center gap-2 text-sm text-soc-100">
              <UserIcon className="size-3.5 text-soc-400" />
              {user.full_name}
            </p>
            <p className="mt-1 truncate text-xs text-soc-400">{user.email}</p>
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-soc-400">
              <Server className="size-3" />
              {user.preferred_timezone} · role {user.role}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate('/settings');
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-soc-200 hover:bg-soc-800"
          >
            Manage account
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              signOut();
              navigate('/login');
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-red-300 hover:bg-red-500/10"
          >
            <LogOut className="size-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Topbar() {
  const [term, setTerm] = useState('');
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-20 flex h-[60px] items-center gap-3 border-b border-soc-800 bg-soc-950/85 px-3 backdrop-blur-md sm:px-5">
      <form
        className="relative min-w-0 flex-1 max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(term.trim() ? `/alerts?q=${encodeURIComponent(term.trim())}` : '/alerts');
        }}
      >
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-soc-400" />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className="field pl-8"
          placeholder="Search alerts, rule names, IPs, hosts, accounts…"
          aria-label="Search the alert queue"
        />
      </form>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {IS_MOCK ? (
          <span
            className="pill border-amber-500/40 bg-amber-500/12 text-amber-300"
            title="All records in this build are synthetic demo data generated by the sample store"
          >
            DEMO MODE
          </span>
        ) : (
          <span className="pill border-emerald-500/40 bg-emerald-500/12 text-emerald-300" title={`Bound to ${DATA_SOURCE} backend`}>
            LIVE BACKEND
          </span>
        )}
        <LiveIndicator />
        <UserMenu />
      </div>
    </header>
  );
}
