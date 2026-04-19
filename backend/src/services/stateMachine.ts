/**
 * F004: Manager 路由器
 *
 * 核心设计：
 * - handleUserMessage(): 用户消息 → Manager 分析 → 路由决策
 * - callWorker(): 直接调用 Worker 执行具体任务
 * - generateReport(): 用户主动触发报告生成
 * - A2A 编排: Manager/Worker 输出后扫描 @mention → 路由
 */

import { store } from '../store.js';
import { getAgent, type ProviderName } from '../config/agentConfig.js';
import { getProvider } from './providers/index.js';
import {
  emitStreamStart,
  emitStreamEnd,
  emitAgentStatus,
  emitStreamDelta,
  emitThinkingDelta,
  emitToolUse,
  emitRoomErrorEvent,
  emitUserMessage,
} from './socketEmitter.js';
import { HOST_PROMPTS } from '../prompts/host.js';
import type { Message, Agent, MessageType, AgentExecutionErrorCode, AgentRunError, ToolCall } from '../types.js';
import { v4 as uuid } from 'uuid';
import { roomsRepo, messagesRepo } from '../db/index.js';
import { sessionsRepo } from '../db/index.js';
import { auditRepo } from '../db/index.js';
import { ensureWorkspace } from './workspace.js';
import {
  scanForA2AMentions,
  updateA2AContext,
} from './routing/A2ARouter.js';
import { scenesRepo } from '../db/repositories/scenes.js';
import { buildRoomScopedSystemPrompt } from './scenePromptBuilder.js';
import { debug, info, warn, error } from '../lib/logger.js';

function telemetry(event: string, meta: Record<string, unknown>) {
  auditRepo.log(event, undefined, undefined, meta);
  debug(event, meta);
}

function addMessage(
  roomId: string,
  msg: Omit<Message, 'id' | 'timestamp'>,
): Message | undefined {
  const room = store.get(roomId);
  if (!room) return undefined;
  const message: Message = { ...msg, id: uuid(), timestamp: Date.now() };
  store.update(roomId, { messages: [...room.messages, message] });
  messagesRepo.insert(roomId, message);
  // Sync updatedAt to DB so roomsRepo.list() reflects recent activity order
  roomsRepo.update(roomId, {});
  // Emit socket event so frontend inserts user message immediately (no waiting for poll)
  emitUserMessage(roomId, message);
  return message;
}

export function addUserMessage(
  roomId: string,
  content: string,
  toAgentId?: string,
): Message | undefined {
  return addMessage(roomId, {
    agentRole: 'USER',
    agentName: '你',
    content,
    type: 'user_action',
    toAgentId,
  });
}

function addSystemMessage(roomId: string, content: string): Message | undefined {
  return addMessage(roomId, {
    agentRole: 'WORKER',
    agentName: '系统',
    content,
    type: 'system',
  });
}

function appendMessageContent(roomId: string, messageId: string, extra: string) {
  const room = store.get(roomId);
  if (!room) return;
  const updatedMessages = room.messages.map(m =>
    m.id === messageId ? { ...m, content: m.content + extra } : m,
  );
  store.update(roomId, { messages: updatedMessages });
  const msg = room.messages.find(m => m.id === messageId);
  if (msg) {
    messagesRepo.updateContent(messageId, msg.content + extra);
  }
  // Note: do NOT sync updatedAt here — each token delta would cause DB write amplification.
  // updatedAt is synced when a new message is added (addMessage), which is sufficient
  // for "recent activity" ordering since the list only reorders on new message arrival.
}

function updateAgentStatus(
  roomId: string,
  agentId: string,
  status: 'idle' | 'thinking' | 'waiting' | 'done',
) {
  const room = store.get(roomId);
  if (!room) return;
  store.update(roomId, {
    agents: room.agents.map(a => (a.id === agentId ? { ...a, status } : a)),
  });
  emitAgentStatus(roomId, agentId, status);
}

