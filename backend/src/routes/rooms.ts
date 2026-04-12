import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { store } from '../store.js';
import { DiscussionRoom } from '../types.js';
import { hostReply, agentInvestigate, agentDebate, addUserMessage } from '../services/stateMachine.js';
import { roomsRepo } from '../db/index.js';
import { auditRepo } from '../db/index.js';
import { getAgent } from '../config/agentConfig.js';

export const roomsRouter = Router();

// GET /api/rooms — 列出所有讨论室
roomsRouter.get('/', (_req, res) => {
  res.json(store.list());
});

// POST /api/rooms — 创建讨论室
roomsRouter.post('/', (req, res) => {
  const { topic, agents: agentIds } = req.body as { topic: string; agents: string[] };
  if (!topic || !agentIds || agentIds.length < 1) {
    return res.status(400).json({ error: 'topic and at least 1 agent required' });
  }

  // Resolve agent configs by id (id-based routing — avoids name collision risk)
  // 先验证所有 agent，全部有效后再创建 room（避免双重响应）
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

  const hostCfg = getAgent('host');
  const room: DiscussionRoom = {
    id: uuid(),
    topic,
    state: 'INIT',
    agents: [
      { id: uuid(), role: 'MANAGER' as const, name: '主持人', domainLabel: '主持人', configId: 'host', status: 'idle' as const },
      ...agentEntries as DiscussionRoom['agents'],
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
  auditRepo.log('room:create', room.topic, undefined, { roomId: room.id, agentCount: room.agents.length });
  res.json(room);
});

// GET /api/rooms/:id — 获取讨论室
roomsRouter.get('/:id', (req, res) => {
  const room = store.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(room);
});

// GET /api/rooms/:id/messages — 获取消息（轮询）
roomsRouter.get('/:id/messages', (req, res) => {
  const room = store.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ state: room.state, messages: room.messages, agents: room.agents, report: room.report });
});

// POST /api/rooms/:id/start — 开始讨论（幂等：非 INIT 状态直接返回 ok）
//主持人开场 (INIT) 结束后自动流转到 RESEARCH，所有 Agent 同步开始调查
roomsRouter.post('/:id/start', async (req, res) => {
  const room = store.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  console.log(`[DEBUG] POST /rooms/${req.params.id}/start state=${room.state} agents=${room.agents.map(a => `${a.name}(${a.status})`).join(', ')}`);
  if (room.state !== 'INIT') {
    return res.json({ status: 'ok', state: room.state, idempotent: true });
  }
  try {
    // 1. 主持人开场白（流式输出到前端）
    await hostReply(req.params.id, 'INIT');

    // 2. 自动流转 INIT → RESEARCH：所有专家 Agent 开始调查
    const specialistAgents = room.agents.filter(a => a.role === 'WORKER');
    store.update(req.params.id, { state: 'RESEARCH' });
    roomsRepo.update(req.params.id, { state: 'RESEARCH' });
    // 触发所有 Agent 并行调查 + 主持人协调（流式输出到前端）
    await Promise.all(specialistAgents.map(agent => agentInvestigate(req.params.id, agent)));
    await hostReply(req.params.id, 'RESEARCH');

    const updated = store.get(req.params.id);
    res.json({ status: 'ok', state: updated?.state });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST /api/rooms/:id/advance — 用户确认，进入下一步
roomsRouter.post('/:id/advance', async (req, res) => {
  const room = store.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const { userChoice } = req.body as { userChoice?: string };

  if (userChoice) {
    const choiceLabels: Record<string, string> = {
      confirm: '确认议题方向',
      debate: '进入辩论',
      research: '继续调查',
      converge: '确认收敛 / 进入收敛',
      continue: '继续辩论',
    };
    const label = choiceLabels[userChoice] || userChoice;
    addUserMessage(req.params.id, `选择了：${label}`);
  }

  try {
    const specialistAgents = room.agents.filter(a => a.role === 'WORKER');

    if (room.state === 'INIT') {
      store.update(req.params.id, { state: 'RESEARCH' });
      roomsRepo.update(req.params.id, { state: 'RESEARCH' });
      await Promise.all(specialistAgents.map(agent => agentInvestigate(req.params.id, agent)));
      await hostReply(req.params.id, 'RESEARCH');
    } else if (room.state === 'RESEARCH') {
      store.update(req.params.id, { state: 'DEBATE' });
      roomsRepo.update(req.params.id, { state: 'DEBATE' });
      await Promise.all(specialistAgents.map(agent =>
        agentDebate(req.params.id, agent, '各方已提交调查结论，请发表你的辩论观点。')
      ));
      await hostReply(req.params.id, 'DEBATE');
    } else if (room.state === 'DEBATE') {
      if (userChoice === 'continue') {
        await Promise.all(specialistAgents.map(agent =>
          agentDebate(req.params.id, agent, '请继续深化你的辩论观点。')
        ));
        await hostReply(req.params.id, 'DEBATE');
      } else {
        store.update(req.params.id, { state: 'CONVERGING' });
        roomsRepo.update(req.params.id, { state: 'CONVERGING' });
        await hostReply(req.params.id, 'CONVERGING');
      }
    } else if (room.state === 'CONVERGING') {
      if (userChoice === 'converge') {
        store.update(req.params.id, { state: 'DONE' });
        roomsRepo.update(req.params.id, { state: 'DONE' });
        await hostReply(req.params.id, 'DONE');
      } else if (userChoice === 'debate') {
        store.update(req.params.id, { state: 'DEBATE' });
        roomsRepo.update(req.params.id, { state: 'DEBATE' });
        await Promise.all(specialistAgents.map(agent =>
          agentDebate(req.params.id, agent, '请发表你的辩论观点。')
        ));
        await hostReply(req.params.id, 'DEBATE');
      } else if (userChoice === 'research') {
        store.update(req.params.id, { state: 'RESEARCH' });
        roomsRepo.update(req.params.id, { state: 'RESEARCH' });
        await Promise.all(specialistAgents.map(agent => agentInvestigate(req.params.id, agent)));
        await hostReply(req.params.id, 'RESEARCH');
      }
    }
    const updated = store.get(req.params.id);
    res.json({ status: 'ok', state: updated?.state });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
