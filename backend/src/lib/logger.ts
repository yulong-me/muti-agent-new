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

const currentLevel = (() => {
  const env = (process.env.LOG_LEVEL ?? 'info').toUpperCase();
  return LEVEL_ORDER[env as LogLevel] ?? LEVEL_ORDER.INFO;
})();

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= currentLevel;
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
  if (!LOG_DIR) return;
  const ts = new Date().toISOString();
  const entry: Record<string, unknown> = { ts, level, event, ...meta };
  const line = JSON.stringify(entry) + '\n';

  // Determine file: roomId gets its own file
  const roomId = meta?.roomId as string | undefined;
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
  const entry: Record<string, unknown> = {
    ts,
    level,
    event,
    ...meta,
  };

  // Human-readable prefix for console
  const prefix = `[${entry.ts}] [${level}] ${event}`;
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';

  if (level === 'ERROR') {
    console.error(`${prefix}${metaStr}`);
    console.error(JSON.stringify(entry));
  } else if (level === 'WARN') {
    console.warn(`${prefix}${metaStr}`);
  } else {
    console.log(`${prefix}${metaStr}`);
  }

  // Persist to file
  persist(level, event, meta);
}

// ── Convenience aliases ───────────────────────────────────────────────────────
export const debug = (event: string, meta?: Record<string, unknown>) => logger('DEBUG', event, meta);
export const info  = (event: string, meta?: Record<string, unknown>) => logger('INFO',  event, meta);
export const warn  = (event: string, meta?: Record<string, unknown>) => logger('WARN',  event, meta);
export const error = (event: string, meta?: Record<string, unknown>) => logger('ERROR', event, meta);
// Keep log as direct alias for existing code
export const log = logger;
