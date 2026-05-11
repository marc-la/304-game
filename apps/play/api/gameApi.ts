// gameApi.ts — re-exports the active Transport as `api`.
//
// Historically this module called fetch() directly against /api/...
// Now it delegates to whichever Transport is active (backend or local).
// The default is BackendTransport; LocalTransport is installed when
// the frontend probe finds the backend unreachable. Existing call
// sites (gameStore, components) continue to use `api.X(...)` unchanged.

import { backendTransport } from '../transport/backendTransport';
import type { Transport } from '../transport/types';

let _activeTransport: Transport = backendTransport;

export const setActiveTransport = (t: Transport): void => {
  _activeTransport = t;
};

export const getActiveTransport = (): Transport => _activeTransport;

// Re-export the active transport's methods as `api` via a Proxy so
// every call lazily resolves to the current transport. This means
// swapping transports at runtime is transparent to existing code.
export const api = new Proxy({} as Transport, {
  get(_, prop) {
    const t = _activeTransport;
    const fn = t[prop as keyof Transport];
    if (typeof fn === 'function') return fn.bind(t);
    return fn;
  },
});
