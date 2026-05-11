// selectTransport — probe the backend; fall back to local.
//
// Called once at app start. Cached for the session. The user can
// retry detection by clicking "Reconnect" in the UI (which calls
// `resetTransport`).

import { setActiveTransport } from '../api/gameApi';
import { backendTransport } from './backendTransport';
import { localTransport } from './localTransport';
import type { Transport } from './types';

let cached: Transport | null = null;
let inflight: Promise<Transport> | null = null;

const probeBackend = async (timeoutMs = 2000): Promise<boolean> => {
  // AbortController for fast timeout — we don't want to block the UI
  // for 30+ seconds on a connection refused.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch('/api/health', {
      method: 'GET',
      signal: controller.signal,
    });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

export const selectTransport = async (): Promise<Transport> => {
  if (cached !== null) return cached;
  if (inflight !== null) return inflight;
  inflight = (async () => {
    const reachable = await probeBackend();
    cached = reachable ? backendTransport : localTransport;
    setActiveTransport(cached);
    inflight = null;
    return cached;
  })();
  return inflight;
};

export const resetTransport = (): void => {
  cached = null;
  inflight = null;
};

export const currentTransport = (): Transport | null => cached;
