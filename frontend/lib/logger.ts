/**
 * F0043: 前端结构化日志模块
 *
 * 结构化输出 JSON，格式：{ ts, level, event, ...fields }
 * 通过 localStorage.debug 控制 DEBUG 级别输出
 *
 * 同时：
 * - 维护内存 debug log store（最近 100 条），供 DebugPanel 消费
 * - 批量 POST 到后端持久化（logs/{roomId}.log）
 */

import { API_URL } from './api'

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const MAX_STRING_LENGTH = 320
const MAX_ARRAY_ITEMS = 20
const MAX_OBJECT_KEYS = 20
const MAX_META_DEPTH = 2

const currentLevel = (() => {
  try {
    const stored = localStorage.getItem('log_level');
    if (stored) return LEVEL_ORDER[stored as LogLevel] ?? LEVEL_ORDER.INFO;
  } catch {
    // localStorage may not be available (SSR)
  }
  return LEVEL_ORDER.INFO;
})();

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= currentLevel;
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value
  return `${value.slice(0, MAX_STRING_LENGTH)}…`
}

function normalizeValue(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
      ...(value.stack ? { stack: truncateString(value.stack) } : {}),
    }
  }

  if (typeof value === 'string') {
    return truncateString(value)
  }

  if (Array.isArray(value)) {
    const next = value.slice(0, MAX_ARRAY_ITEMS).map(item => normalizeValue(item, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) {
      next.push(`…+${value.length - MAX_ARRAY_ITEMS} more`)
    }
    return next
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  if (depth >= MAX_META_DEPTH) {
    return '[Object]'
  }

  const entries = Object.entries(value as Record<string, unknown>)
  const normalized: Record<string, unknown> = {}
  for (const [index, [key, entryValue]] of entries.entries()) {
    if (index >= MAX_OBJECT_KEYS) {
      normalized.__truncatedKeys = entries.length - MAX_OBJECT_KEYS
      break
    }
    normalized[key] = normalizeValue(entryValue, depth + 1)
  }
  return normalized
}

function normalizeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined
  return normalizeValue(meta) as Record<string, unknown>
}

// ── Debug log store for DebugPanel ────────────────────────────────────────────
const DEBUG_MAX = 100;
const debugLogStore = {
  current: [] as { ts: string; level: LogLevel; event: string; meta?: Record<string, unknown> }[],
};

export function getDebugLog() {
  return debugLogStore.current;
}

export function clearDebugLog() {
  debugLogStore.current = [];
}

// ── Room context (set from RoomView) ─────────────────────────────────────────
let currentRoomId: string | null = null;

export function setRoomId(roomId: string | null) {
  currentRoomId = roomId;
}

// ── Backend persistence (batched POST) ───────────────────────────────────────
const API_BASE = API_URL;
const FLUSH_INTERVAL_MS = 2000;
const BATCH_MAX = 50;

const pendingEntries: { ts: string; level: LogLevel; event: string; meta?: Record<string, unknown> }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushToBackend() {
  if (pendingEntries.length === 0) return;
  const roomId = currentRoomId;
  if (!roomId) {
    pendingEntries.length = 0;
    return;
  }

  const entries = pendingEntries.splice(0, pendingEntries.length);
  try {
    await fetch(`${API_BASE}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, entries }),
    });
  } catch {
    // silent — don't crash on network errors
  }
}

function scheduleFlush() {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushToBackend();
  }, FLUSH_INTERVAL_MS);
}

function persistToBackend(entry: { ts: string; level: LogLevel; event: string; meta?: Record<string, unknown> }) {
  if (!currentRoomId) return;
  pendingEntries.push(entry);
  if (pendingEntries.length >= BATCH_MAX) {
    // Flush immediately if batch is full
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushToBackend();
  } else {
    scheduleFlush();
  }
}

// ── Logger ────────────────────────────────────────────────────────────────────
export function logger(level: LogLevel, event: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const ts = new Date().toISOString();
  const normalizedMeta = normalizeMeta(meta)
  const entry = { ts, level, event, meta: normalizedMeta };

  // Store in memory (for DebugPanel)
  debugLogStore.current = [entry, ...debugLogStore.current].slice(0, DEBUG_MAX);

  // Human-readable output
  const prefix = `[${ts}] [${level}] ${event}`;
  const metaStr = normalizedMeta ? ` ${JSON.stringify(normalizedMeta)}` : '';

  if (level === 'ERROR') {
    console.error(`${prefix}${metaStr}`);
  } else if (level === 'WARN') {
    console.warn(`${prefix}${metaStr}`);
  } else {
    console.log(`${prefix}${metaStr}`);
  }

  // Persist to backend (async, non-blocking)
  persistToBackend(entry);
}

// ── Convenience aliases ────────────────────────────────────────────────────────
export const debug = (event: string, meta?: Record<string, unknown>) => logger('DEBUG', event, meta);
export const info  = (event: string, meta?: Record<string, unknown>) => logger('INFO',  event, meta);
export const warn  = (event: string, meta?: Record<string, unknown>) => logger('WARN',  event, meta);
export const error = (event: string, meta?: Record<string, unknown>) => logger('ERROR', event, meta);

// ── Backward-compat: telemetry() alias ───────────────────────────────────────
export const telemetry = debug;

// ── localStorage helpers ──────────────────────────────────────────────────────
export function setLogLevel(level: LogLevel) {
  try {
    localStorage.setItem('log_level', level);
  } catch {
    // ignore
  }
}
