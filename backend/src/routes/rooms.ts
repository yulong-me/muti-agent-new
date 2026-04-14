/**
 * F004: Manager 路由器路由
 *
 * 核心变化：
 * - POST / 创建讨论室：不需要 topic（用户自由输入）
 * - POST /:id/messages 用户发消息 → Manager 处理
 * - 移除 /start 和 /advance（无状态机阶段）
 */

import { Router } from 'express';
import { error } from '../lib/logger.js';
import { v4 as uuid } from 'uuid';
import { store } from '../store.js';
import type { DiscussionRoom } from '../types.js';
import { handleUserMessage, routeToAgent } from '../services/stateMachine.js';
import { roomsRepo, sessionsRepo } from '../db/index.js';
import { auditRepo } from '../db/index.js';
import { archiveWorkspace } from '../services/workspace.js';
import { getAgent } from '../config/agentConfig.js';

export const roomsRouter = Router();

// GET /api/rooms — 列出所有讨论室（按最近活跃排序）
roomsRouter.get('/', (_req, res) => {
  res.json(roomsRepo.list());
});

// POST /api/rooms — 创建讨论室
roomsRouter.post('/', (req, res) => {
  const { managerId: rawManagerId, workerIds: rawWorkerIds } = req.body as {
    managerId?: string;
    workerIds?: string[];
    agents?: string[]; // Legacy: flat agents array
  };

  // Backward compat: accept legacy { agents: ['host', 'fs-dev', ...] }
  const managerId = rawManagerId ?? 'host';
  const workerIds: string[] = rawWorkerIds ?? (req.body as { agents?: string[] }).agents ?? [];

  if (!workerIds || workerIds.length < 1) {
    return res.status(400).json({ error: '至少选择 1 位专家' });
  }

  // Resolve manager
  const managerCfg = getAgent(managerId);
  if (!managerCfg) {
    return res.status(400).json({ error: `Manager not found: ${managerId}` });
  }
  if (managerCfg.role !== 'MANAGER') {
    return res.status(400).json({ error: `Agent ${managerId} is not a MANAGER` });
  }
  if (!managerCfg.enabled) {
    return res.status(400).json({ error: `Manager ${managerId} is disabled` });
  }

  // Resolve workers (with role + enabled validation)
  const invalid = workerIds.filter(id => !getAgent(id));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Agent not found: ${invalid.join(', ')}` });
  }
  const disabled = workerIds.filter(id => {
    const cfg = getAgent(id)!;
    return !cfg.enabled || cfg.role !== 'WORKER';
  });
  if (disabled.length > 0) {
    return res.status(400).json({ error: `Invalid workers (must be enabled WORKER): ${disabled.join(', ')}` });
  }

  const managerEntry = {
    id: uuid(),
    role: 'MANAGER' as const,
    name: managerCfg.name,
    domainLabel: managerCfg.roleLabel,
    configId: managerCfg.id,
    status: 'idle' as const,
  };

  const workerEntries = workerIds.map(id => {
    const cfg = getAgent(id)!;
    return {
      id: uuid(),
      role: 'WORKER' as const,
      name: cfg.name,
      domainLabel: cfg.roleLabel,
      configId: cfg.id,
      status: 'idle' as const,
    };
  });

  const room: DiscussionRoom = {
    id: uuid(),
    topic: '自由讨论',
    state: 'RUNNING',
    agents: [managerEntry, ...workerEntries],
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sessionIds: {},
    a2aDepth: 0,
    a2aCallChain: [],
  };
  store.create(room);
  roomsRepo.create(room);
  auditRepo.log('room:create', room.topic, undefined, {
    roomId: room.id,
    manager: managerEntry.name,
    workerCount: workerEntries.length,
    workers: workerEntries.map(w => w.name),
  });
  res.json(room);
});

// GET /api/rooms/:id — 获取讨论室
roomsRouter.get('/:id', (req, res) => {
  const room = store.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(room);
});

// GET /api/rooms/:id/messages — 轮询获取消息
roomsRouter.get('/:id/messages', (req, res) => {
  const room = store.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    state: room.state,
    messages: room.messages,
    agents: room.agents,
    report: room.report,
  });
});

// POST /api/rooms/:id/messages — 用户发送消息 → Manager 或直接 Agent 处理
roomsRouter.post('/:id/messages', async (req, res) => {
  const room = store.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.state === 'DONE') {
    return res.status(400).json({ error: 'Room already done' });
  }

  const { content, toAgentId } = req.body as { content?: string; toAgentId?: string };
  if (!content?.trim()) {
    return res.status(400).json({ error: 'content required' });
  }

  // F0042: toAgentId 验证 — 必须是在这个 room 内的 agent
  if (toAgentId) {
    const target = room.agents.find(a => a.id === toAgentId);
    if (!target) {
      return res.status(400).json({ error: `Agent not found: ${toAgentId}` });
    }
  }

  // 异步处理，不阻塞响应
  routeToAgent(req.params.id, content.trim(), toAgentId).catch(err => {
    error('route:msg_error', { roomId: req.params.id, error: String(err) });
  });

  res.json({ status: 'ok' });
});

// PATCH /api/rooms/:id/archive — 归档讨论室（软删除）
roomsRouter.patch('/:id/archive', async (req, res) => {
  const { id } = req.params;
  const room = store.get(id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  roomsRepo.archive(id);
  store.delete(id);
  await archiveWorkspace(id).catch(() => { }); // workspace 不存在也无妨

  auditRepo.log('room:archive', room.topic, undefined, { roomId: id });
  res.json({ status: 'ok' });
});

// GET /api/rooms/archived — 列出已归档讨论室
roomsRouter.get('/archived', (_req, res) => {
  res.json(roomsRepo.listArchived());
});

// DELETE /api/rooms/archived/:id — 彻底删除已归档讨论室
roomsRouter.delete('/archived/:id', (req, res) => {
  const { id } = req.params;
  roomsRepo.permanentDelete(id);
  sessionsRepo.deleteByRoom(id);
  auditRepo.log('room:permanent_delete', '', undefined, { roomId: id });
  res.json({ status: 'ok' });
});