function normalizeAgentExecutionError(err: unknown): {
  code: AgentExecutionErrorCode;
  rawMessage: string;
  title: string;
  message: string;
  retryable: boolean;
} {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const taggedCode = (err as Error & { code?: string }).code;

  if (taggedCode === 'AGENT_TIMEOUT') {
    return {
      code: 'AGENT_TIMEOUT',
      rawMessage,
      title: '响应超时',
      message: '等待专家的响应超时了，可能他暂时卡住了。你可以重试，或把原问题找回后换个问法再试。',
      retryable: true,
    };
  }

  if (taggedCode === 'AGENT_PROCESS_EXIT') {
    return {
      code: 'AGENT_PROCESS_EXIT',
      rawMessage,
      title: '服务异常断开',
      message: '该专家服务刚刚开小差退出了，当前这轮回答没有完整结束。你可以稍后重试。',
      retryable: true,
    };
  }

  if (taggedCode === 'AGENT_PROVIDER_ERROR') {
    return {
      code: 'AGENT_PROVIDER_ERROR',
      rawMessage,
      title: '上游服务波动',
      message: '模型服务暂时不稳定，这一轮响应被中断了。稍等片刻再试通常就能恢复。',
      retryable: true,
    };
  }

  if (taggedCode === 'AGENT_PARSE_ERROR') {
    return {
      code: 'AGENT_PARSE_ERROR',
      rawMessage,
      title: '响应格式异常',
      message: '解析专家响应时遇到了格式混乱，这一轮没有完整结束。你可以找回原提问后换个问法再试。',
      retryable: true,
    };
  }

  return {
    code: 'AGENT_RUNTIME_ERROR',
    rawMessage,
    title: '执行时遇到问题',
    message: '专家构思时遇到了点小问题，这次回答没能顺利完成。原提问还可以找回后继续重试。',
    retryable: true,
  };
}

function handleAgentRunFailure(args: {
  err: unknown;
  roomId: string;
  agentId: string;
  agentName: string;
  providerName: string;
  msg?: Message;
  msgId: string;
  streamStarted: boolean;
  accumulated: string;
  accumulatedThinking: string;
  accumulatedToolCalls: ToolCall[];
  requestMeta?: {
    originalUserContent?: string;
    toAgentId?: string;
    toAgentName?: string;
  };
}): AgentRunError {
  const traceId = uuid();
  const normalized = normalizeAgentExecutionError(args.err);
  const runError: AgentRunError = {
    traceId,
    messageId: args.msgId || undefined,
    agentId: args.agentId,
    agentName: args.agentName,
    code: normalized.code,
    title: normalized.title,
    message: normalized.message,
    retryable: normalized.retryable,
    originalUserContent: args.requestMeta?.originalUserContent,
    toAgentId: args.requestMeta?.toAgentId,
    toAgentName: args.requestMeta?.toAgentName,
  };

  error('stream.error', {
    traceId,
    roomId: args.roomId,
    agentId: args.agentId,
    agentName: args.agentName,
    provider: args.providerName,
    code: normalized.code,
    error: normalized.rawMessage,
  });
  auditRepo.log('agent:run_failed', normalized.rawMessage, args.agentId, {
    traceId,
    roomId: args.roomId,
    agentName: args.agentName,
    provider: args.providerName,
    code: normalized.code,
    messageId: args.msgId || undefined,
  });

  if (args.msg) {
    const r = store.get(args.roomId);
    if (r) {
      store.update(args.roomId, {
        messages: r.messages.map(m =>
          m.id === args.msg!.id
            ? {
                ...m,
                content: args.accumulated,
                thinking: args.accumulatedThinking,
                toolCalls: args.accumulatedToolCalls,
                duration_ms: 0,
                total_cost_usd: 0,
                input_tokens: 0,
                output_tokens: 0,
                runError,
              }
            : m,
        ),
      });
    }
    messagesRepo.updateContent(args.msg.id, args.accumulated, {
      thinking: args.accumulatedThinking,
      toolCalls: args.accumulatedToolCalls,
      duration_ms: 0,
      total_cost_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
      runError,
    });
  }

  if (args.streamStarted && args.msgId) {
    emitStreamEnd(args.roomId, args.agentId, args.msgId, {
      duration_ms: 0,
      total_cost_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
    });
    updateAgentStatus(args.roomId, args.agentId, 'idle');
  }
  emitRoomErrorEvent(args.roomId, runError);

  return runError;
}

