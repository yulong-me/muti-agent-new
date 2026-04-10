import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { store } from '../store.js';
import { DiscussionRoom } from '../types.js';
import { hostReply, agentInvestigate, agentDebate, addUserMessage } from '../services/stateMachine.js';

export const roomsRouter = Router();

// GET /api/rooms — 列出所有讨论室
roomsRouter.get('/', (_req, res) => {
  res.json(store.list());
});

// POST /api/rooms — 创建讨论室
roomsRouter.post('/', (req, res) => {
  const { topic, agents: agentNames } = req.body as { topic: string; agents: string[] };
  if (!topic || !agentNames || agentNames.length < 2) {
    return res.status(400).json({ error: 'topic and at least 2 agents required' });
  }
  const room: DiscussionRoom = {
    id: uuid(),
    topic,
    state: 'INIT',
    agents: [
      { id: uuid(), role: 'HOST', name: '主持人', domainLabel: '主持人', status: 'idle' },
      ...agentNames.map(name => ({ id: uuid(), role: 'AGENT' as const, name, domainLabel: name, status: 'idle' as const })),
    ],
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sessionIds: {},
  };
  res.json(store.create(room));
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

// POST /api/rooms/:id/start — 开始 INIT 阶段（幂等：非 INIT 状态直接返回 ok）
roomsRouter.post('/:id/start', async (req, res) => {
  const room = store.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.state !== 'INIT') {
    // 幂等：不是 INIT 说明已经处理过了，直接返回
    return res.json({ status: 'ok', state: room.state, idempotent: true });
  }
  try {
    await hostReply(req.params.id, 'INIT');
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

  // Record user's choice as a message
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
    const specialistAgents = room.agents.filter(a => a.role === 'AGENT');

    if (room.state === 'INIT') {
      store.update(req.params.id, { state: 'RESEARCH' });
      // 并行调度所有 specialist agents 调查
      await Promise.all(specialistAgents.map(agent => agentInvestigate(req.params.id, agent)));
      await hostReply(req.params.id, 'RESEARCH');
    } else if (room.state === 'RESEARCH') {
      store.update(req.params.id, { state: 'DEBATE' });
      // Agents give debate perspectives in parallel, then host summarizes
      await Promise.all(specialistAgents.map(agent =>
        agentDebate(req.params.id, agent, '各方已提交调查结论，请发表你的辩论观点。')
      ));
      await hostReply(req.params.id, 'DEBATE');
    } else if (room.state === 'DEBATE') {
      if (userChoice === 'continue') {
        // Another round of agent debate
        await Promise.all(specialistAgents.map(agent =>
          agentDebate(req.params.id, agent, '请继续深化你的辩论观点。')
        ));
        await hostReply(req.params.id, 'DEBATE');
      } else {
        store.update(req.params.id, { state: 'CONVERGING' });
        await hostReply(req.params.id, 'CONVERGING');
      }
    } else if (room.state === 'CONVERGING') {
      if (userChoice === 'converge') {
        store.update(req.params.id, { state: 'DONE' });
        await hostReply(req.params.id, 'DONE');
      } else if (userChoice === 'debate') {
        store.update(req.params.id, { state: 'DEBATE' });
        await Promise.all(specialistAgents.map(agent =>
          agentDebate(req.params.id, agent, '请发表你的辩论观点。')
        ));
        await hostReply(req.params.id, 'DEBATE');
      } else if (userChoice === 'research') {
        store.update(req.params.id, { state: 'RESEARCH' });
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
