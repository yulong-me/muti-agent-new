/**
 * F004: Manager 路由器路由
 *
 * 核心变化：
 * - POST / 创建讨论室：不需要 topic（用户自由输入）
 * - POST /:id/messages 用户发消息 → Manager 处理
 * - 移除 /start 和 /advance（无状态机阶段）
 */

import { Router } from 'express';
import { debug, error, info, warn } from '../lib/logger.js';
import { v4 as uuid } from 'uuid';
import { store } from '../store.js';
import type { DiscussionRoom } from '../types.js';
import { routeToAgent, generateReportInline, generateTitleSuggestionsInline, stopAgentRun, isRoomBusy } from '../services/stateMachine.js';
import { roomsRepo, sessionsRepo, messagesRepo, scenesRepo } from '../db/index.js';
import { auditRepo } from '../db/index.js';
import { archiveWorkspace, validateWorkspacePath } from '../services/workspace.js';
import { getAgent } from '../config/agentConfig.js';
import { getProvider as getProviderConfig } from '../config/providerConfig.js';
import { computeEffectiveMessageMentions, resolveEffectiveMaxDepth } from '../services/routing/A2ARouter.js';
import { SOFTWARE_DEVELOPMENT_CORE_AGENT_IDS } from '../prompts/builtinAgents.js';
import { buildProviderReadiness } from '../services/providerReadiness.js';
import {
  discoverWorkspaceSkills,
  getRoomWorkspace,
  listRoomSkillBindings,
  replaceRoomSkillBindings,
  resolveEffectiveSkills,
} from '../services/skills.js';

export const roomsRouter = Router();

const SOFTWARE_DEVELOPMENT_CORE_REQUIREMENTS = [
  { id: SOFTWARE_DEVELOPMENT_CORE_AGENT_IDS.leadArchitect, label: '主架构师' },
  { id: SOFTWARE_DEVELOPMENT_CORE_AGENT_IDS.challengeArchitect, label: '挑战架构师' },
  { id: SOFTWARE_DEVELOPMENT_CORE_AGENT_IDS.implementer, label: '实现工程师' },
  { id: SOFTWARE_DEVELOPMENT_CORE_AGENT_IDS.reviewer, label: 'Reviewer' },
] as const;

interface ProviderPreflightIssue {
  type: 'agent_not_found' | 'provider_not_found' | 'provider_cli_missing' | 'provider_untested' | 'provider_test_failed';
  provider?: string;
  label?: string;
  cliPath?: string;
  agentIds: string[];
  agentNames: string[];
  message: string;
}

function upsertProviderIssue(
  issues: Map<string, ProviderPreflightIssue>,
  key: string,
  issue: ProviderPreflightIssue,
) {
  const existing = issues.get(key);
  if (!existing) {
    issues.set(key, issue);
    return;
  }
  existing.agentIds.push(...issue.agentIds);
  existing.agentNames.push(...issue.agentNames);
}

function buildRoomPreflight(workerIds: string[]) {
  const blockers = new Map<string, ProviderPreflightIssue>();
  const warnings = new Map<string, ProviderPreflightIssue>();

  for (const workerId of workerIds) {
    const agent = getAgent(workerId);
    if (!agent) {
      upsertProviderIssue(blockers, `agent:${workerId}`, {
        type: 'agent_not_found',
        agentIds: [workerId],
        agentNames: [workerId],
        message: `Agent 不存在：${workerId}`,
      });
      continue;
    }

    const provider = getProviderConfig(agent.provider);
    if (!provider) {
      upsertProviderIssue(blockers, `provider:${agent.provider}`, {
        type: 'provider_not_found',
        provider: agent.provider,
        label: agent.provider,
        agentIds: [agent.id],
        agentNames: [agent.name],
        message: `Provider 不存在：${agent.provider}`,
      });
      continue;
    }

    const readiness = buildProviderReadiness(provider);
    const common = {
      provider: provider.name,
      label: provider.label,
      cliPath: provider.cliPath,
      agentIds: [agent.id],
      agentNames: [agent.name],
    };

    if (readiness.status === 'cli_missing') {
      upsertProviderIssue(blockers, `cli:${provider.name}`, {
        ...common,
        type: 'provider_cli_missing',
        message: readiness.message,
      });
    } else if (readiness.status === 'test_failed') {
      upsertProviderIssue(warnings, `test:${provider.name}`, {
        ...common,
        type: 'provider_test_failed',
        message: readiness.message,
      });
    } else if (readiness.status === 'untested') {
      upsertProviderIssue(warnings, `untested:${provider.name}`, {
        ...common,
        type: 'provider_untested',
        message: readiness.message,
      });
    }
  }

  const blockerList = Array.from(blockers.values());
  return {
    ok: blockerList.length === 0,
    blockers: blockerList,
    warnings: Array.from(warnings.values()),
  };
}