// ─── Manager 处理用户消息 ───────────────────────────────────────────────────

/**
 * 处理用户消息的入口
 * 1. 保存用户消息
 * 2. 调用 Manager 分析输入 → 决策
 * 3. Manager 决策执行（路由/生成报告）
 */
export async function handleUserMessage(
  roomId: string,
  userContent: string,
): Promise<void> {
  const room = store.get(roomId);
  if (!room) return;
  if (room.state === 'DONE') return;

  const managerAgent = room.agents.find(a => a.role === 'MANAGER');
  if (!managerAgent) return;

  // 1. 保存用户消息（toAgentId = MANAGER.id，表示发给主持人）
  addUserMessage(roomId, userContent, managerAgent.id);
  telemetry('msg:user', { roomId, contentLength: userContent.length });

  // 2. 调用 Manager 路由器 prompt

  const managerCfg = getAgent(managerAgent.configId);
  const managerSystemPrompt = managerCfg?.systemPrompt ?? '专业主持人，负责热情接待、召集专家协作、管理讨论节奏';

  const workers = room.agents.filter(a => a.role === 'WORKER');
  const prompt = HOST_PROMPTS.MANAGER_ROUTE(room.topic, userContent, workers);

  // 3. Manager 流式输出（包含 A2A @mention）
  // F016: recentMessages 由 streamingCallAgent 通过 buildRoomScopedSystemPrompt 自动从 room.messages 提取
  const managerOutput = await streamingCallAgent(
    {
      domainLabel: managerAgent.domainLabel,
      systemPrompt: managerSystemPrompt,
      userMessage: prompt,
    },
    roomId,
    managerAgent.id,
    managerAgent.configId,
    managerAgent.name,
    'statement',
    'MANAGER',
  );

  telemetry('manager:output', {
    roomId,
    outputLength: managerOutput.length,
  });

  // 4. 检查用户是否要求生成报告
  if (isReportRequest(userContent)) {
    await generateReport(roomId);
  }
}

// ─── F0042: 直接路由 ───────────────────────────────────────────────────────

/**
 * F012: 直接路由到指定 WORKER（路由前置已保证 toAgentId 有效）
 * 不再经过 MANAGER，不再支持无 toAgentId 的 backward compat 路径
 */
export async function routeToAgent(
  roomId: string,
  content: string,
  toAgentId: string,
): Promise<void> {
  const room = store.get(roomId);
  if (!room) return;
  if (room.state === 'DONE') return;

  const contentSnippet = content.length > 80 ? content.slice(0, 80) + '…' : content;
  const agentNames = room.agents.map(a => a.name);
  const mentions = scanForA2AMentions(content, agentNames);
  info('msg:recv', { roomId, contentLength: content.length, contentSnippet, mentions, toAgentId });

  const target = room.agents.find(a => a.id === toAgentId);
  if (!target) {
    warn('route.fallback', { roomId, toAgentId, reason: 'agent_not_found' });
    telemetry('route:agent_not_found', { roomId, toAgentId });
    return;
  }
  if (target.role !== 'WORKER') {
    // F012: MANAGER should not exist in rooms; still save user message so it's visible
    warn('route.fallback', { roomId, toAgentId, toAgentName: target.name, toAgentRole: target.role, reason: 'not_worker' });
    addUserMessage(roomId, content, target.id);
    return;
  }
  debug('route.to', { roomId, toAgentId, toAgentName: target.name, toAgentRole: 'WORKER', path: 'callWorker' });

  // 保存用户消息，标记 toAgentId
  addUserMessage(roomId, content, target.id);
  info('msg.user', { roomId, contentLength: content.length, toAgentId: target.id, toAgentName: target.name, toAgentRole: 'WORKER' });

  // 直接调用 Worker
  const workerOutput = await streamingCallAgent(
    {
      domainLabel: target.domainLabel,
      systemPrompt: `专业${target.domainLabel}，执行具体任务`,
      userMessage: `议题：${room.topic}\n\n用户（直接发送给你）：${content}`,
    },
    roomId,
    target.id,
    target.configId,
    target.name,
    'statement',
    'WORKER',
    {
      originalUserContent: content,
      toAgentId: target.id,
      toAgentName: target.name,
    },
  );

  telemetry('worker:direct:output', {
    roomId,
    workerName: target.name,
    outputLength: workerOutput.length,
  });
}

