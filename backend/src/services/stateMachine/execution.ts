import { agentRunsRepo, messagesRepo, sessionsRepo } from '../../db/index.js';
import { getAgent, type ProviderName } from '../../config/agentConfig.js';
import { getProvider as getProviderConfig } from '../../config/providerConfig.js';
import { debug, info, warn } from '../../lib/logger.js';
import { SOFTWARE_DEVELOPMENT_CORE_AGENT_IDS } from '../../prompts/builtinAgents.js';
import { store } from '../../store.js';
import type { Agent, ContextHealth, DiscussionRoom, InvocationUsage, Message, MessageType, ToolCall } from '../../types.js';
import {
  clearActiveAgentRun,
  registerActiveAgentRun,
} from '../agentRuns.js';
import { getProvider } from '../providers/index.js';
import {
  buildContextHealth,
  buildInvocationUsage,
  buildSessionTelemetry,
} from '../sessionTelemetry.js';
import {
  detectSingleInlineMentionFallback,
  detectRoundtableHandoff,
  getEffectiveMaxDepthForRoom,
  scanForA2AMentions,
  scanForInlineA2AMentions,
  updateA2AContext,
} from '../routing/A2ARouter.js';
import { buildAgentBasePrompt, buildRoomScopedSystemPrompt, resolvePinnedTeamMemberSnapshot } from '../teamPromptBuilder.js';
import {
  emitStreamDelta,
  emitStreamEnd,
  emitStreamStart,
  emitThinkingDelta,
  emitToolUse,
} from '../socketEmitter.js';
import {
  assembleProviderRuntime,
  buildEffectiveSkillSummary,
  resolveEffectiveSkills,
} from '../skills.js';
import {
  captureWorkspaceSnapshot,
  ensureWorkspace,
  summarizeWorkspaceChanges,
  type WorkspaceChangeSummary,
  type WorkspaceSnapshot,
} from '../workspace.js';
import { type AgentRequestMeta, handleAgentRunFailure } from './errors.js';
import {
  addMessage,
  addSystemMessage,
  appendMessageContent,
  buildTranscriptForAgentInvocation,
  telemetry,
  updateAgentStatus,
} from './shared.js';

const TITLE_SUGGESTION_COUNT = 7;
const TITLE_TRANSCRIPT_MAX_CHARS = 12000;
const TITLE_MAX_LENGTH = 100;
const UNNAMED_ROOM_PREFIX = '未命名讨论';

function clipTitleCandidate(raw: string): string | null {
  let next = raw
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*•]\s*/, '')
    .replace(/^\d+[\)\].、:\-\s]+/, '')
    .replace(/^标题(?:建议)?[:：]\s*/i, '')
    .replace(/^["'“”‘’「」『』《》]+|["'“”‘’「」『』《》]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!next) return null;
  if (next.length > TITLE_MAX_LENGTH) {
    next = next.slice(0, TITLE_MAX_LENGTH).trim();
  }
  return next || null;
}

function uniqTitleCandidates(candidates: string[]): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];

  for (const candidate of candidates) {
    const normalized = clipTitleCandidate(candidate);
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase('zh-CN');
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(normalized);
  }

  return titles;
}

function extractTitleTranscript(room: DiscussionRoom): string {
  const transcript = room.messages
    .filter(message => message.type !== 'system' && message.content.trim())
    .map(message => `【${message.agentName}】${message.content.trim()}`)
    .join('\n\n');

  if (transcript.length <= TITLE_TRANSCRIPT_MAX_CHARS) {
    return transcript;
  }

  return transcript.slice(-TITLE_TRANSCRIPT_MAX_CHARS);
}

function titleSeedFromRoom(room: DiscussionRoom, transcript: string): string {
  const roomTopic = clipTitleCandidate(room.topic);
  if (roomTopic && !roomTopic.startsWith(UNNAMED_ROOM_PREFIX)) {
    return roomTopic;
  }

  const firstLine = transcript
    .split('\n')
    .map(line => line.replace(/^【[^】]+】/, '').trim())
    .find(Boolean);

  if (firstLine) {
    return clipTitleCandidate(firstLine.slice(0, 24)) ?? '当前会话';
  }

  return '当前会话';
}

