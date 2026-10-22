import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  lastLoadedAt: number | null;
}

/** Runs an async loader on mount and whenever deps change; keeps the newest result on reload. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[], options: { silent?: boolean } = {}): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const ref = useRef(loader);
  ref.current = loader;

  useEffect(() => {
    let alive = true;
    if (!options.silent) setLoading(true);
    setError(null);
    ref
      .current()
      .then((result) => {
        if (!alive) return;
        setData(result);
        setLastLoadedAt(Date.now());
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload, lastLoadedAt };
}

/** Re-runs a callback on a fixed cadence while `enabled`. */
export function useInterval(callback: () => void, ms: number | null, enabled = true): void {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (!enabled || ms === null) return;
    const id = window.setInterval(() => saved.current(), ms);
    return () => window.clearInterval(id);
  }, [ms, enabled]);
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