// ─── 调用 Worker ─────────────────────────────────────────────────────────────

/**
 * 直接调用 Worker 执行具体任务（通过 @mention 触发）
 */
export async function callWorker(
  roomId: string,
  workerId: string,
  task: string,
  context?: string,
): Promise<string> {
  const room = store.get(roomId);
  if (!room) throw new Error('Room not found');

  const worker = room.agents.find(a => a.id === workerId);
  if (!worker) throw new Error(`Worker not found: ${workerId}`);

  const userMsg = context
    ? `${context}\n\n任务：${task}`
    : `议题：${room.topic}\n\n${task}`;

  return streamingCallAgent(
    {
      domainLabel: worker.domainLabel,
      systemPrompt: `专业${worker.domainLabel}，执行具体任务`,
      userMessage: userMsg,
    },
    roomId,
    worker.id,
    worker.configId,
    worker.name,
    'statement',
    'WORKER',
  );
}

// ─── 生成报告 ────────────────────────────────────────────────────────────────

/**
 * 生成最终报告（用户主动触发）
 */
export async function generateReport(roomId: string): Promise<string> {
  const room = store.get(roomId);
  if (!room) throw new Error('Room not found');

  const managerAgent = room.agents.find(a => a.role === 'MANAGER');
  if (!managerAgent) throw new Error('Manager not found');

  const allContent = room.messages
    .map(m => `【${m.agentName}】${m.content}`)
    .join('\n\n');

  store.update(roomId, { state: 'DONE' });
  roomsRepo.update(roomId, { state: 'DONE' });

  telemetry('report:start', { roomId, contentLength: allContent.length });

  const report = await streamingCallAgent(
    {
      domainLabel: managerAgent.domainLabel,
      systemPrompt: '专业主持人，整理讨论结论',
      userMessage: HOST_PROMPTS.GENERATE_REPORT(room.topic, allContent),
    },
    roomId,
    managerAgent.id,
    managerAgent.configId,
    managerAgent.name,
    'report',
    'MANAGER',
  );

  store.update(roomId, { report });
  roomsRepo.update(roomId, { report });
  telemetry('report:done', { roomId, reportLength: report.length });

return report;
}

/**
 * F012: 系统级报告生成（无状态，不依赖 MANAGER）
 * 使用 room 内的第一个 WORKER 作为执行者
 */
export async function generateReportInline(
  topic: string,
  allContent: string,
  worker: Agent,
  roomId: string,
): Promise<string> {
  const prompt = `你是一个专业的讨论主持人。请根据以下讨论内容，输出一份结构化的讨论总结报告。

## 讨论主题
${topic}

## 讨论内容
${allContent}

请按以下格式输出：
1. 核心讨论要点（3-5条）
2. 各方主要观点
3. 达成的共识或结论
4. 待进一步探讨的问题

请用中文输出，语言精炼专业。`;

  telemetry('report:inline:start', { roomId, workerName: worker.name });

  const result = await streamingCallAgent(
    {
      domainLabel: '讨论主持人',
      systemPrompt: '你是一个专业的讨论主持人，擅长整理讨论结论',
      userMessage: prompt,
    },
    roomId,
    worker.id,
    worker.configId,
    worker.name,
    'report',
    'WORKER',
  );

  telemetry('report:inline:done', { roomId, reportLength: result.length });
  return result;
}

