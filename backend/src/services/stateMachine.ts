import { store } from '../store.js';
import { getAgent } from '../config/agentConfig.js';
import { getProvider } from './providers/index.js';
import type { ClaudeEvent } from './providers/index.js';
import { emitStreamStart, emitStreamEnd, emitAgentStatus, emitStreamDelta, emitThinkingDelta } from './socketEmitter.js';
import { HOST_PROMPTS } from '../prompts/host.js';
import { Message, DiscussionState, AgentRole, Agent, MessageType } from '../types.js';
import { v4 as uuid } from 'uuid';
import { roomsRepo, messagesRepo } from '../db/index.js';
import { sessionsRepo } from '../db/index.js';
import { auditRepo } from '../db/index.js';
import { getWorkspacePath, ensureWorkspace } from './workspace.js';
import { scanForA2AMentions, MAX_A2A_DEPTH, buildManagerFallbackPrompt, updateA2AContext, resetA2ADepth } from './routing/A2ARouter.js';

function telemetry(event: string, meta: Record<string, unknown>) {
  auditRepo.log(event, undefined, undefined, meta);
  console.log(`[DEBUG] ${event}`, JSON.stringify(meta));
}

function addMessage(roomId: string, msg: Omit<Message, 'id' | 'timestamp'>): Message | undefined {
  const room = store.get(roomId);
  if (!room) return undefined;
  const message: Message = { ...msg, id: uuid(), timestamp: Date.now() };
  store.update(roomId, { messages: [...room.messages, message] });
  messagesRepo.insert(roomId, message);
  return message;
}

/** Add a USER-originated message (e.g. button clicks) */
export function addUserMessage(roomId: string, content: string): Message | undefined {
  return addMessage(roomId, { agentRole: 'USER', agentName: '你', content, type: 'user_action' });
}

function appendMessageContent(roomId: string, messageId: string, extra: string) {
  const room = store.get(roomId);
  if (!room) return;
  const updatedMessages = room.messages.map(m =>
    m.id === messageId ? { ...m, content: m.content + extra } : m
  );
  store.update(roomId, { messages: updatedMessages });
  // Persist incremental content
  const msg = room.messages.find(m => m.id === messageId);
  if (msg) {
    messagesRepo.updateContent(messageId, msg.content + extra);
  }
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

  telemetry('state:enter', { roomId, state, agent: 'MANAGER' });

  let prompt = '';
  switch (state) {
    case 'INIT':
      prompt = HOST_PROMPTS.INIT(room.topic);
      break;
    case 'RESEARCH': {
      const specialistAgents = room.agents.filter(a => a.role === 'WORKER');
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
      const specialistAgents = room.agents.filter(a => a.role === 'WORKER');
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
      const debateSummaries = room.messages.filter(m => m.type === 'summary' && m.agentRole === 'MANAGER');
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
      }, roomId, room.agents.find(a => a.role === 'MANAGER')!.id, 'host', '主持人', 'report');
      store.update(roomId, { report: reply });
      roomsRepo.update(roomId, { report: reply });
      telemetry('state:done', { roomId, state: 'DONE', agent: 'MANAGER', reportLength: reply.length });
      return reply;
  }

  updateAgentStatus(roomId, room.agents.find(a => a.role === 'MANAGER')!.id, 'thinking');
  const reply = await streamingCallAgent({ domainLabel: '主持人', systemPrompt: '专业主持人，引导讨论，收敛结论', userMessage: prompt }, roomId, room.agents.find(a => a.role === 'MANAGER')!.id, 'host', '主持人');
  updateAgentStatus(roomId, room.agents.find(a => a.role === 'MANAGER')!.id, 'idle');
  telemetry('state:exit', { roomId, state, agent: 'MANAGER', replyLength: reply.length, messageCount: room.messages.length });
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
  }, roomId, agent.id, agent.configId, agent.name, 'statement', 'WORKER');

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
  }, roomId, agent.id, agent.configId, agent.name, 'statement', 'WORKER');

  updateAgentStatus(roomId, agent.id, 'idle');
  telemetry('state:exit', { roomId, state: 'DEBATE', agent: agent.name, agentId: agent.id, statementLength: statement.length });
  return statement;
}