function parseTitleSuggestions(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(withoutFence) as string[] | { titles?: string[] };
    if (Array.isArray(parsed)) {
      return uniqTitleCandidates(parsed);
    }
    if (Array.isArray(parsed?.titles)) {
      return uniqTitleCandidates(parsed.titles);
    }
  } catch {
    // Fall through to line parsing.
  }

  return uniqTitleCandidates(withoutFence.split(/\r?\n+/));
}

function buildFallbackTitleSuggestions(room: DiscussionRoom, transcript: string): string[] {
  const seed = titleSeedFromRoom(room, transcript);
  const suffixes = ['', '方案对比', '问题拆解', '决策建议', '行动清单', '路线梳理', '关键结论'];
  return uniqTitleCandidates(
    suffixes.map(suffix => `${seed}${suffix}`),
  ).slice(0, TITLE_SUGGESTION_COUNT);
}

export async function generateTitleSuggestionsInline(
  roomId: string,
  worker: Agent,
): Promise<string[]> {
  const room = store.get(roomId);
  if (!room) {
    throw new Error('Room not found');
  }

  const transcript = extractTitleTranscript(room);
  const agentConfig = getAgent(worker.configId);
  const providerName = agentConfig?.provider ?? 'claude-code';
  const workspace = await ensureWorkspace(roomId, room.workspace);
  const explicitModel = typeof agentConfig?.providerOpts?.model === 'string' && agentConfig.providerOpts.model.trim()
    ? agentConfig.providerOpts.model.trim()
    : undefined;
  const provider = getProvider(providerName);
  const prompt = [
    `【当前执行者】${worker.name}`,
    `【角色】${worker.domainLabel}（${agentConfig?.systemPrompt ?? `专业${worker.domainLabel}，负责总结讨论并提炼标题`}）`,
    '【任务】请基于当前会话内容，为这个会话生成 7 个中文标题候选。',
    '【标题要求】',
    '1. 每个标题控制在 8 到 24 个字。',
    '2. 彼此角度不同，覆盖问题定义、方案比较、决策结论、行动导向等不同聚焦点。',
    '3. 直接可用作侧边栏会话名，避免空泛套话。',
    '4. 不要输出重复标题。',
    '【输出格式】只输出严格 JSON，不要 Markdown、不要解释、不要代码块。格式必须是：{"titles":["标题1","标题2","标题3","标题4","标题5","标题6","标题7"]}',
    `【当前标题】${room.topic}`,
    `【会话内容】\n${transcript || '（当前还没有正文，请基于现有标题生成候选）'}`,
  ].join('\n\n');

  let accumulated = '';

  for await (const event of provider(prompt, worker.id, {
    ...(agentConfig?.providerOpts ?? {}),
    workspace,
    roomId,
    agentName: worker.name,
    firstTokenTimeoutMs: 180000,
    idleTokenTimeoutMs: 180000,
    ...(explicitModel ? { model: explicitModel } : {}),
  })) {
    if (event.type === 'delta') {
      accumulated += event.text;
      continue;
    }
    if (event.type === 'error') {
      throw new Error(event.message);
    }
  }

  const titles = parseTitleSuggestions(accumulated);
  const merged = uniqTitleCandidates([
    ...titles,
    ...buildFallbackTitleSuggestions(room, transcript),
  ]);

  return merged.slice(0, TITLE_SUGGESTION_COUNT);
}

