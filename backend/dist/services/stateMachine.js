import { store } from '../store.js';
import { callAgent } from './agentCaller.js';
import { HOST_PROMPTS } from '../prompts/host.js';
import { v4 as uuid } from 'uuid';
function addMessage(roomId, msg) {
    const room = store.get(roomId);
    if (!room)
        return undefined;
    const message = { ...msg, id: uuid(), timestamp: Date.now() };
    store.update(roomId, { messages: [...room.messages, message] });
    return message;
}
function updateAgentStatus(roomId, role, status) {
    const room = store.get(roomId);
    if (!room)
        return;
    store.update(roomId, {
        agents: room.agents.map(a => a.role === role ? { ...a, status } : a)
    });
}
export async function hostReply(roomId, state, context) {
    const room = store.get(roomId);
    if (!room)
        throw new Error('Room not found');
    const hostAgent = room.agents.find(a => a.role === 'HOST');
    let prompt = '';
    switch (state) {
        case 'INIT':
            prompt = HOST_PROMPTS.INIT(room.topic);
            break;
        case 'RESEARCH':
            const researchMsgs = room.messages.filter(m => m.type === 'summary');
            const findA = researchMsgs.find(m => m.agentRole === 'SPECIALIST_A')?.content || '';
            const findB = researchMsgs.find(m => m.agentRole === 'SPECIALIST_B')?.content || '';
            prompt = HOST_PROMPTS.RESEARCH(room.topic, findA, findB);
            break;
        case 'DEBATE':
            prompt = HOST_PROMPTS.DEBATE();
            break;
        case 'CONVERGING':
            const debateSummaries = room.messages.filter(m => m.type === 'summary' && m.agentRole === 'HOST');
            const latestSummary = debateSummaries[debateSummaries.length - 1]?.content || '';
            prompt = HOST_PROMPTS.CONVERGING(room.topic, latestSummary);
            break;
        case 'DONE':
            const allContent = room.messages.map(m => `【${m.agentName}】${m.content}`).join('\n\n');
            prompt = HOST_PROMPTS.DONE(room.topic, allContent);
            addMessage(roomId, { agentRole: 'HOST', agentName: '主持人', content: '', type: 'report' });
            const reply = await callAgent({ domainLabel: '主持人', systemPrompt: '专业主持人，引导讨论，收敛结论', userMessage: prompt });
            addMessage(roomId, { agentRole: 'HOST', agentName: '主持人', content: reply, type: 'report' });
            store.update(roomId, { report: reply });
            return reply;
    }
    updateAgentStatus(roomId, 'HOST', 'thinking');
    const reply = await callAgent({ domainLabel: '主持人', systemPrompt: '专业主持人，引导讨论，收敛结论', userMessage: prompt });
    addMessage(roomId, { agentRole: 'HOST', agentName: '主持人', content: reply, type: 'summary' });
    updateAgentStatus(roomId, 'HOST', 'idle');
    return reply;
}
export async function agentInvestigate(roomId, role) {
    const room = store.get(roomId);
    if (!room)
        throw new Error('Room not found');
    const agent = room.agents.find(a => a.role === role);
    updateAgentStatus(roomId, role, 'thinking');
    const findings = await callAgent({
        domainLabel: agent.domainLabel,
        systemPrompt: `专业${agent.domainLabel}，擅长调查和分析`,
        userMessage: `议题：${room.topic}\n\n请针对上述议题，从你的专业领域（${agent.domainLabel}）进行调查和分析，给出你的调查结论。`
    });
    addMessage(roomId, { agentRole: role, agentName: `${agent.domainLabel}（${role === 'SPECIALIST_A' ? 'A' : 'B'}）`, content: findings, type: 'statement' });
    updateAgentStatus(roomId, role, 'done');
    return findings;
}