/** Wraps the provider stream, emits Socket.IO events and updates the message in store */
async function streamingCallAgent(
  ctx: { domainLabel: string; systemPrompt: string; userMessage: string },
  roomId: string,
  agentId: string,
  configId: string,
  agentName: string,
  msgType: MessageType = 'summary',
  agentRole: AgentRole = 'MANAGER',
): Promise<string> {
  // id-based lookup: avoids name collision if multiple agents share the same name
  const agentConfig = getAgent(configId);
  const providerName = agentConfig?.provider ?? 'claude-code';
  const systemPrompt = agentConfig?.systemPrompt ?? ctx.systemPrompt;
  const prompt = `【角色】${ctx.domainLabel}（${systemPrompt}）

${ctx.userMessage}`;

  const room = store.get(roomId);
  const existingSessionId = room?.sessionIds[agentName];
  const workspace = await ensureWorkspace(roomId);  // 确保 workspace 目录存在
  const providerOpts: Record<string, unknown> = {
    ...(agentConfig?.providerOpts ?? {}),
    sessionId: existingSessionId,
    workspace,  // A2A 协作：所有 Agent 共享 workspace
  };

  const tempMsgId = uuid();
  const msg = addMessage(roomId, { agentRole, agentName, content: '', type: msgType });
  const msgId = msg?.id ?? '';
  if (msg) {
    const r = store.get(roomId);
    if (r) {
      store.update(roomId, {
        messages: r.messages.map(m => m.id === msg.id ? { ...m, tempMsgId } : m),
      });
    }
  }
  console.log(`[DEBUG] stream_start agent=${agentName}(${agentId}) msgId=${msgId} tempMsgId=${tempMsgId} room=${roomId}`);
  emitStreamStart(roomId, agentId, agentName, Date.now(), tempMsgId);

  let accumulated = '';
  let accumulatedThinking = '';
  let duration_ms = 0;
  let total_cost_usd = 0;
  let input_tokens = 0;
  let output_tokens = 0;
  let returnedSessionId = existingSessionId ?? '';
  let deltaCount = 0;
  let thinkingCount = 0;

  const provider = getProvider(providerName);
  try {
    for await (const event of provider(prompt, agentId, providerOpts)) {
      if (event.type === 'delta') {
        deltaCount++;
        accumulated += event.text;
        appendMessageContent(roomId, msgId, event.text);
        emitStreamDelta(roomId, agentId, event.text);
      } else if (event.type === 'thinking_delta') {
        thinkingCount++;
        accumulatedThinking += event.thinking;
        emitThinkingDelta(roomId, agentId, event.thinking);
      } else if (event.type === 'end') {
        duration_ms = event.duration_ms;
        total_cost_usd = event.total_cost_usd;
        input_tokens = event.input_tokens;
        output_tokens = event.output_tokens;
        if (event.sessionId) {
          returnedSessionId = event.sessionId;
        }
      } else if (event.type === 'error') {
        throw new Error(event.message);
      }
    }
  } catch (err) {
    const ts = new Date().toISOString();
    console.error(`[${ts}] [ERROR] streamingCallAgent provider=${providerName} agentId=${agentId}`, err);
    throw err;
  }

  if (returnedSessionId) {
    const r = store.get(roomId);
    if (r) {
      store.update(roomId, { sessionIds: { ...r.sessionIds, [agentName]: returnedSessionId } });
      sessionsRepo.upsert(agentName, roomId, returnedSessionId);
    }
  }

  if (msg) {
    const r = store.get(roomId);
    if (r) {
      store.update(roomId, {
        messages: r.messages.map(m => m.id === msg.id ? {
          ...m,
          content: accumulated,
          thinking: accumulatedThinking,
          duration_ms,
          total_cost_usd,
          input_tokens,
          output_tokens,
        } : m),
      });
      messagesRepo.updateContent(msg.id, accumulated, {
        thinking: accumulatedThinking,
        duration_ms,
        total_cost_usd,
        input_tokens,
        output_tokens,
      });
    }
  }

  console.log(`[DEBUG] stream_end agent=${agentName}(${agentId}) msgId=${msgId} tempMsgId=${tempMsgId} duration=${duration_ms}ms deltas=${deltaCount} thoughts=${thinkingCount} outputLen=${accumulated.length}`);
  emitStreamEnd(roomId, agentId, tempMsgId, { duration_ms, total_cost_usd, input_tokens, output_tokens });

  // A2A 编排：在 Agent 输出后检测 @mention 并路由
  await a2aOrchestrate(roomId, agentId, agentName, accumulated);

  return accumulated;
}