// GET /api/rooms — 列出所有讨论室（按最近活跃排序）
roomsRouter.get('/', (_req, res) => {
  res.json(roomsRepo.list());
});

// GET /api/rooms/sidebar — 轻量列表，用于侧边栏导航（不含全量 messages）
roomsRouter.get('/sidebar', (_req, res) => {
  res.json(roomsRepo.listSidebar().map(room => ({
    ...room,
    activityState: room.state === 'DONE'
      ? 'done'
      : isRoomBusy(room.id)
        ? 'busy'
        : 'open',
  })));
});

// POST /api/rooms/preflight — check selected agents before room creation
roomsRouter.post('/preflight', (req, res) => {
  const workerIds = Array.isArray(req.body?.workerIds) ? req.body.workerIds as string[] : [];
  const result = buildRoomPreflight(workerIds);
  debug('room:preflight', {
    workerCount: workerIds.length,
    blockerCount: result.blockers.length,
    warningCount: result.warnings.length,
  });
  res.json(result);
});

// POST /api/rooms — 创建讨论室（运行期仅创建 WORKER）
roomsRouter.post('/', async (req, res) => {
  const { topic, workerIds: rawWorkerIds, workspacePath, sceneId, roomSkills: rawRoomSkills } = req.body as {
    topic?: string;
    workerIds?: string[];
    workspacePath?: string; // F006: custom workspace directory
    sceneId?: string; // F016: scene ID, defaults to roundtable-forum
    roomSkills?: Array<{ skillId?: string; skillName?: string; mode?: 'auto' | 'required'; enabled?: boolean }>;
  };

  const workerIds: string[] = rawWorkerIds ?? [];
  const roomSkills = rawRoomSkills ?? [];
  const roomTopic = topic?.trim() || '自由讨论';

  // F016: Validate sceneId — always check effectiveSceneId exists
  const effectiveSceneId = sceneId ?? 'roundtable-forum';
  if (!scenesRepo.get(effectiveSceneId)) {
    warn('room:create:invalid_scene', { sceneId: effectiveSceneId });
    return res.status(400).json({ error: `Scene not found: ${effectiveSceneId}` });
  }

  // F006: Validate custom workspace path if provided
  if (workspacePath) {
    try {
      await validateWorkspacePath(workspacePath);
    } catch (err) {
      warn('room:create:invalid_workspace', { workspacePath, error: err });
      return res.status(400).json({ error: (err as Error).message });
    }
  }

  if (!workerIds || workerIds.length < 1) {
    warn('room:create:invalid_workers', { reason: 'empty_worker_list' });
    return res.status(400).json({ error: '至少选择 1 位专家' });
  }

  // Resolve workers (with role + enabled validation)
  const invalid = workerIds.filter(id => !getAgent(id));
  if (invalid.length > 0) {
    warn('room:create:invalid_workers', { reason: 'agent_not_found', invalid });
    return res.status(400).json({ error: `Agent not found: ${invalid.join(', ')}` });
  }
  const disabled = workerIds.filter(id => {
    const cfg = getAgent(id)!;
    return !cfg.enabled || cfg.role !== 'WORKER';
  });
  if (disabled.length > 0) {
    warn('room:create:invalid_workers', { reason: 'disabled_or_non_worker', invalid: disabled });
    return res.status(400).json({ error: `Invalid workers (must be enabled WORKER): ${disabled.join(', ')}` });
  }

  if (effectiveSceneId === 'roundtable-forum' && workerIds.length < 3) {
    warn('room:create:invalid_workers', {
      reason: 'insufficient_workers_for_roundtable',
      workerCount: workerIds.length,
      sceneId: effectiveSceneId,
    });
    return res.status(400).json({ error: '圆桌论坛至少选择 3 位专家' });
  }

  if (effectiveSceneId === 'software-development') {
    const missingCore = SOFTWARE_DEVELOPMENT_CORE_REQUIREMENTS.filter(requirement => !workerIds.includes(requirement.id));
    if (missingCore.length > 0) {
      warn('room:create:invalid_workers', {
        reason: 'missing_software_development_core_agents',
        missing: missingCore.map(requirement => requirement.id),
        sceneId: effectiveSceneId,
      });
      return res.status(400).json({
        error: `软件开发场景必须包含 4 位核心专家：主架构师、挑战架构师、实现工程师、Reviewer。当前缺少：${missingCore.map(requirement => requirement.label).join('、')}`,
      });
    }
  }

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
    topic: roomTopic,
    state: 'RUNNING',
    agents: workerEntries, // F012: no MANAGER in room
    messages: [],
    workspace: workspacePath,
    sceneId: effectiveSceneId, // F016: validated above
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sessionIds: {},
    sessionTelemetryByAgent: {},
    a2aDepth: 0,
    a2aCallChain: [],
    maxA2ADepth: null, // F017: null = inherit from scene
  };
  store.create(room);
  roomsRepo.create(room);
  try {
    if (roomSkills.length > 0) {
      replaceRoomSkillBindings(room.id, roomSkills);
    }
  } catch (err) {
    store.delete(room.id);
    roomsRepo.permanentDelete(room.id);
    warn('room:create:invalid_skills', { roomId: room.id, error: err, skillCount: roomSkills.length });
    return res.status(400).json({ error: (err as Error).message || 'Invalid room skills' });
  }
  info('room:create', {
    roomId: room.id,
    sceneId: room.sceneId,
    workerCount: workerEntries.length,
    roomSkillCount: roomSkills.length,
    hasWorkspace: Boolean(room.workspace),
  });
  auditRepo.log('room:create', room.topic, undefined, {
    roomId: room.id,
    workerCount: workerEntries.length,
    workers: workerEntries.map(w => w.name),
    sceneId: room.sceneId,
  });
  res.json(room);
});

