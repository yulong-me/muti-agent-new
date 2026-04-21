/**
 * F0043: 结构化日志模块
 *
 * 所有日志输出为 JSON 行，格式统一：
 * { "ts": "ISO", "level": "DEBUG|INFO|WARN|ERROR", "event": "name", ...fields }
 *
 * 通过 LOG_LEVEL 环境变量控制：
 *   debug → 输出 DEBUG / INFO / WARN / ERROR
 *   info  → 输出 INFO / WARN / ERROR
 *   warn  → 输出 WARN / ERROR
 *   error → 输出 ERROR
 *
 * 同时持久化到文件：
 *   - 有 roomId → logs/{roomId}.log
 *   - 无 roomId  → logs/server.log
 */

import { mkdirSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';
import { runtimePaths } from '../config/runtimePaths.js';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const MAX_STRING_LENGTH = 320;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 20;
const MAX_META_DEPTH = 2;
const isTestEnv = Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test';

const currentLevel = (() => {
  const env = (process.env.LOG_LEVEL ?? (isTestEnv ? 'warn' : 'info')).toUpperCase();
  return LEVEL_ORDER[env as LogLevel] ?? LEVEL_ORDER.INFO;
})();

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= currentLevel;
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}…`;
}

function normalizeValue(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
      ...(value.stack ? { stack: truncateString(value.stack) } : {}),
    };
  }

  if (typeof value === 'string') {
    return truncateString(value);
  }

  if (Array.isArray(value)) {
    const next = value.slice(0, MAX_ARRAY_ITEMS).map(item => normalizeValue(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      next.push(`…+${value.length - MAX_ARRAY_ITEMS} more`);
    }
    return next;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (depth >= MAX_META_DEPTH) {
    return '[Object]';
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const normalized: Record<string, unknown> = {};
  for (const [index, [key, entryValue]] of entries.entries()) {
    if (index >= MAX_OBJECT_KEYS) {
      normalized.__truncatedKeys = entries.length - MAX_OBJECT_KEYS;
      break;
    }
    normalized[key] = normalizeValue(entryValue, depth + 1);
  }
  return normalized;
}

function normalizeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  return normalizeValue(meta) as Record<string, unknown>;
}

// ── File persistence ───────────────────────────────────────────────────────────
const LOG_DIR = (() => {
  const dir = runtimePaths.logsDir;
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch {
    // ignore — will log to console only
  }
  return dir;
})();

function persist(level: LogLevel, event: string, meta?: Record<string, unknown>) {
  if (!LOG_DIR || isTestEnv) return;
  const ts = new Date().toISOString();
  const normalizedMeta = normalizeMeta(meta);
  const entry: Record<string, unknown> = { ts, level, event, ...normalizedMeta };
  const line = JSON.stringify(entry) + '\n';

  // Determine file: roomId gets its own file
  const roomId = normalizedMeta?.roomId as string | undefined;
  const filename = roomId ? `${roomId}.log` : 'server.log';
  const filepath = join(LOG_DIR, filename);

  try {
    appendFileSync(filepath, line, { encoding: 'utf8' });
  } catch {
    // silent — don't crash on disk errors
  }
}

// ── Logger ────────────────────────────────────────────────────────────────────
export function logger(level: LogLevel, event: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const ts = new Date().toISOString();
  const normalizedMeta = normalizeMeta(meta);
  const entry: Record<string, unknown> = {
    ts,
    level,
    event,
    ...normalizedMeta,
  };

  // Human-readable prefix for console
  const prefix = `[${entry.ts}] [${level}] ${event}`;
  const metaStr = normalizedMeta ? ` ${JSON.stringify(normalizedMeta)}` : '';

  if (level === 'ERROR') {
    console.error(`${prefix}${metaStr}`);
    console.error(JSON.stringify(entry));
  } else if (level === 'WARN') {
    console.warn(`${prefix}${metaStr}`);
  } else {
    console.log(`${prefix}${metaStr}`);
  }

  // Persist to file
  persist(level, event, normalizedMeta);
}

// ── Convenience aliases ───────────────────────────────────────────────────────
export const debug = (event: string, meta?: Record<string, unknown>) => logger('DEBUG', event, meta);
export const info  = (event: string, meta?: Record<string, unknown>) => logger('INFO',  event, meta);
export const warn  = (event: string, meta?: Record<string, unknown>) => logger('WARN',  event, meta);
export const error = (event: string, meta?: Record<string, unknown>) => logger('ERROR', event, meta);
// Keep log as direct alias for existing code
export const log = logger;
