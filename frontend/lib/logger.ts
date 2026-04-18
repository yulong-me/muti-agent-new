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
  const entry = { ts, level, event, meta };

  // Store in memory (for DebugPanel)
  debugLogStore.current = [entry, ...debugLogStore.current].slice(0, DEBUG_MAX);

  // Human-readable output
  const prefix = `[${ts}] [${level}] ${event}`;
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';

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
