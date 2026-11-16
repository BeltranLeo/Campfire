// Service configuration (arbiter and oracle keys, PUSD category, demo seller), fetched once per page load.

import { useEffect, useState } from 'react';
import { apiGet, type ApiConfig } from './api';

let pending: Promise<ApiConfig> | null = null;

export function loadConfig(): Promise<ApiConfig> {
  if (!pending) {
    pending = apiGet<ApiConfig>('/api/config');
    // A failed load is retried by the next caller instead of being cached.
    pending.catch(() => {
      pending = null;
    });
  }
  return pending;
}

/** The configuration, or null while it loads or if it failed (pages then fall back to raw values). */
export function useConfig(): ApiConfig | null {
  const [config, setConfig] = useState<ApiConfig | null>(null);
  useEffect(() => {
    let current = true;
    loadConfig().then(
      (value) => current && setConfig(value),
      () => {},
    );
    return () => {
      current = false;
    };
  }, []);
  return config;
}