// GET /api/rooms/:id — 获取讨论室
roomsRouter.get('/:id', (req, res) => {
  const room = store.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(room);
});

roomsRouter.get('/:id/skills', async (req, res) => {
  const room = store.get(req.params.id);
  if (!room) {
    warn('room:skills:get:not_found', { roomId: req.params.id });
    return res.status(404).json({ error: 'Room not found' });
  }

  const workspacePath = await getRoomWorkspace(req.params.id);
  const roomBindings = listRoomSkillBindings(req.params.id);
  const discoveredResult = await discoverWorkspaceSkills(workspacePath);
  const agentSkillStates = await Promise.all(room.agents.map(async agent => {
    const effective = await resolveEffectiveSkills({
      roomId: req.params.id,
      agentConfigId: agent.configId,
      workspacePath,
      providerName: getAgent(agent.configId)?.provider ?? 'claude-code',
    });
    return {
      agentId: agent.id,
      configId: agent.configId,
      agentName: agent.name,
      provider: getAgent(agent.configId)?.provider ?? 'claude-code',
      agentBindings: effective.agentBindings,
      effectiveSkills: effective.effective,
    };
  }));

  const effectiveUnion = Array.from(new Map(
    agentSkillStates.flatMap(state => state.effectiveSkills).map(skill => [skill.name, skill]),
  ).values()).sort((a, b) => a.name.localeCompare(b.name));

  debug('room:skills:get', {
    roomId: req.params.id,
    roomBindingCount: roomBindings.length,
    globalCount: discoveredResult.globalSkills.length,
    workspaceCount: discoveredResult.workspaceSkills.length,
    effectiveCount: effectiveUnion.length,
    agentCount: agentSkillStates.length,
  });

  res.json({
    workspacePath,
    roomBindings,
    discovered: discoveredResult.skills,
    globalSkills: discoveredResult.globalSkills,
    workspaceSkills: discoveredResult.workspaceSkills,
    effectiveUnion,
    agentSkillStates,
  });
});

