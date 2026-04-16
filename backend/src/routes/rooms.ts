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
import { routeToAgent, generateReportInline } from '../services/stateMachine.js';
import { info } from '../lib/logger.js';
import { roomsRepo, sessionsRepo, messagesRepo } from '../db/index.js';
import { auditRepo } from '../db/index.js';
import { archiveWorkspace, validateWorkspacePath } from '../services/workspace.js';
import { getAgent } from '../config/agentConfig.js';

export const roomsRouter = Router();

// GET /api/rooms — 列出所有讨论室（按最近活跃排序）
roomsRouter.get('/', (_req, res) => {
  res.json(roomsRepo.list());
});

// GET /api/rooms/sidebar — 轻量列表，用于侧边栏导航（不含全量 messages）
roomsRouter.get('/sidebar', (_req, res) => {
  res.json(roomsRepo.listSidebar());
});

// POST /api/rooms — 创建讨论室
roomsRouter.post('/', async (req, res) => {
  const { managerId: rawManagerId, workerIds: rawWorkerIds, workspacePath } = req.body as {
    managerId?: string;
    workerIds?: string[];
    agents?: string[]; // Legacy: flat agents array
    workspacePath?: string; // F006: custom workspace directory
  };

  // Backward compat: accept legacy { agents: ['host', 'fs-dev', ...] }
  const managerId = rawManagerId ?? 'host';
  const workerIds: string[] = rawWorkerIds ?? (req.body as { agents?: string[] }).agents ?? [];

  // F006: Validate custom workspace path if provided
  if (workspacePath) {
    try {
      await validateWorkspacePath(workspacePath);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }

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
    workspace: workspacePath,
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

// POST /api/rooms/:id/messages — 用户发送消息 → 路由前置 + Fallback 拦截
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

  // 目标必须明确
  const target = toAgentId
    ? room.agents.find(a => a.id === toAgentId)
    : null;

  if (toAgentId && !target) {
    return res.status(400).json({ error: `Agent not found: ${toAgentId}` });
  }

  // System Dispatcher: 无 toAgentId 时，尝试找最近活跃的 Worker
  if (!target) {
    const workers = room.agents.filter(a => a.role === 'WORKER');
    if (workers.length === 0) {
      return res.status(400).json({ error: 'Target Expert Required: no experts in this room' });
    }
    // 找最近一条 WORKER 消息对应的 agent
    const lastWorkerMsg = [...room.messages]
      .reverse()
      .find(m => m.agentRole === 'WORKER');
    const lastActiveWorker = lastWorkerMsg
      ? workers.find(w => w.name === lastWorkerMsg.agentName) ?? workers[0]
      : workers[0];

    if (!lastActiveWorker) {
      return res.status(400).json({ error: 'Target Expert Required: could not determine routing target' });
    }

    // 同步路由日志（< 20ms KPI）
    info('dispatcher:resolve', { roomId: req.params.id, targetAgentId: lastActiveWorker.id, targetAgentName: lastActiveWorker.name, via: 'last_active_worker' });

    // 异步处理，不阻塞响应
    routeToAgent(req.params.id, content.trim(), lastActiveWorker.id).catch(err => {
      error('route:msg_error', { roomId: req.params.id, error: String(err) });
    });

    return res.json({ status: 'ok', routedTo: lastActiveWorker.id });
  }

  // 异步处理，不阻塞响应
  routeToAgent(req.params.id, content.trim(), target.id).catch(err => {
    error('route:msg_error', { roomId: req.params.id, error: String(err) });
  });

  res.json({ status: 'ok' });
});

// POST /api/rooms/:id/report — 生成报告（无状态，系统级服务）
roomsRouter.post('/:id/report', async (req, res) => {
  const room = store.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const allContent = room.messages
    .map(m => `【${m.agentName}】${m.content}`)
    .join('\n\n');

  if (!allContent.trim()) {
    return res.status(400).json({ error: 'No messages to generate report from' });
  }

  // 用第一个 WORKER 作为报告生成的执行者（无状态，系统级角色）
  const worker = room.agents.find(a => a.role === 'WORKER');
  if (!worker) {
    return res.status(400).json({ error: 'No expert available to generate report' });
  }

  // 同步生成报告（简短操作）
  const reportOutput = await generateReportInline(room.topic, allContent, worker, req.params.id);

  store.update(req.params.id, { state: 'DONE', report: reportOutput });
  roomsRepo.update(req.params.id, { state: 'DONE', report: reportOutput });

  res.json({ summary: reportOutput, actionItems: [] });
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

// POST /api/rooms/:id/agents — 运行时追加 WORKER agent 入群（F007）
roomsRouter.post('/:id/agents', (req, res) => {
  const { id } = req.params;
  const { agentId } = req.body as { agentId?: string };

  const room = store.get(id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.state === 'DONE') return res.status(400).json({ error: 'Room 已结束，无法添加成员' });

  if (!agentId) return res.status(400).json({ error: 'agentId required' });

  // 已存在校验
  if (room.agents.some(a => a.configId === agentId)) {
    return res.status(400).json({ error: 'Agent 已在讨论中' });
  }

  const cfg = getAgent(agentId);
  if (!cfg) return res.status(404).json({ error: `Agent not found: ${agentId}` });

  // 角色校验：仅允许追加 WORKER
  if (cfg.role !== 'WORKER') {
    return res.status(400).json({ error: '无法追加 MANAGER 角色' });
  }

  // 启用状态校验
  if (!cfg.enabled) {
    return res.status(400).json({ error: 'Agent 未启用，无法加入讨论' });
  }

  const newAgent = {
    id: uuid(),
    role: 'WORKER' as const,
    name: cfg.name,
    domainLabel: cfg.roleLabel,
    configId: cfg.id,
    status: 'idle' as const,
  };

  // 系统消息
  const systemMsg = {
    id: uuid(),
    agentRole: 'WORKER' as const,
    agentName: cfg.name,
    content: `${cfg.name} 加入了讨论`,
    timestamp: Date.now(),
    type: 'system' as const,
  };

  room.agents.push(newAgent);
  room.messages.push(systemMsg);
  room.updatedAt = Date.now();

  // 持久化
  roomsRepo.update(id, { agents: room.agents });
  messagesRepo.insert(id, systemMsg);

  // Socket 广播
  import('../services/socketEmitter.js').then(({ emitRoomAgentJoined }) => {
    emitRoomAgentJoined(id, newAgent, systemMsg, room.agents);
  }).catch(() => { });

  res.json({ room, systemMessage: systemMsg });
});

// DELETE /api/rooms/archived/:id — 彻底删除已归档讨论室
roomsRouter.delete('/archived/:id', (req, res) => {
  const { id } = req.params;
  const archived = roomsRepo.listArchived().find(r => r.id === id);
  if (!archived) return res.status(404).json({ error: 'Archived room not found' });
  roomsRepo.permanentDelete(id);
  sessionsRepo.deleteByRoom(id);
  auditRepo.log('room:permanent_delete', archived.topic, undefined, { roomId: id });
  res.json({ status: 'ok' });
});