// ─── 流式调用 ───────────────────────────────────────────────────────────────

async function streamingCallAgent(
  ctx: {
    domainLabel: string;
    systemPrompt: string;
    userMessage: string;
  },
  roomId: string,
  agentId: string,
  configId: string,
  agentName: string,
  msgType: MessageType = 'summary',
  agentRole: 'MANAGER' | 'WORKER' = 'MANAGER',
  requestMeta?: {
    originalUserContent?: string;
    toAgentId?: string;
    toAgentName?: string;
  },
): Promise<string> {
  let providerName: ProviderName = 'claude-code';
  let msg: Message | undefined;
  let msgId = '';
  let streamStarted = false;
  let accumulated = '';
  let accumulatedThinking = '';
  let duration_ms = 0;
  let total_cost_usd = 0;
  let input_tokens = 0;
  let output_tokens = 0;
  let returnedSessionId = '';
  let deltaCount = 0;
  let thinkingCount = 0;
  let accumulatedToolCalls: ToolCall[] = [];

  try {
    const agentConfig = getAgent(configId);
    providerName = agentConfig?.provider ?? 'claude-code';
    const systemPrompt = agentConfig?.systemPrompt ?? ctx.systemPrompt;
    const room = store.get(roomId);
    const workspace = await ensureWorkspace(roomId, room?.workspace);

    // F016: build scene-scoped prompt
    const recentTranscript = room
      ? room.messages
          .slice(-10)
          .map(m => `【${m.agentName}】${m.content}`)
          .join('\n\n')
      : undefined;

    const basePrompt = `【当前执行者】${agentName}\n【角色】${ctx.domainLabel}（${systemPrompt}）`;
    const prompt = buildRoomScopedSystemPrompt(roomId, basePrompt, {
      userMessage: ctx.userMessage,
      recentTranscript,
      roomTopic: room?.topic,
      toAgentName: agentName,
      a2aCallChain: room?.a2aCallChain,
      workspace,
    }) ?? `${basePrompt}\n\n${ctx.userMessage}`;

    const existingSessionId = room?.sessionIds[agentName];
    returnedSessionId = existingSessionId ?? '';
    const providerOpts: Record<string, unknown> = {
      ...(agentConfig?.providerOpts ?? {}),
      sessionId: existingSessionId,
      workspace,
      roomId,
      agentName,
      firstTokenTimeoutMs: 180000,  // 3 min — generous for cold-start / long thinking
      idleTokenTimeoutMs: 180000,
    };

    msg = addMessage(roomId, {
      agentRole,
      agentName,
      content: '',
      type: msgType,
    });
    msgId = msg?.id ?? '';

    // 用户旅程：AI 开始生成
    info('ai:start', {
      roomId,
      agentName,
      agentRole,
      provider: providerName,
      cliPath: (agentConfig?.providerOpts as any)?.cliPath ?? '',
      promptLength: prompt.length,
      sessionId: existingSessionId ?? 'new',
      workspace,
    });
    debug('stream.start', { roomId, agentId, agentName, msgId, agentRole });
    emitStreamStart(roomId, agentId, agentName, Date.now(), msgId, agentRole);
    streamStarted = true;
    updateAgentStatus(roomId, agentId, 'thinking');

    const provider = getProvider(providerName);
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
      } else if (event.type === 'tool_use') {
        const toolCall: ToolCall = {
          toolName: event.toolName,
          toolInput: event.toolInput,
          callId: event.callId,
          timestamp: Date.now(),
        };
        accumulatedToolCalls = [...accumulatedToolCalls, toolCall];
        const r = store.get(roomId);
        if (r && msg) {
          store.update(roomId, {
            messages: r.messages.map(m =>
              m.id === msg!.id
                ? { ...m, toolCalls: accumulatedToolCalls }
                : m,
            ),
          });
        }
        emitToolUse(roomId, agentId, event.toolName, event.toolInput, event.callId, toolCall.timestamp);
      } else if (event.type === 'end') {
        duration_ms = event.duration_ms;
        total_cost_usd = event.total_cost_usd;
        input_tokens = event.input_tokens;
        output_tokens = event.output_tokens;
        if (event.sessionId) returnedSessionId = event.sessionId;
      } else if (event.type === 'error') {
        const providerError = new Error(event.message);
        (providerError as Error & { code?: string }).code = 'AGENT_PROVIDER_ERROR';
        throw providerError;
      }
    }
  } catch (err) {
    handleAgentRunFailure({
      err,
      roomId,
      agentId,
      agentName,
      providerName,
      msg,
      msgId,
      streamStarted,
      accumulated,
      accumulatedThinking,
      accumulatedToolCalls,
      requestMeta,
    });
    throw err;
  }

  if (returnedSessionId) {
    const r = store.get(roomId);
    if (r) {
      store.update(roomId, {
        sessionIds: { ...r.sessionIds, [agentName]: returnedSessionId },
      });
      sessionsRepo.upsert(agentName, roomId, returnedSessionId);
    }
  }

  if (msg) {
    const r = store.get(roomId);
    if (r) {
      store.update(roomId, {
        messages: r.messages.map(m =>
          m.id === msg.id
            ? {
                ...m,
                content: accumulated,
                thinking: accumulatedThinking,
                toolCalls: accumulatedToolCalls,
                duration_ms,
                total_cost_usd,
                input_tokens,
                output_tokens,
              }
            : m,
        ),
      });
      messagesRepo.updateContent(msg.id, accumulated, {
        thinking: accumulatedThinking,
        toolCalls: accumulatedToolCalls,
        duration_ms,
        total_cost_usd,
        input_tokens,
        output_tokens,
      });
    }
  }

  // 用户旅程：AI 生成结束
  info('ai:end', {
    roomId,
    agentName,
    agentRole,
    outputSnippet: accumulated.length > 80 ? accumulated.slice(0, 80) + '…' : accumulated,
    outputLength: accumulated.length,
    duration_ms,
    total_cost_usd,
    input_tokens,
    output_tokens,
  });
  debug('stream.end', { roomId, agentId, agentName, msgId, duration_ms, deltaCount, thinkingCount, outputLen: accumulated.length });
  emitStreamEnd(roomId, agentId, msgId, {
    duration_ms,
    total_cost_usd,
    input_tokens,
    output_tokens,
  });
  updateAgentStatus(roomId, agentId, 'idle');

  // A2A 编排：扫描 @mention 并路由到对应 Worker
  await a2aOrchestrate(roomId, agentId, agentName, accumulated);

  return accumulated;
}

