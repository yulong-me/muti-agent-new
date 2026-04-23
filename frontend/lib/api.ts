/**
 * Centralized API base URL configuration.
 *
 * Resolution order (first match wins):
 *   1. Non-empty `process.env.NEXT_PUBLIC_API_URL` — explicit override (production / docker)
 *   2. If current page runs on localhost:7002, talk to localhost:7001 (split dev mode)
 *   3. `window.location.protocol + '//' + window.location.host` — same origin (gateway / proxy deployments)
 *
 * This supports:
 *   - dev: `7002` -> backend `7001`
 *   - dev:gateway / prod gateway: browser hits same-origin `7000`
 *
 * This replaces all inline `http://localhost:7001` hardcodes across components.
 */

function resolveDefaultApiUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:7001';

  const { protocol, hostname, host, port } = window.location;

  // Split dev default: frontend 7002, backend 7001.
  if ((hostname === 'localhost' || hostname === '127.0.0.1') && port === '7002') {
    return `${protocol}//${hostname}:7001`;
  }

  return `${protocol}//${host}`;
}

/** Backend API base URL (without trailing slash) */
const envApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

export const API_URL: string = envApiUrl || resolveDefaultApiUrl();
