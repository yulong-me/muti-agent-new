/**
 * F0043: 前端日志上报端点
 *
 * POST /api/logs
 * 接收前端传来的日志条目，写入对应 room 的日志文件
 *
 * Body: {
 *   roomId: string,
 *   entries: Array<{ ts: string, level: LogLevel, event: string, meta?: Record<string, unknown> }>
 * }
 */

import { Router } from 'express';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { LogLevel } from '../lib/logger.js';

const LOG_DIR = join(process.cwd(), 'logs');

const VALID_LEVELS = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR']);

export const logsRouter = Router();

// 确保 logs 目录存在
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

logsRouter.post('/', (req, res) => {
  const { roomId, entries } = req.body as {
    roomId?: string;
    entries?: Array<{ ts: string; level: string; event: string; meta?: Record<string, unknown> }>;
  };

  if (!Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ error: 'entries must be a non-empty array' });
    return;
  }

  if (!roomId) {
    res.status(400).json({ error: 'roomId is required' });
    return;
  }

  const filepath = join(LOG_DIR, `${roomId}.log`);
  let written = 0;

  for (const entry of entries) {
    if (!VALID_LEVELS.has(entry.level)) continue;
    const line = JSON.stringify({
      ts: entry.ts || new Date().toISOString(),
      level: entry.level as LogLevel,
      event: entry.event || 'unknown',
      source: 'frontend',
      ...entry.meta,
    }) + '\n';
    try {
      appendFileSync(filepath, line, { encoding: 'utf8' });
      written++;
    } catch {
      // silent — don't fail on disk errors
    }
  }

  res.json({ status: 'ok', written });
});