/**
 * A2A 编排器 — 检测 @mention 并路由到目标 Agent
 *
 * 在每个 Agent 输出后调用，检查是否有 @mention，
 * 如果有则继续调用对应的 Agent，直到达到深度上限。
 */
export async function a2aOrchestrate(
  roomId: string,
  fromAgentId: string,
  fromAgentName: string,
  outputText: string
): Promise<void> {
  const room = store.get(roomId);
  if (!room) return;

  const currentDepth = room.a2aDepth ?? 0;
  const currentChain = room.a2aCallChain ?? [];

  // 解析 @mentions
  const mentions = scanForA2AMentions(outputText);
  console.log(`[DEBUG] a2a_scan from=${fromAgentName} mentions=${JSON.stringify(mentions)} depth=${currentDepth} room=${roomId}`);
  if (mentions.length === 0) return;

  telemetry('a2a:detected', { roomId, fromAgentName, mentions, depth: currentDepth });

  // 更新调用链
  const newChain = [...currentChain, fromAgentName];

  // 检查深度上限
  if (currentDepth >= MAX_A2A_DEPTH) {
    // 达到上限，触发 Manager 兜底
    telemetry('a2a:depth_limit', { roomId, depth: currentDepth, chain: newChain });

    // 构建兜底 prompt，让 Manager 决策
    const fallbackPrompt = buildManagerFallbackPrompt(
      newChain,
      `用户请求：${room.topic}\n\n最后输出：${outputText.slice(0, 200)}...`
    );

    // 调用 Manager（HOST）处理兜底
    updateA2AContext(roomId, currentDepth, newChain);
    await streamingCallAgent({
      domainLabel: '主持人',
      systemPrompt: '专业主持人，决策是否继续 A2A 协作或接管',
      userMessage: fallbackPrompt,
    }, roomId, room.agents.find(a => a.role === 'MANAGER')!.id, 'host', '主持人', 'system', 'MANAGER');

    return;
  }

  // 继续 A2A 路由
  updateA2AContext(roomId, currentDepth + 1, newChain);

  // 找到被 @mention 的 Agent
  for (const mention of mentions) {
    const targetAgent = room.agents.find(a =>
      a.name.toLowerCase() === mention.toLowerCase() ||
      a.configId.toLowerCase() === mention.toLowerCase()
    );

    if (!targetAgent) {
      telemetry('a2a:agent_not_found', { roomId, mention });
      continue;
    }

    // 跳过已经在调用链中的 Agent（防止循环）
    if (newChain.includes(targetAgent.name)) {
      telemetry('a2a:skip_cycle', { roomId, target: targetAgent.name, chain: newChain });
      continue;
    }

    telemetry('a2a:route', { roomId, from: fromAgentName, to: targetAgent.name, depth: currentDepth + 1 });

    // 构建 A2A 调用 prompt
    const a2aPrompt = `【A2A 协作请求】

来自：${fromAgentName}
调用链：${newChain.join(' → ')}
任务：${room.topic}

${fromAgentName} 的输出：
${outputText}

请基于以上上下文，以你的专业角色（${targetAgent.domainLabel}）继续工作。
你可以通过 @mention 继续召集其他 Agent。

**注意**：如果需要调用其他 Agent，请使用行首 @mention 格式。`;

    // 调用目标 Agent
    await streamingCallAgent({
      domainLabel: targetAgent.domainLabel,
      systemPrompt: `专业${targetAgent.domainLabel}，执行具体任务`,
      userMessage: a2aPrompt,
    }, roomId, targetAgent.id, targetAgent.configId, targetAgent.name, 'statement', 'WORKER');
  }
}

/**
 * 重置 A2A 深度计数（当 Manager 决定继续 A2A 协作时）
 */
export function a2aReset(roomId: string): void {
  resetA2ADepth(roomId);
  telemetry('a2a:reset', { roomId });
}