roomsRouter.put('/:id/skills', (req, res) => {
  const room = store.get(req.params.id);
  if (!room) {
    warn('room:skills:update:not_found', { roomId: req.params.id });
    return res.status(404).json({ error: 'Room not found' });
  }

  const bindings = Array.isArray(req.body?.bindings) ? req.body.bindings : [];
  try {
    const next = replaceRoomSkillBindings(req.params.id, bindings);
    info('room:skills:update', { roomId: req.params.id, bindingCount: next.length });
    res.json(next);
  } catch (err) {
    warn('room:skills:update:invalid', { roomId: req.params.id, error: err });
    res.status(400).json({ error: (err as Error).message || 'Failed to update room skills' });
  }
});

// PATCH /api/rooms/:id — 更新讨论室配置（F017: maxA2ADepth）
roomsRouter.patch('/:id', (req, res) => {
  const { id } = req.params;
  const room = store.get(id);
  if (!room) {
    warn('room:update:not_found', { roomId: id });
    return res.status(404).json({ error: 'Room not found' });
  }

  const { maxA2ADepth, topic } = req.body as { maxA2ADepth?: number | null; topic?: string };

  // 有效值：3, 5, 10, 0(无限), null(继承scene)
  const validValues = new Set([3, 5, 10, 0, null]);
  if (maxA2ADepth !== undefined && !validValues.has(maxA2ADepth)) {
    warn('room:update:invalid_depth', { roomId: id, maxA2ADepth });
    return res.status(400).json({ error: 'maxA2ADepth must be 3, 5, 10, 0, or null' });
  }

  const trimmedTopic = typeof topic === 'string' ? topic.trim() : undefined;
  if (topic !== undefined && !trimmedTopic) {
    warn('room:update:invalid_topic', { roomId: id, reason: 'empty_topic' });
    return res.status(400).json({ error: 'topic cannot be empty' });
  }
  if (trimmedTopic && trimmedTopic.length > 100) {
    warn('room:update:invalid_topic', { roomId: id, reason: 'topic_too_long', topicLength: trimmedTopic.length });
    return res.status(400).json({ error: 'topic must be 100 characters or fewer' });
  }

  const updated = roomsRepo.update(id, {
    ...(trimmedTopic ? { topic: trimmedTopic } : {}),
    ...(maxA2ADepth !== undefined ? { maxA2ADepth } : {}),
  });
  if (!updated) return res.status(404).json({ error: 'Room not found' });

  // 同步更新 in-memory store
  store.update(id, {
    topic: updated.topic,
    maxA2ADepth: updated.maxA2ADepth,
  });

  info('room:update:max_depth', {
    roomId: id,
    topicChanged: trimmedTopic !== undefined,
    topic: trimmedTopic ?? room.topic,
    maxA2ADepth: updated.maxA2ADepth,
    effectiveMaxDepth: resolveEffectiveMaxDepth(updated.maxA2ADepth, updated.sceneId),
  });

  res.json({
    ...updated,
    effectiveMaxDepth: resolveEffectiveMaxDepth(updated.maxA2ADepth, updated.sceneId),
  });
});

roomsRouter.post('/:id/title-suggestions', async (req, res) => {
  const room = store.get(req.params.id);
  if (!room) {
    warn('room:title_suggestions:not_found', { roomId: req.params.id });
    return res.status(404).json({ error: 'Room not found' });
  }
  if (isRoomBusy(req.params.id)) {
    warn('room:title_suggestions:busy', { roomId: req.params.id });
    return res.status(409).json({ code: 'ROOM_BUSY', error: 'Room has an Agent currently executing' });
  }

  const worker = room.agents.find(agent => agent.role === 'WORKER');
  if (!worker) {
    warn('room:title_suggestions:no_worker', { roomId: req.params.id });
    return res.status(400).json({ error: 'No expert available to generate title suggestions' });
  }

  try {
    const titles = await generateTitleSuggestionsInline(req.params.id, worker);
    info('room:title_suggestions', {
      roomId: req.params.id,
      agentId: worker.id,
      agentName: worker.name,
      titleCount: titles.length,
    });
    return res.json({
      titles,
      agentId: worker.id,
      agentName: worker.name,
    });
  } catch (err) {
    warn('room:title_suggestions:failed', { roomId: req.params.id, error: err });
    return res.status(500).json({ error: (err as Error).message || 'Failed to generate title suggestions' });
  }
});

