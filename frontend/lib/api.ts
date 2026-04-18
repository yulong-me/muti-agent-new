/**
 * Centralized API base URL configuration.
 *
 * Resolution order (first match wins):
 *   1. `process.env.NEXT_PUBLIC_API_URL` — explicit override (production / docker)
 *   2. `window.location.protocol + '//' + window.location.host` — same origin (dev, proxy)
 *
 * For local dev without proxy: set NEXT_PUBLIC_API_URL in frontend/.env.local
 *
 * This replaces all inline `http://localhost:7001` hardcodes across components.
 */

/** Backend API base URL (without trailing slash) */
export const API_URL: string =
  process.env.NEXT_PUBLIC_API_URL ??
  (typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.host}`
    : 'http://localhost:7001');

/** Socket.io connection URL */
export const SOCKET_URL = API_URL;
