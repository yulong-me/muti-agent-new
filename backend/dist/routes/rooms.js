import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { store } from '../store.js';
import { hostReply, agentInvestigate } from '../services/stateMachine.js';
export const roomsRouter = Router();
// GET /api/rooms — 列出所有讨论室
roomsRouter.get('/', (_req, res) => {
    res.json(store.list());
});
// POST /api/rooms — 创建讨论室
roomsRouter.post('/', (req, res) => {
    const { topic, agentADomain, agentBDomain } = req.body;
    if (!topic || !agentADomain || !agentBDomain) {
        return res.status(400).json({ error: 'topic, agentADomain, agentBDomain required' });
    }
    const room = {
        id: uuid(),
        topic,
        state: 'INIT',
        agents: [
            { id: uuid(), role: 'HOST', name: '主持人', domainLabel: '主持人', status: 'idle' },
            { id: uuid(), role: 'SPECIALIST_A', name: 'Agent A', domainLabel: agentADomain, status: 'idle' },
            { id: uuid(), role: 'SPECIALIST_B', name: 'Agent B', domainLabel: agentBDomain, status: 'idle' },
        ],
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    res.json(store.create(room));
});
// GET /api/rooms/:id — 获取讨论室
roomsRouter.get('/:id', (req, res) => {
    const room = store.get(req.params.id);
    if (!room)
        return res.status(404).json({ error: 'Room not found' });
    res.json(room);
});
// GET /api/rooms/:id/messages — 获取消息（轮询）
roomsRouter.get('/:id/messages', (req, res) => {
    const room = store.get(req.params.id);
    if (!room)
        return res.status(404).json({ error: 'Room not found' });
    res.json({ state: room.state, messages: room.messages, agents: room.agents, report: room.report });
});
// POST /api/rooms/:id/start — 开始 INIT 阶段
roomsRouter.post('/:id/start', async (req, res) => {
    const room = store.get(req.params.id);
    if (!room)
        return res.status(404).json({ error: 'Room not found' });
    if (room.state !== 'INIT')
        return res.status(400).json({ error: 'Room already started' });
    try {
        await hostReply(req.params.id, 'INIT');
        res.json({ status: 'ok', state: room.state });
    }
    catch (e) {
        res.status(500).json({ error: String(e) });
    }
});
// POST /api/rooms/:id/advance — 用户确认，进入下一步
roomsRouter.post('/:id/advance', async (req, res) => {
    const room = store.get(req.params.id);
    if (!room)
        return res.status(404).json({ error: 'Room not found' });
    const { userChoice } = req.body;
    try {
        if (room.state === 'INIT') {
            store.update(req.params.id, { state: 'RESEARCH' });
            // 并行调度 A、B 调查
            await Promise.all([
                agentInvestigate(req.params.id, 'SPECIALIST_A'),
                agentInvestigate(req.params.id, 'SPECIALIST_B'),
            ]);
            await hostReply(req.params.id, 'RESEARCH');
        }
        else if (room.state === 'RESEARCH') {
            store.update(req.params.id, { state: 'DEBATE' });
            await hostReply(req.params.id, 'DEBATE');
        }
        else if (room.state === 'DEBATE') {
            if (userChoice === 'continue') {
                await hostReply(req.params.id, 'DEBATE');
            }
            else {
                store.update(req.params.id, { state: 'CONVERGING' });
                await hostReply(req.params.id, 'CONVERGING');
            }
        }
        else if (room.state === 'CONVERGING') {
            if (userChoice === 'converge') {
                store.update(req.params.id, { state: 'DONE' });
                await hostReply(req.params.id, 'DONE');
            }
            else if (userChoice === 'debate') {
                store.update(req.params.id, { state: 'DEBATE' });
                await hostReply(req.params.id, 'DEBATE');
            }
            else if (userChoice === 'research') {
                store.update(req.params.id, { state: 'RESEARCH' });
                await Promise.all([
                    agentInvestigate(req.params.id, 'SPECIALIST_A'),
                    agentInvestigate(req.params.id, 'SPECIALIST_B'),
                ]);
                await hostReply(req.params.id, 'RESEARCH');
            }
        }
        const updated = store.get(req.params.id);
        res.json({ status: 'ok', state: updated?.state });
    }
    catch (e) {
        res.status(500).json({ error: String(e) });
    }
});
