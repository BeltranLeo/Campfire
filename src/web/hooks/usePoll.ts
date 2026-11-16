import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  /** Loads again now (the "Try again" buttons). */
  reload: () => void;
}

/**
 * Runs `load` now and then every `intervalMs` (once if omitted). A refresh that fails keeps the last
 * good data and reports the error; `key` restarts the cycle when what to load changes.
 */
export function usePoll<T>(load: () => Promise<T>, key: string, intervalMs?: number): PollState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  // The latest `load`, so a new closure on every render does not restart the timer.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let current = true;
    const run = () => {
      loadRef.current().then(
        (value) => {
          if (!current) return;
          setData(value);
          setError(null);
          setLoading(false);
        },
        (err: unknown) => {
          if (!current) return;
          setError(err);
          setLoading(false);
        },
      );
    };
    setLoading(true);
    run();
    const timer = intervalMs ? setInterval(run, intervalMs) : undefined;
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [key, intervalMs, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, error, loading, reload };
}
