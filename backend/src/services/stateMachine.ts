import { store } from '../store.js';
import { callAgentWithStreaming } from './agentCaller.js';
import { emitStreamStart, emitStreamEnd, emitAgentStatus, emitStreamDelta, emitThinkingDelta } from './socketEmitter.js';
import { HOST_PROMPTS } from '../prompts/host.js';
import { Message, DiscussionState, AgentRole, Agent, MessageType } from '../types.js';
import { v4 as uuid } from 'uuid';

function telemetry(event: string, meta: Record<string, unknown>) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [TELEMETRY] ${event} ${JSON.stringify(meta)}`);
}

function addMessage(roomId: string, msg: Omit<Message, 'id' | 'timestamp'>): Message | undefined {
  const room = store.get(roomId);
  if (!room) return undefined;
  const message: Message = { ...msg, id: uuid(), timestamp: Date.now() };
  store.update(roomId, { messages: [...room.messages, message] });
  return message;
}

/** Add a USER-originated message (e.g. button clicks) */
export function addUserMessage(roomId: string, content: string): Message | undefined {
  return addMessage(roomId, { agentRole: 'USER', agentName: '你', content, type: 'user_action' });
}

function appendMessageContent(roomId: string, messageId: string, extra: string) {
  const room = store.get(roomId);
  if (!room) return;
  store.update(roomId, {
    messages: room.messages.map(m =>
      m.id === messageId ? { ...m, content: m.content + extra } : m
    ),
  });
}

function updateAgentStatus(roomId: string, agentId: string, status: 'idle' | 'thinking' | 'waiting' | 'done') {
  const room = store.get(roomId);
  if (!room) return;
  store.update(roomId, {
    agents: room.agents.map(a => a.id === agentId ? { ...a, status } : a),
  });
  emitAgentStatus(roomId, agentId, status);
}

export async function hostReply(roomId: string, state: DiscussionState, context?: string): Promise<string> {
  const room = store.get(roomId);
  if (!room) throw new Error('Room not found');

  telemetry('state:enter', { roomId, state, agent: 'HOST' });

  let prompt = '';
  switch (state) {
    case 'INIT':
      prompt = HOST_PROMPTS.INIT(room.topic);
      break;
    case 'RESEARCH': {
      const specialistAgents = room.agents.filter(a => a.role === 'AGENT');
      const statements = specialistAgents
        .map(agent => {
          const stmt = room.messages.find(m => m.agentName === agent.name && m.type === 'statement');
          return stmt ? `${agent.name}：${stmt.content}` : '';
        })
        .filter(Boolean)
        .join('\n\n');
      prompt = HOST_PROMPTS.RESEARCH(room.topic, statements);
      break;
    }
    case 'DEBATE': {
      const specialistAgents = room.agents.filter(a => a.role === 'AGENT');
      const agentNames = specialistAgents.map(a => a.name).join('、');
      const statements = specialistAgents
        .map(agent => {
          const stmt = room.messages.find(m => m.agentName === agent.name && m.type === 'statement');
          return stmt ? `${agent.name}：${stmt.content}` : '';
        })
        .filter(Boolean)
        .join('\n\n');
      prompt = HOST_PROMPTS.DEBATE(agentNames, statements);
      break;
    }
    case 'CONVERGING': {
      const debateSummaries = room.messages.filter(m => m.type === 'summary' && m.agentRole === 'HOST');
      const latestSummary = debateSummaries[debateSummaries.length - 1]?.content || '';
      prompt = HOST_PROMPTS.CONVERGING(room.topic, latestSummary);
      break;
    }
    case 'DONE':
      const allContent = room.messages.map(m => `【${m.agentName}】${m.content}`).join('\n\n');
      prompt = HOST_PROMPTS.DONE(room.topic, allContent);
      const reply = await streamingCallAgent({
        domainLabel: '主持人',
        systemPrompt: '专业主持人，引导讨论，收敛结论',
        userMessage: prompt,
      }, roomId, room.agents.find(a => a.role === 'HOST')!.id, '主持人', 'report');
      store.update(roomId, { report: reply });
      telemetry('state:done', { roomId, state: 'DONE', agent: 'HOST', reportLength: reply.length });
      return reply;
  }

  updateAgentStatus(roomId, room.agents.find(a => a.role === 'HOST')!.id, 'thinking');
  const reply = await streamingCallAgent({ domainLabel: '主持人', systemPrompt: '专业主持人，引导讨论，收敛结论', userMessage: prompt }, roomId, room.agents.find(a => a.role === 'HOST')!.id, '主持人');
  updateAgentStatus(roomId, room.agents.find(a => a.role === 'HOST')!.id, 'idle');
  telemetry('state:exit', { roomId, state, agent: 'HOST', replyLength: reply.length, messageCount: room.messages.length });
  return reply;
}

export async function agentInvestigate(roomId: string, agent: Agent): Promise<string> {
  const room = store.get(roomId);
  if (!room) throw new Error('Room not found');

  telemetry('state:enter', { roomId, state: 'RESEARCH', agent: agent.name, agentId: agent.id });
  updateAgentStatus(roomId, agent.id, 'thinking');

  const userMsg = `议题：${room.topic}\n\n请针对上述议题，从你的专业领域（${agent.domainLabel}）进行调查和分析，给出你的调查结论。\n\n**要求：控制在80~150字，简洁有力，不要发散。**`;
  const findings = await streamingCallAgent({
    domainLabel: agent.domainLabel,
    systemPrompt: `专业${agent.domainLabel}，擅长调查和分析`,
    userMessage: userMsg,
  }, roomId, agent.id, agent.name, 'statement', 'AGENT');

  updateAgentStatus(roomId, agent.id, 'done');
  telemetry('state:exit', { roomId, state: 'RESEARCH', agent: agent.name, agentId: agent.id, findingsLength: findings.length });
  return findings;
}

/** Let each specialist agent give their debate perspective on the topic */
export async function agentDebate(roomId: string, agent: Agent, debateContext: string): Promise<string> {
  const room = store.get(roomId);
  if (!room) throw new Error('Room not found');

  telemetry('state:enter', { roomId, state: 'DEBATE', agent: agent.name, agentId: agent.id });
  updateAgentStatus(roomId, agent.id, 'thinking');

  const userMsg = `议题：${room.topic}\n\n辩论背景：\n${debateContext}\n\n请从你的专业视角，对以上辩论背景发表你的核心观点和论据。\n\n**要求：控制在80~150字，简洁有力，不要发散。格式：\\n【${agent.name}观点】\\n[你的立场和论据...]**`;
  const statement = await streamingCallAgent({
    domainLabel: agent.domainLabel,
    systemPrompt: `专业${agent.domainLabel}，擅长批判性分析和辩论`,
    userMessage: userMsg,
  }, roomId, agent.id, agent.name, 'statement', 'AGENT');

  updateAgentStatus(roomId, agent.id, 'idle');
  telemetry('state:exit', { roomId, state: 'DEBATE', agent: agent.name, agentId: agent.id, statementLength: statement.length });
  return statement;
}

/** Wraps callAgentWithStreaming, emits Socket.IO events and updates the message in store */
async function streamingCallAgent(
  ctx: Parameters<typeof callAgentWithStreaming>[0],
  roomId: string,
  agentId: string,
  agentName: string,
  msgType: MessageType = 'summary',
  agentRole: AgentRole = 'HOST',
): Promise<string> {
  const tempMsgId = uuid();
  // Create placeholder message in store
  const msg = addMessage(roomId, { agentRole, agentName, content: '', type: msgType });
  if (msg) {
    // Update with tempMsgId so frontend can match
    const room = store.get(roomId);
    if (room) {
      store.update(roomId, {
        messages: room.messages.map(m => m.id === msg.id ? { ...m, tempMsgId } : m),
      });
    }
  }
  emitStreamStart(roomId, agentId, agentName, Date.now(), tempMsgId);

  let accumulated = '';
  let accumulatedThinking = '';

  const result = await callAgentWithStreaming(ctx, agentId, (text) => {
    accumulated += text;
    emitStreamDelta(roomId, agentId, text);
  }, (thinking) => {
    accumulatedThinking += thinking;
    emitThinkingDelta(roomId, agentId, thinking);
  });

  // Update message content and stats in store
  if (msg) {
    const room = store.get(roomId);
    if (room) {
      store.update(roomId, {
        messages: room.messages.map(m => m.id === msg.id ? {
          ...m,
          content: accumulated,
          thinking: accumulatedThinking,
          duration_ms: result.duration_ms,
          total_cost_usd: result.total_cost_usd,
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
        } : m),
      });
    }
  }

  emitStreamEnd(roomId, agentId, tempMsgId, {
    duration_ms: result.duration_ms,
    total_cost_usd: result.total_cost_usd,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
  });

  return result.text;
}