export async function streamingCallAgent(
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
  agentRole: 'MANAGER' | 'WORKER' = 'WORKER',
  requestMeta?: AgentRequestMeta,
): Promise<string> {
  const sessionKey = configId;
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
  let invocationUsage: InvocationUsage | undefined;
  let contextHealth: ContextHealth | undefined;
  let configuredModel: string | undefined;
  let runId: string | undefined;
  let runStartedAt = 0;
  let activeRunController: AbortController | null = null;
  let activeRunRegistered = false;
  let deltaCount = 0;
  let thinkingCount = 0;
  let accumulatedToolCalls: ToolCall[] = [];
  let implementerWorkspaceSnapshotBefore: WorkspaceSnapshot | null = null;
  let workspaceChanges: WorkspaceChangeSummary | undefined;

  try {
    const room = store.get(roomId);
    const agentConfig = getAgent(configId);
    const memberSnapshot = resolvePinnedTeamMemberSnapshot(roomId, configId);
    providerName = memberSnapshot?.provider ?? agentConfig?.provider ?? 'claude-code';
    const providerOptsSource = memberSnapshot?.providerOpts ?? agentConfig?.providerOpts ?? {};
    const systemPrompt = memberSnapshot?.systemPrompt ?? agentConfig?.systemPrompt ?? ctx.systemPrompt;
    const explicitModel = typeof providerOptsSource.model === 'string' && providerOptsSource.model.trim()
      ? providerOptsSource.model.trim()
      : undefined;
    configuredModel = providerName === 'opencode'
      ? explicitModel
      : (explicitModel ?? getProviderConfig(providerName)?.defaultModel);

    activeRunController = new AbortController();
    registerActiveAgentRun({
      roomId,
      agentId,
      agentName,
      abortController: activeRunController,
    });
    activeRunRegistered = true;
    const run = agentRunsRepo.createRunning({
      roomId,
      agentInstanceId: agentId,
      agentConfigId: configId,
      agentName,
      agentRole,
      triggerMessageId: requestMeta?.triggerMessageId,
      parentRunId: requestMeta?.parentRunId,
      provider: providerName,
      model: configuredModel,
      startedAt: Date.now(),
    });
    runId = run.id;
    runStartedAt = run.startedAt;

    const workspace = await ensureWorkspace(roomId, room?.workspace);
    const skillState = await resolveEffectiveSkills({
      roomId,
      agentConfigId: configId,
      workspacePath: workspace,
      providerName,
      teamSkillIds: memberSnapshot?.skillIds ?? [],
      teamSkillRefs: memberSnapshot?.skillRefs ?? [],
      includeDiscoveredSkills: memberSnapshot ? false : undefined,
    });
    const runtimeAssembly = await assembleProviderRuntime({
      roomId,
      providerName,
      effectiveWorkspace: workspace,
      effectiveSkills: skillState.effective,
    });
    const shouldTrackImplementerWorkspaceChanges = room?.teamId === 'software-development'
      && configId === SOFTWARE_DEVELOPMENT_CORE_AGENT_IDS.implementer;
    if (shouldTrackImplementerWorkspaceChanges) {
      implementerWorkspaceSnapshotBefore = await captureWorkspaceSnapshot(workspace);
    }

    const recentTranscript = room
      ? buildTranscriptForAgentInvocation(room, agentName)
      : undefined;

    const basePrompt = buildAgentBasePrompt(roomId, configId, agentName, ctx.domainLabel, systemPrompt);
    const prompt = buildRoomScopedSystemPrompt(roomId, basePrompt, {
      userMessage: ctx.userMessage,
      recentTranscript,
      roomTopic: room?.topic,
      toAgentName: agentName,
      a2aCallChain: room?.a2aCallChain,
      workspace,
      skillsSummary: buildEffectiveSkillSummary(skillState.effective),
    }) ?? `${basePrompt}\n\n${ctx.userMessage}`;

    const existingSessionId = room?.sessionIds[sessionKey];
    returnedSessionId = existingSessionId ?? '';
    const providerOpts: Record<string, unknown> = {
      ...providerOptsSource,
      sessionId: existingSessionId,
      workspace,
      providerRuntimeDir: runtimeAssembly.providerRuntimeDir,
      roomId,
      agentName,
      firstTokenTimeoutMs: 180000,
      idleTokenTimeoutMs: 180000,
      signal: activeRunController.signal,
    };

    msg = addMessage(roomId, {
      agentRole,
      agentName,
      content: '',
      type: msgType,
    });
    msgId = msg?.id ?? '';

    info('ai:start', {
      roomId,
      agentName,
      agentRole,
      provider: providerName,
      cliPath: (agentConfig?.providerOpts as Record<string, unknown> | undefined)?.cliPath ?? '',
      promptLength: prompt.length,
      sessionId: existingSessionId ?? 'new',
      workspace,
      providerRuntimeDir: runtimeAssembly.providerRuntimeDir,
    });
    debug('stream.start', { roomId, agentId, agentName, msgId, agentRole });
    emitStreamStart(roomId, agentId, configId, agentName, Date.now(), msgId, agentRole);
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
        const roomState = store.get(roomId);
        if (roomState && msg) {
          const messageId = msg.id;
          store.update(roomId, {
            messages: roomState.messages.map(m =>
              m.id === messageId
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
        invocationUsage = buildInvocationUsage({
          providerName,
          configuredModel,
          event,
        });
        contextHealth = buildContextHealth({
          usage: invocationUsage,
          hasExplicitContextWindow: typeof event.context_window_tokens === 'number' && event.context_window_tokens > 0,
        });
      } else if (event.type === 'error') {
        const providerError = new Error(event.message);
        (providerError as Error & { code?: string }).code = 'AGENT_PROVIDER_ERROR';
        throw providerError;
      }
    }

    if (implementerWorkspaceSnapshotBefore) {
      const workspaceSnapshotAfter = await captureWorkspaceSnapshot(workspace);
      workspaceChanges = summarizeWorkspaceChanges(implementerWorkspaceSnapshotBefore, workspaceSnapshotAfter);
    }
  } catch (err) {
    const runError = handleAgentRunFailure({
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
    if (runId) {
      const endedAt = Date.now();
      const payload = {
        outputMessageId: msgId || undefined,
        sessionId: returnedSessionId || undefined,
        endedAt,
        durationMs: runStartedAt ? Math.max(0, endedAt - runStartedAt) : undefined,
        inputTokens: input_tokens,
        outputTokens: output_tokens,
        totalCostUsd: total_cost_usd,
        invocationUsage,
        contextHealth,
        toolCalls: accumulatedToolCalls,
        workspaceChanges,
        error: runError,
      };
      if (runError.code === 'AGENT_STOPPED') {
        agentRunsRepo.markStopped(runId, payload);
      } else {
        agentRunsRepo.markFailed(runId, payload);
      }
    }
    throw err;
  } finally {
    if (activeRunRegistered) {
      clearActiveAgentRun(roomId, agentId, activeRunController ?? undefined);
    }
  }

  if (returnedSessionId) {
    const room = store.get(roomId);
    const sessionTelemetry = buildSessionTelemetry({
      sessionId: returnedSessionId,
      invocationUsage,
      contextHealth,
    });
    if (room) {
      store.update(roomId, {
        sessionIds: { ...room.sessionIds, [sessionKey]: returnedSessionId },
        sessionTelemetryByAgent: sessionTelemetry
          ? { ...(room.sessionTelemetryByAgent ?? {}), [sessionKey]: sessionTelemetry }
          : room.sessionTelemetryByAgent,
      });
      sessionsRepo.upsert(sessionKey, roomId, returnedSessionId, sessionTelemetry);
    }
  }

  if (msg) {
    const room = store.get(roomId);
    if (room) {
      store.update(roomId, {
        messages: room.messages.map(m =>
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
                sessionId: returnedSessionId || undefined,
                invocationUsage,
                contextHealth,
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
        sessionId: returnedSessionId || undefined,
        invocationUsage,
        contextHealth,
      });
    }
  }

  if (runId) {
    agentRunsRepo.markSucceeded(runId, {
      outputMessageId: msgId || undefined,
      sessionId: returnedSessionId || undefined,
      endedAt: Date.now(),
      durationMs: duration_ms,
      inputTokens: input_tokens,
      outputTokens: output_tokens,
      totalCostUsd: total_cost_usd,
      invocationUsage,
      contextHealth,
      toolCalls: accumulatedToolCalls,
      workspaceChanges,
    });
  }

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
    context_used_tokens: contextHealth?.usedTokens,
    context_window_tokens: contextHealth?.windowSize,
  });
  debug('stream.end', {
    roomId,
    agentId,
    agentName,
    msgId,
    duration_ms,
    deltaCount,
    thinkingCount,
    outputLen: accumulated.length,
  });
  updateAgentStatus(roomId, agentId, 'idle');
  emitStreamEnd(roomId, agentId, msgId, {
    duration_ms,
    total_cost_usd,
    input_tokens,
    output_tokens,
    agentConfigId: configId,
    sessionId: returnedSessionId || undefined,
    invocationUsage,
    contextHealth,
  });

  await a2aOrchestrate(roomId, agentId, agentName, accumulated, { workspaceChanges, parentRunId: runId });
  return accumulated;
}

export async function a2aOrchestrate(
  roomId: string,
  fromAgentId: string,
  fromAgentName: string,
  outputText: string,
  meta: {
    workspaceChanges?: WorkspaceChangeSummary;
    parentRunId?: string;
  } = {},
): Promise<void> {
  const room = store.get(roomId);
  if (!room) return;

  const mentionTargets = Array.from(
    new Set(
      room.agents.flatMap(a => [a.name, a.domainLabel, a.configId].map(v => v.trim())).filter(Boolean),
    ),
  );

  let mentions: string[] = [];
  let mentionSource = 'line_start';

  if (room.teamId === 'roundtable-forum') {
    const handoff = detectRoundtableHandoff(outputText, mentionTargets);
    if (handoff) {
      mentions = [handoff.mention];
      mentionSource = handoff.source;
      if (handoff.source === 'inline_last_line_fallback') {
        warn('a2a:mention_fallback_inline_last_line', {
          roomId,
          fromAgentName,
          mention: handoff.mention,
        });
      } else if (handoff.source === 'standalone_with_trailing_text_fallback') {
        warn('a2a:mention_fallback_trailing_text_after_standalone', {
          roomId,
          fromAgentName,
          mention: handoff.mention,
        });
      }
    } else {
      mentionSource = 'roundtable_invalid_or_missing';
      const inlineMentions = scanForInlineA2AMentions(outputText, mentionTargets);
      if (inlineMentions.length > 0) {
        warn('a2a:invalid_mention_format', {
          roomId,
          fromAgentName,
          mentions: inlineMentions,
          teamId: room.teamId,
        });
        addSystemMessage(
          roomId,
          `[系统提示] ${fromAgentName} 使用了非标准圆桌交棒格式。圆桌论坛请在最后一行单独写 @专家名；本轮未自动接力。`,
        );
      }
    }
  } else {
    mentions = scanForA2AMentions(outputText, mentionTargets);
    if (mentions.length === 0) {
      const inlineFallback = detectSingleInlineMentionFallback(outputText, mentionTargets);
      if (inlineFallback) {
        mentions = [inlineFallback];
        mentionSource = 'inline_single_fallback';
        addSystemMessage(
          roomId,
          `[系统提示] 检测到 ${fromAgentName} 只有一个句内 @${inlineFallback}，已自动按单目标交接处理。后续请把 @专家名 放到单独一行行首。`,
        );
      }
    }
  }

  if (room.teamId === 'software-development' && mentions.length > 1) {
    warn('a2a:software_development:multi_mention', {
      roomId,
      fromAgentName,
      mentions,
    });
    addSystemMessage(
      roomId,
      `[系统提示] 软件开发团队每轮只允许 @ 1 位专家。${fromAgentName} 本轮仅保留第一个交接对象：@${mentions[0] ?? ''}。`,
    );
    mentions = mentions.slice(0, 1);
  }

  debug('a2a:scan', { roomId, fromAgentName, mentions, mentionSource, teamId: room.teamId });
  const fromAgent = room.agents.find(agent => agent.id === fromAgentId);
  if (room.teamId === 'software-development') {
    const implementerGate = evaluateImplementerCompletionGate({
      room,
      fromAgent,
      mentions,
      workspaceChanges: meta.workspaceChanges,
    });
    if (!implementerGate.allowed) {
      addSystemMessage(roomId, implementerGate.message);
      return;
    }
  }
  if (mentions.length === 0) return;

  const currentDepth = room.a2aDepth ?? 0;
  const currentChain = room.a2aCallChain ?? [];
  const effectiveMaxDepth = getEffectiveMaxDepthForRoom(roomId);

  telemetry('a2a:detected', { roomId, fromAgentName, mentions, depth: currentDepth });

  if (effectiveMaxDepth > 0 && currentDepth >= effectiveMaxDepth) {
    telemetry('a2a:depth_limit', { roomId, depth: currentDepth, chain: currentChain });
    addSystemMessage(
      roomId,
      `[系统提醒] 已达到协作深度上限（${effectiveMaxDepth} 层），当前停止继续 @ 其他专家，请你决定下一步。`,
    );
    return;
  }

  if (room.teamId === 'software-development') {
    const targetAgent = resolveMentionTarget(room.agents, mentions[0] ?? '');
    if (!targetAgent) {
      telemetry('a2a:agent_not_found', { roomId, mention: mentions[0] });
      return;
    }

    const softwareGuard = evaluateSoftwareDevelopmentHandoff({
      room,
      fromAgent,
      fromAgentName,
      targetAgent,
      outputText,
      newChain: [...currentChain, fromAgentName],
    });
    if (!softwareGuard.allowed) {
      addSystemMessage(roomId, softwareGuard.message);
      return;
    }
  }

  const newChain = [...currentChain, fromAgentName];
  updateA2AContext(roomId, currentDepth + 1, newChain);

  const skippedCycleTargets: string[] = [];
  let routedCount = 0;

  for (const mention of mentions) {
    const targetAgent = resolveMentionTarget(room.agents, mention);

    if (!targetAgent) {
      telemetry('a2a:agent_not_found', { roomId, mention });
      continue;
    }

    if (room.teamId !== 'software-development' && createsImmediatePingPong(newChain, targetAgent.name)) {
      telemetry('a2a:skip_cycle', { roomId, target: targetAgent.name, chain: newChain });
      skippedCycleTargets.push(targetAgent.name);
      continue;
    }

    telemetry('a2a:route', {
      roomId,
      from: fromAgentName,
      to: targetAgent.name,
      depth: currentDepth + 1,
    });

    const filteredOutput = outputText
      .replace(new RegExp(`@${targetAgent.name}(?![\\w])`, 'g'), targetAgent.name)
      .replace(new RegExp(`@${targetAgent.domainLabel}(?![\\w])`, 'g'), targetAgent.domainLabel);

    const a2aPrompt = `【A2A 协作请求】

来自：${fromAgentName}
调用链：${newChain.join(' → ')}
议题：${room.topic}

${fromAgentName} 的输出：
${filteredOutput}

你是 ${targetAgent.domainLabel}。请基于以上上下文继续短打推进：先给结论或反驳，再补 1 个核心理由。
详细论证放到思考过程；回复区不要写成长文。
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
      { parentRunId: meta.parentRunId },
    );
    routedCount++;
  }

  if (routedCount === 0 && skippedCycleTargets.length > 0) {
    addSystemMessage(
      roomId,
      `[系统提醒] 检测到重复协作链路，已跳过 ${skippedCycleTargets.map(name => `@${name}`).join('、')}，避免讨论原地打转。请引入新专家或由你来决定下一步。`,
    );
  }
}

const ARCHITECTURE_APPROVED_PATTERN = /架构结论[:：]\s*通过/u;
const ARCHITECTURE_USER_CONFIRM_PATTERN = /架构结论[:：]\s*待用户确认/u;

function resolveMentionTarget(agents: Agent[], mention: string): Agent | undefined {
  const normalizedMention = mention.toLowerCase();
  return agents.find(
    agent =>
      agent.name.toLowerCase() === normalizedMention ||
      agent.domainLabel.toLowerCase() === normalizedMention ||
      agent.configId.toLowerCase() === normalizedMention,
  );
}

function countRecentArchitectureDebateTurns(
  callChain: string[],
  leadArchitectName: string,
  challengeArchitectName: string,
): number {
  let count = 0;
  let previousSpeaker: string | null = null;

  for (let index = callChain.length - 1; index >= 0; index -= 1) {
    const speaker = callChain[index];
    if (speaker !== leadArchitectName && speaker !== challengeArchitectName) break;
    if (previousSpeaker === speaker) break;
    previousSpeaker = speaker;
    count += 1;
  }

  return count;
}

function evaluateSoftwareDevelopmentHandoff({
  room,
  fromAgent,
  fromAgentName,
  targetAgent,
  outputText,
  newChain,
}: {
  room: { agents: Agent[] };
  fromAgent: Agent | undefined;
  fromAgentName: string;
  targetAgent: Agent;
  outputText: string;
  newChain: string[];
}): { allowed: true } | { allowed: false; message: string } {
  if (!fromAgent) return { allowed: true };

  const leadArchitect = room.agents.find(agent => agent.configId === SOFTWARE_DEVELOPMENT_CORE_AGENT_IDS.leadArchitect);
  const challengeArchitect = room.agents.find(agent => agent.configId === SOFTWARE_DEVELOPMENT_CORE_AGENT_IDS.challengeArchitect);
  const implementer = room.agents.find(agent => agent.configId === SOFTWARE_DEVELOPMENT_CORE_AGENT_IDS.implementer);
  const reviewer = room.agents.find(agent => agent.configId === SOFTWARE_DEVELOPMENT_CORE_AGENT_IDS.reviewer);

  // Legacy rooms may still use the old 3-role setup. Only enforce the dual-architect gate
  // when both architect roles are present in the room.
  if (!leadArchitect || !challengeArchitect) {
    return { allowed: true };
  }

  if (fromAgent.id === leadArchitect.id && targetAgent.id !== challengeArchitect.id) {
    return {
      allowed: false,
      message: `[系统提示] 软件开发默认先走双架构收敛。${fromAgentName} 当前只能先交给 @${challengeArchitect.name}，不能直接推进到 @${targetAgent.name}。`,
    };
  }

  if (fromAgent.id === challengeArchitect.id) {
    const debateTurns = countRecentArchitectureDebateTurns(newChain, leadArchitect.name, challengeArchitect.name);
    if (targetAgent.id === leadArchitect.id && debateTurns >= 4) {
      return {
        allowed: false,
        message: `[系统提示] 主架构师与挑战架构师已连续两轮仍未收敛。请当前发言者直接向用户提出 1 个待确认决策，不要继续 @${leadArchitect.name}。`,
      };
    }

    if (targetAgent.id === implementer?.id) {
      if (!ARCHITECTURE_APPROVED_PATTERN.test(outputText)) {
        return {
          allowed: false,
          message: `[系统提示] 挑战架构师只有在明确写出“架构结论：通过”后，才能把任务交给 @${targetAgent.name}。`,
        };
      }
      return { allowed: true };
    }

    if (targetAgent.id === leadArchitect.id) {
      if (ARCHITECTURE_USER_CONFIRM_PATTERN.test(outputText)) {
        return {
          allowed: false,
          message: '[系统提示] 既然结论是“架构结论：待用户确认”，本轮就不要再 @ 其他专家，直接把决策问题留给用户。',
        };
      }
      return { allowed: true };
    }

    return {
      allowed: false,
      message: `[系统提示] 挑战架构师本轮只能 @${leadArchitect.name}，或在“架构结论：通过”后 @${implementer?.name ?? '实现工程师'}。`,
    };
  }

  if (fromAgent.id === implementer?.id && targetAgent.id === challengeArchitect.id) {
    return {
      allowed: false,
      message: `[系统提示] 实现阶段如遇设计阻塞，请回到 @${leadArchitect.name} 收敛，不要直接把实现问题交给 @${challengeArchitect.name}。`,
    };
  }

  if (fromAgent.id === reviewer?.id && targetAgent.id === challengeArchitect.id) {
    return {
      allowed: false,
      message: `[系统提示] Reviewer 如需补齐方案，请找 @${leadArchitect.name} 或 @${implementer?.name ?? '实现工程师'}，不要直接回流到 @${challengeArchitect.name}。`,
    };
  }

  return { allowed: true };
}

function evaluateImplementerCompletionGate({
  room,
  fromAgent,
  mentions,
  workspaceChanges,
}: {
  room: { agents: Agent[] };
  fromAgent: Agent | undefined;
  mentions: string[];
  workspaceChanges?: WorkspaceChangeSummary;
}): { allowed: true } | { allowed: false; message: string } {
  if (!fromAgent || fromAgent.configId !== SOFTWARE_DEVELOPMENT_CORE_AGENT_IDS.implementer) {
    return { allowed: true };
  }

  if (!workspaceChanges) {
    return { allowed: true };
  }

  const leadArchitect = room.agents.find(agent => agent.configId === SOFTWARE_DEVELOPMENT_CORE_AGENT_IDS.leadArchitect);
  const reviewer = room.agents.find(agent => agent.configId === SOFTWARE_DEVELOPMENT_CORE_AGENT_IDS.reviewer);
  const targetAgent = resolveMentionTarget(room.agents, mentions[0] ?? '');

  if (leadArchitect && targetAgent?.id === leadArchitect.id) {
    return { allowed: true };
  }

  const missing: string[] = [];
  if (!workspaceChanges.hasChanges) {
    missing.push('未检测到工作目录中的文件改动');
  }
  if (!reviewer || targetAgent?.id !== reviewer.id) {
    missing.push(`没有把结果交给 @${reviewer?.name ?? 'Reviewer'}`);
  }

  if (missing.length === 0) {
    return { allowed: true };
  }

  return {
    allowed: false,
    message: `[系统提示] 实现工程师本轮还不能算完成：${missing.join('；')}。请继续把代码真正写入工作目录；完成实现后在最后另起一行 @${reviewer?.name ?? 'Reviewer'}。如果是设计阻塞，只允许 @${leadArchitect?.name ?? '主架构师'} 说明唯一卡点。`,
  };
}

function createsImmediatePingPong(callChain: string[], targetAgentName: string): boolean {
  if (callChain.length < 3) return false;

  const currentSpeaker = callChain[callChain.length - 1];
  const previousSpeaker = callChain[callChain.length - 2];
  const speakerBeforePrevious = callChain[callChain.length - 3];

  return speakerBeforePrevious === currentSpeaker && previousSpeaker === targetAgentName;
}
