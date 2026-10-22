import type { Alert, WsFrame } from '../types/api';
import { IS_MOCK, listAlerts } from './api';
import { store } from './mockStore';

export type ConnectionMode = 'connecting' | 'websocket' | 'polling' | 'sample-feed' | 'offline';

export interface LiveStatus {
  mode: ConnectionMode;
  frames: number;
  lastFrameAt: number | null;
  detail: string;
}

export interface LiveHandle {
  close: () => void;
}

const POLL_MS = Math.max(4000, Number(import.meta.env.VITE_POLL_INTERVAL_MS ?? 15000));
const WS_URL = import.meta.env.VITE_WS_URL ?? '/ws/alerts';
const MAX_WS_ATTEMPTS = 2;

function absoluteWsUrl(path: string): string {
  if (/^wss?:\/\//i.test(path)) return path;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Single live-feed entry point for the UI.
 * mock mode -> emits generated records from the sample store.
 * api mode  -> WebSocket /ws/alerts, degrading to GET /api/alerts polling after MAX_WS_ATTEMPTS failures.
 * Callers only ever see WsFrame objects, so swapping transports does not touch component code.
 */
export function connectLive(onFrame: (frame: WsFrame) => void, onStatus: (status: LiveStatus) => void): LiveHandle {
  let closed = false;
  let interval: number | null = null;
  let timeout: number | null = null;
  let socket: WebSocket | null = null;
  let attempts = 0;
  let frames = 0;
  let lastFrameAt: number | null = null;
  let currentMode: ConnectionMode = 'connecting';
  let detail = 'Starting live feed';
  const seen = new Set<number>();

  const publish = () => {
    if (!closed) onStatus({ mode: currentMode, frames, lastFrameAt, detail });
  };

  const setMode = (mode: ConnectionMode, why: string) => {
    currentMode = mode;
    detail = why;
    publish();
  };

  const emit = (incoming: WsFrame[]) => {
    if (closed) return;
    const fresh = incoming.filter((frame) => {
      if (frame.type !== 'alert') return true;
      const id = (frame.data as Alert).id;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (fresh.length) {
      frames += fresh.length;
      lastFrameAt = Date.now();
      for (const frame of fresh) onFrame(frame);
      detail = `${fresh.length} frame(s) · ${new Date(lastFrameAt).toLocaleTimeString()}`;
    }
    publish();
  };

  const clearTimers = () => {
    if (interval !== null) window.clearInterval(interval);
    if (timeout !== null) window.clearTimeout(timeout);
    interval = null;
    timeout = null;
  };

  const startMockFeed = () => {
    setMode('sample-feed', 'Streaming from the bundled sample-data store');
    const schedule = () => {
      timeout = window.setTimeout(() => {
        timeout = null;
        if (closed) return;
        const frames = store.tickLive();
        if (frames.length) {
          emit(frames);
        } else {
          detail = 'Demo generator disabled in Settings — feed idle';
          publish();
        }
        schedule();
      }, store.feedIntervalMs());
    };
    emit(store.tickLive());
    schedule();
  };

  const startPolling = (reason: string) => {
    clearTimers();
    setMode('polling', reason);
    const pull = async () => {
      try {
        const page = await listAlerts({ page: 1, limit: 25 });
        if (seen.size === 0) {
          page.items.forEach((a) => seen.add(a.id));
          detail = `Baseline loaded: ${page.total} alerts`;
          publish();
          return;
        }
        emit(page.items.filter((a) => !seen.has(a.id)).map((data) => ({ type: 'alert' as const, data })));
      } catch {
        setMode('offline', 'Polling failed — backend not reachable');
      }
    };
    void pull();
    interval = window.setInterval(() => void pull(), POLL_MS);
  };

  const reconnectLater = (why: string) => {
    clearTimers();
    if (attempts >= MAX_WS_ATTEMPTS) {
      startPolling(why);
      return;
    }
    setMode('connecting', `${why} — retrying in ${1.2 * attempts}s`);
    timeout = window.setTimeout(() => {
      timeout = null;
      tryWebSocket();
    }, 1200 * attempts);
  };

  function tryWebSocket(): void {
    if (closed) return;
    attempts += 1;
    setMode('connecting', `Opening ${WS_URL} (attempt ${attempts})`);
    let ws: WebSocket;
    try {
      ws = new WebSocket(absoluteWsUrl(WS_URL));
    } catch {
      reconnectLater('WebSocket constructor failed');
      return;
    }
    socket = ws;
    const bail = () => {
      if (closed || socket !== ws) return;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      socket = null;
      reconnectLater('WebSocket unavailable after retries');
    };
    ws.onopen = () => setMode('websocket', 'Connected to /ws/alerts');
    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data as string) as WsFrame | WsFrame[];
        emit(Array.isArray(parsed) ? parsed : [parsed]);
      } catch {
        detail = 'Ignored a malformed frame';
        publish();
      }
    };
    ws.onerror = bail;
    ws.onclose = bail;
  }

  if (IS_MOCK) startMockFeed();
  else tryWebSocket();

  return {
    close: () => {
      closed = true;
      clearTimers();
      try {
        socket?.close();
      } catch {
        /* socket already torn down */
      }
      socket = null;
    },
  };
}
