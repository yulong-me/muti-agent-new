/**
 * F004: Manager 路由器路由
 *
 * 核心变化：
 * - POST / 创建讨论室：不需要 topic（用户自由输入）
 * - POST /:id/messages 用户发消息 → Manager 处理
 * - 移除 /start 和 /advance（无状态机阶段）
 */

import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { store } from '../store.js';
import type { DiscussionRoom } from '../types.js';
import { handleUserMessage } from '../services/stateMachine.js';
import { roomsRepo } from '../db/index.js';
import { auditRepo } from '../db/index.js';
import { getAgent } from '../config/agentConfig.js';

export const roomsRouter = Router();

// GET /api/rooms — 列出所有讨论室
roomsRouter.get('/', (_req, res) => {
  res.json(store.list());
});

// POST /api/rooms — 创建讨论室（F004：无需 topic）
roomsRouter.post('/', (req, res) => {
  const { agents: agentIds } = req.body as { agents: string[] };
  if (!agentIds || agentIds.length < 1) {
    return res.status(400).json({ error: 'at least 1 agent required' });
  }

  const invalidAgents = agentIds.filter(id => !getAgent(id));
  if (invalidAgents.length > 0) {
    return res.status(400).json({ error: `Agent not found: ${invalidAgents.join(', ')}` });
  }

  const agentEntries = agentIds.map(id => {
    const cfg = getAgent(id)!;
    return {
      id: uuid(),
      role: cfg.role,
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
    agents: [
      {
        id: uuid(),
        role: 'MANAGER' as const,
        name: '主持人',
        domainLabel: '主持人',
        configId: 'host',
        status: 'idle' as const,
      },
      ...(agentEntries as DiscussionRoom['agents']),
    ],
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
    agentCount: room.agents.length,
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
  res.json({
    state: room.state,
    messages: room.messages,
    agents: room.agents,
    report: room.report,
  });
});

// POST /api/rooms/:id/messages — 用户发送消息 → Manager 处理
roomsRouter.post('/:id/messages', async (req, res) => {
  const room = store.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.state === 'DONE') {
    return res.status(400).json({ error: 'Room already done' });
  }

  const { content } = req.body as { content?: string };
  if (!content?.trim()) {
    return res.status(400).json({ error: 'content required' });
  }

  // 异步处理，不阻塞响应
  handleUserMessage(req.params.id, content.trim()).catch(err => {
    console.error('[ERROR] handleUserMessage failed:', err);
  });

  res.json({ status: 'ok' });
});
