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
import { getAgent } from '../config/agentConfig.js';
import { getProvider } from './providers/index.js';
import type { ClaudeEvent } from './providers/index.js';
import {
  emitStreamStart,
  emitStreamEnd,
  emitAgentStatus,
  emitStreamDelta,
  emitThinkingDelta,
  emitUserMessage,
} from './socketEmitter.js';
import { HOST_PROMPTS } from '../prompts/host.js';
import type { Message, Agent, MessageType } from '../types.js';
import { v4 as uuid } from 'uuid';
import { roomsRepo, messagesRepo } from '../db/index.js';
import { sessionsRepo } from '../db/index.js';
import { auditRepo } from '../db/index.js';
import { ensureWorkspace } from './workspace.js';
import {
  scanForA2AMentions,
  MAX_A2A_DEPTH,
  updateA2AContext,
} from './routing/A2ARouter.js';

function telemetry(event: string, meta: Record<string, unknown>) {
  auditRepo.log(event, undefined, undefined, meta);
  console.log(`[DEBUG] ${event}`, JSON.stringify(meta));
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
  const recentMessages = room.messages
    .slice(-10)
    .map(m => `【${m.agentName}】${m.content}`)
    .join('\n\n');

  const prompt = HOST_PROMPTS.MANAGER_ROUTE(room.topic, userContent, workers);

  // 3. Manager 流式输出（包含 A2A @mention）
  const managerOutput = await streamingCallAgent(
    {
      domainLabel: managerAgent.domainLabel,
      systemPrompt: managerSystemPrompt,
      userMessage: `${prompt}\n\n## 最近对话记录\n${recentMessages || '（暂无）'}`,
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
 * F0042: 直接路由到指定 Agent
 *
 * - toAgentId === MANAGER → 走 handleUserMessage（主持人路由逻辑）
 * - toAgentId === WORKER → 直接调用 callWorker（跳过主持人分析）
 * - 无 toAgentId → backward compat，走 handleUserMessage
 */
export async function routeToAgent(
  roomId: string,
  content: string,
  toAgentId?: string,
): Promise<void> {
  const room = store.get(roomId);
  if (!room) return;
  if (room.state === 'DONE') return;

  const managerAgent = room.agents.find(a => a.role === 'MANAGER');
  if (!managerAgent) return;

  console.log(`[DEBUG] routeToAgent room=${roomId} content="${content?.slice(0, 20)}" toAgentId=${toAgentId} managerId=${managerAgent.id}`);

  // backward compat: 无 toAgentId → 发给主持人
  if (!toAgentId || toAgentId === managerAgent.id) {
    console.log(`[DEBUG] routeToAgent → MANAGER (backward compat or MANAGER target)`);
    await handleUserMessage(roomId, content);
    return;
  }

  // 直接发给 Worker（跳过主持人分析）
  const target = room.agents.find(a => a.id === toAgentId);
  if (!target) {
    console.log(`[DEBUG] routeToAgent → target NOT FOUND (toAgentId=${toAgentId})`);
    telemetry('route:agent_not_found', { roomId, toAgentId });
    return;
  }
  if (target.role !== 'WORKER') {
    console.log(`[DEBUG] routeToAgent → target.role=${target.role} not WORKER, fallback to MANAGER`);
    await handleUserMessage(roomId, content);
    return;
  }
  console.log(`[DEBUG] routeToAgent → WORKER:${target.name}(${target.id})`);

  // 保存用户消息，标记 toAgentId
  addUserMessage(roomId, content, target.id);
  telemetry('msg:user:direct', { roomId, contentLength: content.length, toAgentId: target.id, toAgentName: target.name });

  // 直接调用 Worker
  const recentMessages = room.messages
    .slice(-10)
    .map(m => `【${m.agentName}】${m.content}`)
    .join('\n\n');

  const workerOutput = await streamingCallAgent(
    {
      domainLabel: target.domainLabel,
      systemPrompt: `专业${target.domainLabel}，执行具体任务`,
      userMessage: `议题：${room.topic}\n\n用户（直接发送给你）：${content}\n\n## 最近对话记录\n${recentMessages || '（暂无）'}`,
    },
    roomId,
    target.id,
    target.configId,
    target.name,
    'statement',
    'WORKER',
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
): Promise<string> {
  const agentConfig = getAgent(configId);
  const providerName = agentConfig?.provider ?? 'claude-code';
  const systemPrompt = agentConfig?.systemPrompt ?? ctx.systemPrompt;
  const prompt = `【角色】${ctx.domainLabel}（${systemPrompt}）

${ctx.userMessage}`;

  const room = store.get(roomId);
  const existingSessionId = room?.sessionIds[agentName];
  const workspace = await ensureWorkspace(roomId);
  const providerOpts: Record<string, unknown> = {
    ...(agentConfig?.providerOpts ?? {}),
    sessionId: existingSessionId,
    workspace,
    roomId,
    agentName,
  };

  const msg = addMessage(roomId, {
    agentRole,
    agentName,
    content: '',
    type: msgType,
  });
  const msgId = msg?.id ?? '';

  console.log(
    `[DEBUG] stream_start agent=${agentName}(${agentId}) msgId=${msgId} room=${roomId} role=${agentRole}`,
  );
  emitStreamStart(roomId, agentId, agentName, Date.now(), msgId, agentRole);
  updateAgentStatus(roomId, agentId, 'thinking');

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
        if (event.sessionId) returnedSessionId = event.sessionId;
      } else if (event.type === 'error') {
        throw new Error(event.message);
      }
    }
  } catch (err) {
    const ts = new Date().toISOString();
    console.error(
      `[${ts}] [ERROR] streamingCallAgent provider=${providerName} agentId=${agentId}`,
      err,
    );
    // 确保错误时也发出 stream_end 和 idle，防止 UI 卡在"回答中"
    if (msgId) {
      emitStreamEnd(roomId, agentId, msgId, { duration_ms: 0, total_cost_usd: 0, input_tokens: 0, output_tokens: 0 });
    }
    updateAgentStatus(roomId, agentId, 'idle');
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
        duration_ms,
        total_cost_usd,
        input_tokens,
        output_tokens,
      });
    }
  }

  console.log(
    `[DEBUG] stream_end agent=${agentName}(${agentId}) msgId=${msgId} duration=${duration_ms}ms deltas=${deltaCount} thoughts=${thinkingCount} outputLen=${accumulated.length}`,
  );
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

  let mentions = scanForA2AMentions(outputText);
  console.log(
    `[DEBUG] a2a_scan from=${fromAgentName} mentions=${JSON.stringify(mentions)} room=${roomId}`,
  );
  if (mentions.length === 0) return;

  // Output guard: only applies to Manager (host) agents in Clarify mode.
  // Workers can legitimately @mention multiple peers in parallel discussion.
  const isManager = room.agents.some(a => a.id === fromAgentId && a.role === 'MANAGER');
  const hasQuestion = /[？?]/.test(outputText);
  if (isManager && hasQuestion && mentions.length > 1) {
    console.log(`[DEBUG] a2a_guard: Manager question + ${mentions.length} mentions → keeping only first (@${mentions[0]})`);
    mentions = [mentions[0]];
  }

  const currentDepth = room.a2aDepth ?? 0;
  const currentChain = room.a2aCallChain ?? [];

  telemetry('a2a:detected', { roomId, fromAgentName, mentions, depth: currentDepth });

  // 达深度上限 → 截断，等待用户下一步
  if (currentDepth >= MAX_A2A_DEPTH) {
    telemetry('a2a:depth_limit', { roomId, depth: currentDepth, chain: currentChain });
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
    if (newChain.includes(targetAgent.name)) {
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