// GET /api/rooms/:id/messages — 轮询获取消息
roomsRouter.get('/:id/messages', (req, res) => {
  const room = store.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const sessionTelemetryByAgent = sessionsRepo?.getTelemetryByRoom?.(req.params.id) ?? {};
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    state: room.state,
    messages: room.messages.map(message => ({
      ...message,
      effectiveMentions: message.agentRole === 'USER'
        ? []
        : computeEffectiveMessageMentions(message.content, room.sceneId, room.agents),
    })),
    agents: room.agents,
    report: room.report,
    sceneId: room.sceneId,
    maxA2ADepth: room.maxA2ADepth, // F017: room override (null = inherit scene)
    a2aDepth: room.a2aDepth ?? 0, // F017: current A2A depth
    effectiveMaxDepth: resolveEffectiveMaxDepth(room.maxA2ADepth, room.sceneId), // F017: computed max depth
    workspace: room.workspace, // F006: workspace path for file browser
    sessionTelemetryByAgent,
  });
});

// POST /api/rooms/:id/messages — 用户发送消息 → 路由前置 + Fallback 拦截
roomsRouter.post('/:id/messages', async (req, res) => {
  const room = store.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.state === 'DONE') {
    return res.status(400).json({ error: 'Room already done' });
  }

  // F015: room busy guard — prevents concurrent dispatch (multi-tab safety net)
  if (isRoomBusy(req.params.id)) {
    return res.status(409).json({ code: 'ROOM_BUSY', error: 'Room has an Agent currently executing' });
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

  // F013: toAgentId is mandatory — no implicit fallback
  if (!toAgentId) {
    return res.status(400).json({ error: 'Target Expert Required: toAgentId is mandatory' });
  }

// F013: toAgentId is non-null (guaranteed above); target exists (404 already returned if not)
  // 异步处理，不阻塞响应
  routeToAgent(req.params.id, content.trim(), target!.id).catch(err => {
    const code = (err as Error & { code?: string }).code;
    if (code === 'AGENT_STOPPED') {
      info('route:msg_stopped', { roomId: req.params.id, agentId: target!.id });
      return;
    }
    error('route:msg_error', { roomId: req.params.id, error: String(err) });
  });

  res.json({ status: 'ok' });
});

// POST /api/rooms/:id/agents/:agentId/stop — 停止当前正在回答的 Agent
roomsRouter.post('/:id/agents/:agentId/stop', (req, res) => {
  const room = store.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const target = room.agents.find(agent => agent.id === req.params.agentId);
  if (!target) {
    return res.status(404).json({ error: `Agent not found: ${req.params.agentId}` });
  }

  const result = stopAgentRun(req.params.id, req.params.agentId);
  if (!result.stopped) {
    return res.status(409).json({ error: 'Agent is not currently running' });
  }

  info('route:agent_stop', {
    roomId: req.params.id,
    agentId: req.params.agentId,
    agentName: target.name,
    startedAt: result.startedAt,
  });

  res.json({
    status: 'stopping',
    agentId: req.params.agentId,
    agentName: target.name,
  });
});

// POST /api/rooms/:id/report — 生成报告（无状态，系统级服务）
roomsRouter.post('/:id/report', async (req, res) => {
  const room = store.get(req.params.id);
  if (!room) {
    warn('room:report:not_found', { roomId: req.params.id });
    return res.status(404).json({ error: 'Room not found' });
  }
  if (isRoomBusy(req.params.id)) {
    warn('room:report:busy', { roomId: req.params.id });
    return res.status(409).json({ code: 'ROOM_BUSY', error: 'Room has an Agent currently executing' });
  }

  const allContent = room.messages
    .map(m => `【${m.agentName}】${m.content}`)
    .join('\n\n');

  if (!allContent.trim()) {
    warn('room:report:empty', { roomId: req.params.id });
    return res.status(400).json({ error: 'No messages to generate report from' });
  }

  // 用第一个 WORKER 作为报告生成的执行者（无状态，系统级角色）
  const worker = room.agents.find(a => a.role === 'WORKER');
  if (!worker) {
    warn('room:report:no_worker', { roomId: req.params.id });
    return res.status(400).json({ error: 'No expert available to generate report' });
  }

  // 同步生成报告（简短操作）
  const reportOutput = await generateReportInline(room.topic, allContent, worker, req.params.id);

  store.update(req.params.id, { state: 'DONE', report: reportOutput });
  roomsRepo.update(req.params.id, { state: 'DONE', report: reportOutput });

  info('room:report', {
    roomId: req.params.id,
    workerId: worker.id,
    workerName: worker.name,
    messageCount: room.messages.length,
    reportLength: reportOutput.length,
  });

  res.json({ summary: reportOutput, actionItems: [] });
});

