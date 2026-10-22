import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Alert, Incident, SecurityEvent, WsFrame } from '../types/api';
import { connectLive, type LiveStatus } from '../services/ws';

const FLASH_MS = 5000;

interface LiveContextValue {
  status: LiveStatus;
  /** Alerts delivered by the live transport, newest first. */
  stream: Alert[];
  /** Alert ids that just arrived — used for the row-highlight animation. */
  flash: Set<number>;
  /** Bumped on every frame batch so data views can refetch aggregates. */
  nonce: number;
  liveEvents: SecurityEvent[];
  liveIncidents: Incident[];
  paused: boolean;
  togglePaused: () => void;
  refresh: () => void;
}

const LiveContext = createContext<LiveContextValue | null>(null);

const INITIAL_STATUS: LiveStatus = { mode: 'connecting', frames: 0, lastFrameAt: null, detail: 'Starting live feed' };

export function LiveProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LiveStatus>(INITIAL_STATUS);
  const [stream, setStream] = useState<Alert[]>([]);
  const [liveEvents, setLiveEvents] = useState<SecurityEvent[]>([]);
  const [liveIncidents, setLiveIncidents] = useState<Incident[]>([]);
  const [flash, setFlash] = useState<Set<number>>(new Set());
  const [nonce, setNonce] = useState(0);
  const [paused, setPaused] = useState(false);
  const timers = useRef<number[]>([]);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    const handle = connectLive(
      (frame: WsFrame) => {
        if (pausedRef.current) return;
        if (frame.type === 'alert') {
          const alert = frame.data as Alert;
          setStream((prev) => [alert, ...prev].slice(0, 40));
          setFlash((prev) => new Set(prev).add(alert.id));
          const timer = window.setTimeout(() => {
            setFlash((prev) => {
              const next = new Set(prev);
              next.delete(alert.id);
              return next;
            });
          }, FLASH_MS);
          timers.current.push(timer);
        } else if (frame.type === 'event') {
          setLiveEvents((prev) => [frame.data as SecurityEvent, ...prev].slice(0, 40));
        } else {
          setLiveIncidents((prev) => [frame.data as Incident, ...prev].slice(0, 20));
        }
        setNonce((n) => n + 1);
      },
      setStatus,
    );
    return () => {
      handle.close();
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, []);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const togglePaused = useCallback(() => setPaused((p) => !p), []);

  const value = useMemo<LiveContextValue>(
    () => ({ status, stream, flash, nonce, liveEvents, liveIncidents, paused, togglePaused, refresh }),
    [status, stream, flash, nonce, liveEvents, liveIncidents, paused, togglePaused, refresh],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLive must be used inside LiveProvider');
  return ctx;
}