// ─── A2A 编排 ───────────────────────────────────────────────────────────────

export async function a2aOrchestrate(
  roomId: string,
  fromAgentId: string,
  fromAgentName: string,
  outputText: string,
): Promise<void> {
  const room = store.get(roomId);
  if (!room) return;

  let mentions = scanForA2AMentions(outputText, room.agents.map(a => a.name));
  debug('a2a:scan', { roomId, fromAgentName, mentions });
  if (mentions.length === 0) return;

  // Output guard: only applies to Manager (host) agents in Clarify mode.
  // Workers can legitimately @mention multiple peers in parallel discussion.
  const isManager = room.agents.some(a => a.id === fromAgentId && a.role === 'MANAGER');
  const hasQuestion = /[？?]/.test(outputText);
  if (isManager && hasQuestion && mentions.length > 1) {
    debug('a2a:guard', { roomId, fromAgentName, mentionsCount: mentions.length + 1, keptMention: mentions[0] });
    mentions = [mentions[0]];
  }

  const currentDepth = room.a2aDepth ?? 0;
  const currentChain = room.a2aCallChain ?? [];

  // 有效深度：room 覆盖 > scene 默认 > 5
  const effectiveMaxDepth = room.maxA2ADepth !== null
    ? room.maxA2ADepth
    : (scenesRepo.get(room.sceneId)?.maxA2ADepth ?? 5);

  telemetry('a2a:detected', { roomId, fromAgentName, mentions, depth: currentDepth });

// 达深度上限 → 抛出 System 卡片，不再交给 Manager 收口
  if (effectiveMaxDepth > 0 && currentDepth >= effectiveMaxDepth) {
    telemetry('a2a:depth_limit', { roomId, depth: currentDepth, chain: currentChain });
    addSystemMessage(roomId, '[系统提醒] 业务内部探讨达到上限，请您介入引导方向');
    return;
  }

  const newChain = [...currentChain, fromAgentName];
  updateA2AContext(roomId, currentDepth + 1, newChain);

  for (const mention of mentions) {
    const targetAgent = room.agents.find(
      a =>
        a.name.toLowerCase() === mention.toLowerCase() ||
        a.configId.toLowerCase() === mention.toLowerCase(),
    );

    if (!targetAgent) {
      telemetry('a2a:agent_not_found', { roomId, mention });
      continue;
    }

    // 跳过已在调用链中的 Agent（防止循环）
    // 规则：只拦截"真正的循环"
    // - A→B：允许
    // - A→B→A（2人来回）：允许 — 直接对答不算循环
    // - A→B→C→A（3人+循环）：拦截
    if (newChain.length > 2 && newChain.includes(targetAgent.name)) {
      telemetry('a2a:skip_cycle', { roomId, target: targetAgent.name, chain: newChain });
      continue;
    }

    telemetry('a2a:route', {
      roomId,
      from: fromAgentName,
      to: targetAgent.name,
      depth: currentDepth + 1,
    });

    // Filter out self-mentions from output text so agent doesn't @mention itself
    const filteredOutput = outputText
      .replace(new RegExp(`@${targetAgent.name}(?![\\w])`, 'g'), targetAgent.name)
      .replace(new RegExp(`@${targetAgent.domainLabel}(?![\\w])`, 'g'), targetAgent.domainLabel);

    const a2aPrompt = `【A2A 协作请求】

来自：${fromAgentName}
调用链：${newChain.join(' → ')}
议题：${room.topic}

${fromAgentName} 的输出：
${filteredOutput}

你是 ${targetAgent.domainLabel}。请基于以上上下文继续深入讨论或补充观点。
如果需要其他专家参与，请使用行首 @mention 格式（不要 @ 自己）。`;

    await streamingCallAgent(
      {
        domainLabel: targetAgent.domainLabel,
        systemPrompt: `专业${targetAgent.domainLabel}，执行具体任务`,
        userMessage: a2aPrompt,
      },
      roomId,
      targetAgent.id,
      targetAgent.configId,
      targetAgent.name,
      'statement',
      'WORKER',
    );
  }
}

// ─── 辅助函数 ───────────────────────────────────────────────────────────────

/** 判断用户输入是否请求生成报告 */
function isReportRequest(text: string): boolean {
  const keywords = ['生成报告', '输出报告', '整理报告', '导出报告', '总结报告', 'report'];
  return keywords.some(k => text.toLowerCase().includes(k));
}

// ─── Room Busy Helper ────────────────────────────────────────────────────────

/**
 * F015: Returns true if any agent in the room is currently executing.
 * Used by the backend 409 guard to prevent concurrent message dispatch.
 */
export function isRoomBusy(roomId: string): boolean {
  const room = store.get(roomId);
  if (!room) return false;
  return room.agents.some(a => a.status === 'thinking' || a.status === 'waiting');
}