// PATCH /api/rooms/:id/archive — 归档讨论室（软删除）
roomsRouter.patch('/:id/archive', async (req, res) => {
  const { id } = req.params;
  const room = store.get(id);
  if (!room) {
    warn('room:archive:not_found', { roomId: id });
    return res.status(404).json({ error: 'Room not found' });
  }

  roomsRepo.archive(id);
  store.delete(id);
  await archiveWorkspace(id).catch(() => { }); // workspace 不存在也无妨

  auditRepo.log('room:archive', room.topic, undefined, { roomId: id });
  info('room:archive', { roomId: id, topic: room.topic });
  res.json({ status: 'ok' });
});

// GET /api/rooms/archived — 列出已归档讨论室
roomsRouter.get('/archived', (_req, res) => {
  const archived = roomsRepo.listArchived();
  debug('room:archived:list', { count: archived.length });
  res.json(archived);
});

// POST /api/rooms/:id/agents — 运行时追加 WORKER agent 入群（F007）
roomsRouter.post('/:id/agents', (req, res) => {
  const { id } = req.params;
  const { agentId } = req.body as { agentId?: string };

  const room = store.get(id);
  if (!room) {
    warn('room:agent_add:not_found', { roomId: id });
    return res.status(404).json({ error: 'Room not found' });
  }
  if (room.state === 'DONE') {
    warn('room:agent_add:closed', { roomId: id, agentId });
    return res.status(400).json({ error: 'Room 已结束，无法添加成员' });
  }

  if (!agentId) {
    warn('room:agent_add:invalid', { roomId: id, reason: 'missing_agent_id' });
    return res.status(400).json({ error: 'agentId required' });
  }

  // 已存在校验
  if (room.agents.some(a => a.configId === agentId)) {
    warn('room:agent_add:duplicate', { roomId: id, agentId });
    return res.status(400).json({ error: 'Agent 已在讨论中' });
  }

  const cfg = getAgent(agentId);
  if (!cfg) {
    warn('room:agent_add:agent_not_found', { roomId: id, agentId });
    return res.status(404).json({ error: `Agent not found: ${agentId}` });
  }

  // 角色校验：运行期仅允许追加 WORKER
  if (cfg.role !== 'WORKER') {
    warn('room:agent_add:invalid_role', { roomId: id, agentId, role: cfg.role });
    return res.status(400).json({ error: '仅允许追加 WORKER Agent' });
  }

  // 启用状态校验
  if (!cfg.enabled) {
    warn('room:agent_add:disabled', { roomId: id, agentId });
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

  info('room:agent_add', {
    roomId: id,
    agentId: newAgent.id,
    configId: newAgent.configId,
    agentName: newAgent.name,
    totalAgents: room.agents.length,
  });

  res.json({ room, systemMessage: systemMsg });
});

// DELETE /api/rooms/archived/:id — 彻底删除已归档讨论室
roomsRouter.delete('/archived/:id', (req, res) => {
  const { id } = req.params;
  const archived = roomsRepo.listArchived().find(r => r.id === id);
  if (!archived) {
    warn('room:permanent_delete:not_found', { roomId: id });
    return res.status(404).json({ error: 'Archived room not found' });
  }
  roomsRepo.permanentDelete(id);
  sessionsRepo?.deleteByRoom?.(id);
  auditRepo.log('room:permanent_delete', archived.topic, undefined, { roomId: id });
  info('room:permanent_delete', { roomId: id, topic: archived.topic });
  res.json({ status: 'ok' });
});
