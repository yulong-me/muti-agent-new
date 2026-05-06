/**
 * F015: HTTP-level integration test for POST /api/rooms/:id/messages
 *
 * Uses Node's built-in http module to make real HTTP requests against
 * a real Express server. No supertest needed.
 *
 * P2-fix: If server.listen(0) fails (EPERM/EACCES in restricted envs),
 * all tests in this suite are skipped gracefully rather than hard-failing.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import express from 'express';

// Mock dependencies before importing modules that use them
vi.mock('../src/store.js', () => ({
  store: {
    get: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    list: vi.fn(),
  },
}));

vi.mock('../src/db/index.js', () => ({
  roomsRepo: { create: vi.fn(), update: vi.fn(), listSidebar: vi.fn() },
  agentRunsRepo: {
    listByRoom: vi.fn(),
    getDetail: vi.fn(),
  },
  auditRepo: { log: vi.fn() },
  teamsRepo: {
    list: vi.fn(),
    get: vi.fn(),
    getActiveVersion: vi.fn(),
    getVersion: vi.fn(),
    ensureBuiltinTeams: vi.fn(),
    generateDraftFromGoal: vi.fn(),
    createFromDraft: vi.fn(),
  },
  agentsRepo: { list: vi.fn(), get: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
  evolutionRepo: {
    create: vi.fn(),
    get: vi.fn(),
    listByRoom: vi.fn(),
    latestTargetVersionNumber: vi.fn(),
    setChangeDecision: vi.fn(),
    reject: vi.fn(),
    listValidationCasesForProposal: vi.fn(),
    runPreflight: vi.fn(),
    getTeamQualityTimeline: vi.fn(),
    merge: vi.fn(),
  },
}));

vi.mock('../src/config/agentConfig.js', () => ({
  getAgent: vi.fn(),
}));

vi.mock('../src/config/providerConfig.js', () => ({
  getProvider: vi.fn(),
}));

// isRoomBusy is exported from stateMachine; partial mock to keep it real
vi.mock('../src/services/stateMachine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/stateMachine.js')>();
  return {
    ...actual,
    hostReply: vi.fn(),
    // Must resolve so .catch() in the route handler doesn't throw on undefined
    routeToAgent: vi.fn().mockResolvedValue(undefined),
    generateTitleSuggestionsInline: vi.fn().mockResolvedValue([
      '标题一',
      '标题二',
      '标题三',
      '标题四',
      '标题五',
      '标题六',
      '标题七',
    ]),
    stopAgentRun: vi.fn().mockReturnValue({ stopped: true, agentName: '测试员' }),
  };
});

vi.mock('../src/services/teamDrafts.js', () => ({
  generateTeamDraftFromGoal: vi.fn(),
}));

vi.mock('../src/services/teamEvolution.js', () => ({
  createEvolutionProposalFromRoom: vi.fn(),
}));

import { roomsRouter } from '../src/routes/rooms.js';
import { teamsRouter } from '../src/routes/teams.js';
import { store } from '../src/store.js';
import { agentRunsRepo, roomsRepo, teamsRepo, evolutionRepo } from '../src/db/index.js';
import { generateTeamDraftFromGoal } from '../src/services/teamDrafts.js';
import { createEvolutionProposalFromRoom } from '../src/services/teamEvolution.js';
import { getAgent } from '../src/config/agentConfig.js';
import { getProvider as getProviderConfig } from '../src/config/providerConfig.js';
import { generateTitleSuggestionsInline, stopAgentRun } from '../src/services/stateMachine.js';

// Build a minimal Express app with the rooms router under test
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/rooms', roomsRouter);
  app.use('/api/teams', teamsRouter);
  return app;
}

// P2-fix: one-time port availability check at module level.
// If binding fails (EPERM/EACCES in sandboxed envs), all tests are skipped.
const _probeServer = http.createServer(makeApp());
let _boundPort = 0;

const _bound = await new Promise<boolean>((resolve) => {
  _probeServer.on('error', (err: NodeJS.ErrnoException) => {
    resolve(err.code === 'EACCES' || err.code === 'EPERM' ? false : (() => { throw err; })());
  });
  _probeServer.listen(0, () => {
    const addr = _probeServer.address();
    _boundPort = typeof addr === 'object' && addr !== null ? addr.port : 0;
    _probeServer.close();
    resolve(true);
  });
});

const _skipIfNoPort = _bound ? it : it.skip;

describe('F015: HTTP POST /api/rooms/:id/messages — 409 ROOM_BUSY', () => {
  let server: http.Server;
  let serverPort = 0;

  beforeAll(async () => {
    server = http.createServer(makeApp());
    serverPort = _boundPort;

    // In case port probe was skipped (bound=false), start server anyway and
    // let tests fail with connection-refused; the suite-level skip above is
    // the primary safeguard.
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        serverPort = typeof addr === 'object' && addr !== null ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    const roundtableVersion = {
      id: 'roundtable-forum-v1',
      teamId: 'roundtable-forum',
      versionNumber: 1,
      name: '圆桌论坛',
      memberIds: ['worker-1', 'worker-2', 'worker-3'],
      memberSnapshots: [],
      workflowPrompt: '圆桌',
      routingPolicy: {},
      teamMemory: [],
      maxA2ADepth: 5,
      createdAt: 1,
      createdFrom: 'builtin-seed' as const,
    };
    vi.mocked(teamsRepo.getActiveVersion).mockImplementation((teamId: string) => (
      teamId === 'roundtable-forum' ? roundtableVersion : undefined
    ));
    vi.mocked(teamsRepo.getVersion).mockImplementation((versionId: string) => (
      versionId === 'roundtable-forum-v1' ? roundtableVersion : undefined
    ));
    vi.mocked(getProviderConfig).mockImplementation((name: string) => ({
      name,
      label: name,
      cliPath: process.execPath,
      defaultModel: '',
      contextWindow: 200000,
      apiKey: '',
      baseUrl: '',
      timeout: 1800,
      thinking: true,
      lastTested: null,
      lastTestResult: null,
    }));
  });

  function requestJson(
    method: string,
    path: string,
    body?: object,
  ): Promise<{ status: number; data: Record<string, unknown> }> {
    return new Promise((resolve) => {
      const bodyStr = body ? JSON.stringify(body) : '';
      const options: http.RequestOptions = {
        hostname: '127.0.0.1',
        port: serverPort,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
      };
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          let data: Record<string, unknown> = {};
          try { data = JSON.parse(raw); } catch { /* ignore */ }
          resolve({ status: res.statusCode ?? 0, data });
        });
      });
      req.on('error', (e) => resolve({ status: 0, data: { error: String(e) } }));
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  _skipIfNoPort('preflights selected worker provider CLI availability without creating a room', async () => {
    vi.mocked(getAgent).mockImplementation((id: string) => {
      if (id !== 'litigation-case-mapper') return undefined;
      return {
        id,
        name: '案情梳理官',
        role: 'WORKER',
        roleLabel: '事实链',
        provider: 'opencode',
        providerOpts: { thinking: true },
        systemPrompt: '案情',
        enabled: true,
        tags: ['诉讼策略'],
      };
    });
    vi.mocked(getProviderConfig).mockImplementation((name: string) => ({
      name,
      label: 'OpenCode',
      cliPath: '/definitely/not/an/opencode',
      defaultModel: '',
      contextWindow: 200000,
      apiKey: '',
      baseUrl: '',
      timeout: 1800,
      thinking: true,
      lastTested: null,
      lastTestResult: null,
    }));

    const result = await requestJson('POST', '/api/rooms/preflight', {
      workerIds: ['litigation-case-mapper'],
    });

    expect(result.status).toBe(200);
    expect(result.data).toHaveProperty('ok', false);
    expect(result.data.blockers).toEqual([
      expect.objectContaining({
        type: 'provider_cli_missing',
        provider: 'opencode',
        label: 'OpenCode',
        agentNames: ['案情梳理官'],
      }),
    ]);
    expect(store.create).not.toHaveBeenCalled();
    expect(roomsRepo.create).not.toHaveBeenCalled();
  });

  _skipIfNoPort('returns 409 ROOM_BUSY when agent status is thinking', async () => {
    const mockRoom = {
      id: 'room-busy',
      topic: 'Test',
      state: 'RUNNING' as const,
      agents: [{
        id: 'worker-1',
        role: 'WORKER' as const,
        name: '测试员',
        domainLabel: '测试',
        configId: 'worker-1',
        status: 'thinking' as const,
      }],
      messages: [],
      sessionIds: {},
      a2aDepth: 0,
      a2aCallChain: [],
    };
    vi.mocked(store.get).mockReturnValue(mockRoom);

    const result = await requestJson('POST', '/api/rooms/room-busy/messages', {
      content: '@测试员 hello',
      toAgentId: 'worker-1',
    });

    expect(result.status).toBe(409);
    expect(result.data).toHaveProperty('code', 'ROOM_BUSY');
  });

  _skipIfNoPort('does NOT return 409 when room is idle (status is idle)', async () => {
    const mockRoom = {
      id: 'room-idle',
      topic: 'Test',
      state: 'RUNNING' as const,
      agents: [{
        id: 'worker-1',
        role: 'WORKER' as const,
        name: '测试员',
        domainLabel: '测试',
        configId: 'worker-1',
        status: 'idle' as const,
      }],
      messages: [],
      sessionIds: {},
      a2aDepth: 0,
      a2aCallChain: [],
    };
    vi.mocked(store.get).mockReturnValue(mockRoom);

    const result = await requestJson('POST', '/api/rooms/room-idle/messages', {
      content: '@测试员 hello',
      toAgentId: 'worker-1',
    });

    expect(result.status).toBe(200);
  });

  _skipIfNoPort('returns 404 when room does not exist', async () => {
    vi.mocked(store.get).mockReturnValue(undefined);

    const result = await requestJson('POST', '/api/rooms/nonexistent/messages', {
      content: '@测试员 hello',
      toAgentId: 'worker-1',
    });

    expect(result.status).toBe(404);
  });

  _skipIfNoPort('GET /api/rooms/sidebar exposes activityState instead of treating every open room as busy', async () => {
    vi.mocked(roomsRepo.listSidebar).mockReturnValue([
      {
        id: 'room-busy',
        topic: '忙碌讨论',
        createdAt: 1,
        updatedAt: 3,
        state: 'RUNNING',
        agentCount: 1,
      },
      {
        id: 'room-open',
        topic: '可继续讨论',
        createdAt: 1,
        updatedAt: 2,
        state: 'RUNNING',
        agentCount: 1,
      },
      {
        id: 'room-done',
        topic: '已完成讨论',
        createdAt: 1,
        updatedAt: 1,
        state: 'DONE',
        agentCount: 1,
      },
    ]);
    vi.mocked(store.get).mockImplementation((id: string) => ({
      id,
      topic: id,
      state: id === 'room-done' ? 'DONE' as const : 'RUNNING' as const,
      agents: [{
        id: 'worker-1',
        role: 'WORKER' as const,
        name: '测试员',
        domainLabel: '测试',
        configId: 'worker-1',
        status: id === 'room-busy' ? 'thinking' as const : 'idle' as const,
      }],
      messages: [],
      sessionIds: {},
      a2aDepth: 0,
      a2aCallChain: [],
      teamId: 'roundtable-forum',
      maxA2ADepth: null,
      createdAt: 1,
      updatedAt: 1,
    }));

    const result = await requestJson('GET', '/api/rooms/sidebar');

    expect(result.status).toBe(200);
    expect(result.data).toMatchObject([
      { id: 'room-busy', activityState: 'busy' },
      { id: 'room-open', activityState: 'open' },
      { id: 'room-done', activityState: 'done' },
    ]);
  });

  _skipIfNoPort('GET /api/rooms/:id/runs returns the room execution ledger', async () => {
    vi.mocked(store.get).mockReturnValue({
      id: 'room-runs',
      topic: 'Test',
      state: 'RUNNING' as const,
      agents: [],
      messages: [],
      sessionIds: {},
      a2aDepth: 0,
      a2aCallChain: [],
    });
    vi.mocked(agentRunsRepo.listByRoom).mockReturnValueOnce([
      {
        id: 'run-1',
        roomId: 'room-runs',
        agentInstanceId: 'worker-runtime-1',
        agentConfigId: 'worker-config',
        agentName: '测试员',
        agentRole: 'WORKER',
        provider: 'opencode',
        model: 'gpt-5.5',
        status: 'succeeded',
        startedAt: 1000,
        endedAt: 1200,
        durationMs: 200,
      },
    ]);

    const result = await requestJson('GET', '/api/rooms/room-runs/runs');

    expect(result.status).toBe(200);
    expect(result.data).toEqual({
      runs: [
        expect.objectContaining({
          id: 'run-1',
          roomId: 'room-runs',
          status: 'succeeded',
          agentConfigId: 'worker-config',
        }),
      ],
    });
  });

  _skipIfNoPort('GET /api/rooms/:id/runs/:runId returns run detail and enforces room scope', async () => {
    vi.mocked(store.get).mockImplementation((id: string) => id === 'room-runs'
      ? {
          id: 'room-runs',
          topic: 'Test',
          state: 'RUNNING' as const,
          agents: [],
          messages: [],
          sessionIds: {},
          a2aDepth: 0,
          a2aCallChain: [],
        }
      : undefined);
    vi.mocked(agentRunsRepo.getDetail).mockImplementation((roomId: string, runId: string) => {
      if (roomId !== 'room-runs' || runId !== 'run-1') return undefined;
      return {
        id: 'run-1',
        roomId: 'room-runs',
        agentInstanceId: 'worker-runtime-1',
        agentConfigId: 'worker-config',
        agentName: '测试员',
        agentRole: 'WORKER',
        provider: 'opencode',
        status: 'failed',
        startedAt: 1000,
        endedAt: 1200,
        durationMs: 200,
        error: { code: 'AGENT_PROVIDER_ERROR', message: 'provider failed' },
        triggerMessage: { id: 'trigger-1', content: '请执行' },
        outputMessage: { id: 'output-1', content: '部分输出' },
        sessionTelemetry: { sessionId: 'session-1', measuredAt: 1200 },
      };
    });

    const detail = await requestJson('GET', '/api/rooms/room-runs/runs/run-1');
    const crossRoom = await requestJson('GET', '/api/rooms/room-runs/runs/run-other');
    const missingRoom = await requestJson('GET', '/api/rooms/missing/runs/run-1');

    expect(detail.status).toBe(200);
    expect(detail.data).toMatchObject({
      id: 'run-1',
      status: 'failed',
      error: { code: 'AGENT_PROVIDER_ERROR' },
      triggerMessage: { id: 'trigger-1' },
      outputMessage: { id: 'output-1' },
      sessionTelemetry: { sessionId: 'session-1' },
    });
    expect(crossRoom.status).toBe(404);
    expect(missingRoom.status).toBe(404);
  });

  _skipIfNoPort('stops the currently running agent', async () => {
    const mockRoom = {
      id: 'room-running',
      topic: 'Test',
      state: 'RUNNING' as const,
      agents: [{
        id: 'worker-1',
        role: 'WORKER' as const,
        name: '测试员',
        domainLabel: '测试',
        configId: 'worker-1',
        status: 'thinking' as const,
      }],
      messages: [],
      sessionIds: {},
      a2aDepth: 0,
      a2aCallChain: [],
    };
    vi.mocked(store.get).mockReturnValue(mockRoom);
    vi.mocked(stopAgentRun).mockReturnValueOnce({
      stopped: true,
      agentName: '测试员',
      startedAt: Date.now(),
    });

    const result = await requestJson('POST', '/api/rooms/room-running/agents/worker-1/stop');

    expect(result.status).toBe(200);
    expect(result.data).toHaveProperty('status', 'stopping');
    expect(stopAgentRun).toHaveBeenCalledWith('room-running', 'worker-1');
  });

  _skipIfNoPort('returns 409 when stop is requested for an idle agent', async () => {
    const mockRoom = {
      id: 'room-running',
      topic: 'Test',
      state: 'RUNNING' as const,
      agents: [{
        id: 'worker-1',
        role: 'WORKER' as const,
        name: '测试员',
        domainLabel: '测试',
        configId: 'worker-1',
        status: 'idle' as const,
      }],
      messages: [],
      sessionIds: {},
      a2aDepth: 0,
      a2aCallChain: [],
    };
    vi.mocked(store.get).mockReturnValue(mockRoom);
    vi.mocked(stopAgentRun).mockReturnValueOnce({ stopped: false });

    const result = await requestJson('POST', '/api/rooms/room-running/agents/worker-1/stop');

    expect(result.status).toBe(409);
    expect(result.data).toHaveProperty('error', 'Agent is not currently running');
  });

  _skipIfNoPort('does not expose a report generation endpoint', async () => {
    const result = await requestJson('POST', '/api/rooms/room-running/report');

    expect(result.status).toBe(404);
  });

  _skipIfNoPort('preserves the user-provided topic when creating a room', async () => {
    vi.mocked(teamsRepo.getActiveVersion).mockImplementation((teamId: string) => teamId === 'software-development' ? {
      id: 'software-development-v1',
      teamId: 'software-development',
      versionNumber: 1,
      name: '软件开发',
      memberIds: [],
      memberSnapshots: [],
      workflowPrompt: '软件开发团队',
      routingPolicy: {},
      teamMemory: [],
      maxA2ADepth: 5,
      createdAt: 1,
      createdFrom: 'builtin-seed',
    } : undefined);
    const coreAgents = new Map([
      ['dev-architect', { id: 'dev-architect', name: '主架构师', role: 'WORKER', roleLabel: '方案设计', provider: 'claude-code', providerOpts: { thinking: true }, systemPrompt: '你是主架构师', enabled: true, tags: ['dev'] }],
      ['dev-challenge-architect', { id: 'dev-challenge-architect', name: '挑战架构师', role: 'WORKER', roleLabel: '方案质疑', provider: 'claude-code', providerOpts: { thinking: true }, systemPrompt: '你是挑战架构师', enabled: true, tags: ['dev'] }],
      ['dev-implementer', { id: 'dev-implementer', name: '实现工程师', role: 'WORKER', roleLabel: '代码实现', provider: 'claude-code', providerOpts: { thinking: true }, systemPrompt: '你是实现工程师', enabled: true, tags: ['dev'] }],
      ['dev-reviewer', { id: 'dev-reviewer', name: 'Reviewer', role: 'WORKER', roleLabel: '代码审查', provider: 'claude-code', providerOpts: { thinking: true }, systemPrompt: '你是 Reviewer', enabled: true, tags: ['dev'] }],
    ]);
    vi.mocked(getAgent).mockImplementation((id: string) => coreAgents.get(id));

    const missingCoreResult = await requestJson('POST', '/api/rooms', {
      topic: '实现登录态持久化',
      workerIds: ['dev-architect', 'dev-implementer', 'dev-reviewer'],
      teamId: 'software-development',
    });

    expect(missingCoreResult.status).toBe(400);
    expect(missingCoreResult.data).toHaveProperty(
      'error',
      '软件开发团队必须包含 4 位核心专家：主架构师、挑战架构师、实现工程师、Reviewer。当前缺少：挑战架构师',
    );

    const result = await requestJson('POST', '/api/rooms', {
      topic: '  实现登录态持久化  ',
      workerIds: ['dev-architect', 'dev-challenge-architect', 'dev-implementer', 'dev-reviewer'],
      teamId: 'software-development',
    });

    expect(result.status).toBe(200);
    expect(result.data).toHaveProperty('topic', '实现登录态持久化');
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({
      topic: '实现登录态持久化',
      teamId: 'software-development',
    }));
    expect(roomsRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      topic: '实现登录态持久化',
      teamId: 'software-development',
    }));
  });

  _skipIfNoPort('POST /api/rooms accepts teamId, resolves active TeamVersion, and defaults workers from the version', async () => {
    vi.mocked(teamsRepo.getActiveVersion).mockReturnValue({
      id: 'custom-team-v1',
      teamId: 'custom-team',
      versionNumber: 1,
      name: '自定义团队',
      memberIds: ['worker-1'],
      workflowPrompt: 'team workflow',
      routingPolicy: {},
      teamMemory: [],
      maxA2ADepth: 5,
      createdAt: 1,
      createdFrom: 'builtin-seed',
    });
    vi.mocked(getAgent).mockImplementation((id: string) => {
      if (id !== 'worker-1') return undefined;
      return {
        id,
        name: '测试员',
        role: 'WORKER',
        roleLabel: '测试',
        provider: 'claude-code',
        providerOpts: { thinking: true },
        systemPrompt: '你是测试员',
        enabled: true,
        tags: ['自定义团队'],
      };
    });

    const result = await requestJson('POST', '/api/rooms', {
      topic: 'Team room',
      teamId: 'custom-team',
    });

    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({
      topic: 'Team room',
      teamId: 'custom-team',
      teamVersionId: 'custom-team-v1',
      teamName: '自定义团队',
      teamVersionNumber: 1,
    });
    expect(roomsRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'custom-team',
      teamVersionId: 'custom-team-v1',
    }));
  });

  _skipIfNoPort('POST /api/rooms accepts teamVersionId before teamId and pins that exact version', async () => {
    vi.mocked(teamsRepo.get).mockReturnValue({
      id: 'custom-team',
      name: '自定义团队',
      builtin: false,
      activeVersionId: 'custom-team-v1',
      createdAt: 1,
      updatedAt: 1,
    });
    vi.mocked(teamsRepo.getVersion).mockReturnValue({
      id: 'custom-team-v2',
      teamId: 'custom-team',
      versionNumber: 2,
      name: '自定义团队',
      memberIds: ['worker-2'],
      workflowPrompt: 'team workflow v2',
      routingPolicy: {},
      teamMemory: [],
      maxA2ADepth: 5,
      createdAt: 2,
      createdFrom: 'manual',
    });
    vi.mocked(getAgent).mockImplementation((id: string) => {
      if (id !== 'worker-2') return undefined;
      return {
        id,
        name: '测试员二',
        role: 'WORKER',
        roleLabel: '测试',
        provider: 'claude-code',
        providerOpts: { thinking: true },
        systemPrompt: '你是测试员二',
        enabled: true,
        tags: ['自定义团队'],
      };
    });

    const result = await requestJson('POST', '/api/rooms', {
      topic: 'Pinned team room',
      teamId: 'custom-team',
      teamVersionId: 'custom-team-v2',
    });

    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({
      teamId: 'custom-team',
      teamVersionId: 'custom-team-v2',
      teamVersionNumber: 2,
    });
    expect(teamsRepo.getActiveVersion).not.toHaveBeenCalled();
  });

  _skipIfNoPort('PATCH /api/rooms/:id returns TeamVersion effective depth when clearing room override', async () => {
    vi.mocked(store.get).mockReturnValue({
      id: 'room-depth',
      topic: 'Test',
      state: 'RUNNING' as const,
      agents: [],
      messages: [],
      sessionIds: {},
      a2aDepth: 2,
      a2aCallChain: [],
      teamId: 'software-development',
      teamVersionId: 'software-development-v1',
      maxA2ADepth: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    vi.mocked(roomsRepo.update).mockReturnValue({
      id: 'room-depth',
      topic: 'Test',
      state: 'RUNNING' as const,
      agents: [],
      messages: [],
      sessionIds: {},
      a2aDepth: 2,
      a2aCallChain: [],
      teamId: 'software-development',
      teamVersionId: 'software-development-v1',
      maxA2ADepth: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    vi.mocked(teamsRepo.getVersion).mockReturnValue({
      id: 'software-development-v1',
      teamId: 'software-development',
      versionNumber: 1,
      name: '软件开发',
      memberIds: [],
      memberSnapshots: [],
      workflowPrompt: '软件开发团队',
      routingPolicy: {},
      teamMemory: [],
      maxA2ADepth: 10,
      createdAt: 1,
      createdFrom: 'builtin-seed',
    });

    const result = await requestJson('PATCH', '/api/rooms/room-depth', {
      maxA2ADepth: null,
    });

    expect(result.status).toBe(200);
    expect(result.data).toHaveProperty('maxA2ADepth', null);
    expect(result.data).toHaveProperty('effectiveMaxDepth', 10);
    expect(store.update).toHaveBeenCalledWith('room-depth', expect.objectContaining({
      maxA2ADepth: null,
    }));
  });

  _skipIfNoPort('POST /api/rooms/:id/evolution-proposals creates a pending proposal for the pinned TeamVersion', async () => {
    vi.mocked(store.get).mockReturnValue({
      id: 'room-team',
      topic: 'Team run',
      state: 'RUNNING' as const,
      agents: [{
        id: 'agent-runtime-1',
        role: 'WORKER' as const,
        name: 'Reviewer',
        domainLabel: '审查',
        configId: 'reviewer',
        status: 'idle' as const,
      }],
      messages: [{
        id: 'msg-1',
        agentRole: 'USER' as const,
        agentName: '你',
        content: 'Reviewer 没有验证代码，我不满意',
        timestamp: 1,
        type: 'user_action' as const,
      }],
      sessionIds: {},
      a2aDepth: 0,
      a2aCallChain: [],
      teamId: 'software-development',
      teamId: 'software-development',
      teamVersionId: 'software-development-v1',
      teamName: '软件开发团队',
      teamVersionNumber: 1,
      maxA2ADepth: null,
      createdAt: 1,
      updatedAt: 1,
    });
    vi.mocked(teamsRepo.getVersion).mockReturnValue({
      id: 'software-development-v1',
      teamId: 'software-development',
      versionNumber: 1,
      name: '软件开发团队',
      memberIds: ['reviewer'],
      memberSnapshots: [{
        id: 'reviewer',
        name: 'Reviewer',
        roleLabel: '审查',
        provider: 'claude-code',
        providerOpts: {},
        systemPrompt: '旧 reviewer prompt',
      }],
      workflowPrompt: '旧工作流',
      routingPolicy: {},
      teamMemory: [],
      maxA2ADepth: 5,
      createdAt: 1,
      createdFrom: 'builtin-seed',
    });
    vi.mocked(evolutionRepo.latestTargetVersionNumber).mockReturnValue(2);
    const proposal = {
      id: 'evo-1',
      roomId: 'room-team',
      teamId: 'software-development',
      baseVersionId: 'software-development-v1',
      targetVersionNumber: 2,
      status: 'pending',
      summary: 'Team Architect 根据本次讨论生成 2 项进化建议。',
      feedback: 'Reviewer 没有验证代码',
      createdAt: 1,
      updatedAt: 1,
      changes: [
        {
          id: 'change-0',
          proposalId: 'evo-1',
          ordinal: 0,
          kind: 'edit-agent-prompt',
          title: '强化 Reviewer 验证职责',
          why: '用户反馈 Reviewer 没有验证代码。',
          evidenceMessageIds: ['msg-1'],
          targetLayer: 'member-prompt',
          before: '旧 reviewer prompt',
          after: { agentId: 'reviewer', systemPrompt: '新 reviewer prompt，必须给出验证证据。' },
          impact: '后续新房间会要求 Reviewer 明确验证证据。',
        },
      ],
    } as const;
    vi.mocked(createEvolutionProposalFromRoom).mockResolvedValueOnce(proposal);
    vi.mocked(evolutionRepo.create).mockImplementation(input => ({
      id: 'evo-1',
      roomId: input.roomId,
      teamId: input.teamId,
      baseVersionId: input.baseVersionId,
      targetVersionNumber: input.targetVersionNumber,
      status: 'pending',
      summary: input.summary,
      feedback: input.feedback,
      createdAt: 1,
      updatedAt: 1,
      changes: input.changes.map((change, index) => ({
        ...change,
        id: `change-${index}`,
        proposalId: 'evo-1',
        ordinal: index,
      })),
    }));

    const result = await requestJson('POST', '/api/rooms/room-team/evolution-proposals', {
      feedback: 'Reviewer 没有验证代码',
    });

    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({
      id: 'evo-1',
      roomId: 'room-team',
      teamId: 'software-development',
      baseVersionId: 'software-development-v1',
      targetVersionNumber: 2,
      status: 'pending',
    });
    expect(createEvolutionProposalFromRoom).toHaveBeenCalledWith(expect.objectContaining({ id: 'room-team' }), 'Reviewer 没有验证代码');
  });

  _skipIfNoPort('POST /api/rooms/:id/evolution-proposals returns 503 when Team Architect cannot generate a valid proposal', async () => {
    vi.mocked(store.get).mockReturnValue({
      id: 'room-team',
      topic: 'Team run',
      state: 'RUNNING' as const,
      agents: [],
      messages: [{
        id: 'msg-1',
        agentRole: 'USER' as const,
        agentName: '你',
        content: 'Reviewer 没有验证代码，我不满意',
        timestamp: 1,
        type: 'user_action' as const,
      }],
      sessionIds: {},
      a2aDepth: 0,
      a2aCallChain: [],
      teamId: 'software-development',
      teamId: 'software-development',
      teamVersionId: 'software-development-v1',
      teamName: '软件开发团队',
      teamVersionNumber: 1,
      maxA2ADepth: null,
      createdAt: 1,
      updatedAt: 1,
    });
    vi.mocked(createEvolutionProposalFromRoom).mockRejectedValueOnce(Object.assign(
      new Error('生成 Team 改进提案失败，请补充改进意见后重试'),
      { code: 'EVOLUTION_PROPOSAL_AGENT_FAILED' },
    ));

    const result = await requestJson('POST', '/api/rooms/room-team/evolution-proposals', {
      feedback: 'Reviewer 没有验证代码',
    });

    expect(result.status).toBe(503);
    expect(result.data).toMatchObject({
      code: 'EVOLUTION_PROPOSAL_AGENT_FAILED',
      error: '生成 Team 改进提案失败，请补充改进意见后重试',
    });
  });

  _skipIfNoPort('POST /api/rooms/:id/evolution-proposals returns 409 ROOM_BUSY during an active run', async () => {
    vi.mocked(store.get).mockReturnValue({
      id: 'room-team-busy',
      topic: 'Team run',
      state: 'RUNNING' as const,
      agents: [{
        id: 'agent-runtime-1',
        role: 'WORKER' as const,
        name: 'Reviewer',
        domainLabel: '审查',
        configId: 'reviewer',
        status: 'thinking' as const,
      }],
      messages: [{
        id: 'msg-1',
        agentRole: 'USER' as const,
        agentName: '你',
        content: 'Reviewer 还没跑完',
        timestamp: 1,
        type: 'user_action' as const,
      }],
      sessionIds: {},
      a2aDepth: 0,
      a2aCallChain: [],
      teamId: 'software-development',
      teamId: 'software-development',
      teamVersionId: 'software-development-v1',
      teamName: '软件开发团队',
      teamVersionNumber: 1,
      maxA2ADepth: null,
      createdAt: 1,
      updatedAt: 1,
    });

    const result = await requestJson('POST', '/api/rooms/room-team-busy/evolution-proposals', {
      feedback: '不要从未完成 transcript 生成 EVO PR',
    });

    expect(result.status).toBe(409);
    expect(result.data).toHaveProperty('code', 'ROOM_BUSY');
    expect(evolutionRepo.create).not.toHaveBeenCalled();
  });

  _skipIfNoPort('POST /api/rooms/:id/evolution-proposals can replace a disliked pending proposal with new feedback', async () => {
    vi.mocked(store.get).mockReturnValue({
      id: 'room-team',
      topic: 'Team run',
      state: 'RUNNING' as const,
      agents: [],
      messages: [{
        id: 'msg-1',
        agentRole: 'USER' as const,
        agentName: '你',
        content: '旧提案没有解决验证问题',
        timestamp: 1,
        type: 'user_action' as const,
      }],
      sessionIds: {},
      a2aDepth: 0,
      a2aCallChain: [],
      teamId: 'software-development',
      teamId: 'software-development',
      teamVersionId: 'software-development-v1',
      teamName: '软件开发团队',
      teamVersionNumber: 1,
      maxA2ADepth: null,
      createdAt: 1,
      updatedAt: 1,
    });
    vi.mocked(evolutionRepo.get).mockReturnValue({
      id: 'evo-old',
      roomId: 'room-team',
      teamId: 'software-development',
      baseVersionId: 'software-development-v1',
      targetVersionNumber: 2,
      status: 'pending',
      summary: '旧提案',
      createdAt: 1,
      updatedAt: 1,
      changes: [],
    });
    vi.mocked(evolutionRepo.reject).mockReturnValue({
      id: 'evo-old',
      roomId: 'room-team',
      teamId: 'software-development',
      baseVersionId: 'software-development-v1',
      targetVersionNumber: 2,
      status: 'rejected',
      summary: '旧提案',
      createdAt: 1,
      updatedAt: 2,
      changes: [],
    });
    const regeneratedProposal = {
      id: 'evo-new',
      roomId: 'room-team',
      teamId: 'software-development',
      baseVersionId: 'software-development-v1',
      targetVersionNumber: 2,
      status: 'pending',
      summary: '按补充意见重新生成',
      feedback: '请不要只加记忆，要修改 Reviewer prompt',
      createdAt: 3,
      updatedAt: 3,
      changes: [],
    } as const;
    vi.mocked(createEvolutionProposalFromRoom).mockResolvedValueOnce(regeneratedProposal);

    const result = await requestJson('POST', '/api/rooms/room-team/evolution-proposals', {
      feedback: '请不要只加记忆，要修改 Reviewer prompt',
      replacesProposalId: 'evo-old',
    });

    expect(result.status).toBe(200);
    expect(evolutionRepo.get).toHaveBeenCalledWith('evo-old');
    expect(evolutionRepo.reject).not.toHaveBeenCalled();
    expect(createEvolutionProposalFromRoom).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'room-team' }),
      '请不要只加记忆，要修改 Reviewer prompt',
      { replacesProposalId: 'evo-old' },
    );
    expect(result.data).toMatchObject({ id: 'evo-new', status: 'pending', feedback: '请不要只加记忆，要修改 Reviewer prompt' });
  });

  _skipIfNoPort('POST /api/rooms/:id/evolution-proposals returns 409 without generation when replaced proposal is terminal', async () => {
    vi.mocked(store.get).mockReturnValue({
      id: 'room-team',
      topic: 'Team run',
      state: 'RUNNING' as const,
      agents: [],
      messages: [{
        id: 'msg-1',
        agentRole: 'USER' as const,
        agentName: '你',
        content: '旧提案已经合并了',
        timestamp: 1,
        type: 'user_action' as const,
      }],
      sessionIds: {},
      a2aDepth: 0,
      a2aCallChain: [],
      teamId: 'software-development',
      teamId: 'software-development',
      teamVersionId: 'software-development-v1',
      teamName: '软件开发团队',
      teamVersionNumber: 1,
      maxA2ADepth: null,
      createdAt: 1,
      updatedAt: 1,
    });
    vi.mocked(evolutionRepo.get).mockReturnValue({
      id: 'evo-old',
      roomId: 'room-team',
      teamId: 'software-development',
      baseVersionId: 'software-development-v1',
      targetVersionNumber: 2,
      status: 'applied',
      summary: '已应用提案',
      createdAt: 1,
      updatedAt: 2,
      changes: [],
    });

    const result = await requestJson('POST', '/api/rooms/room-team/evolution-proposals', {
      feedback: '请重新生成',
      replacesProposalId: 'evo-old',
    });

    expect(result.status).toBe(409);
    expect(result.data).toMatchObject({
      code: 'EVOLUTION_PROPOSAL_STATE_CONFLICT',
      error: 'Cannot replace applied proposal',
    });
    expect(createEvolutionProposalFromRoom).not.toHaveBeenCalled();
    expect(evolutionRepo.create).not.toHaveBeenCalled();
    expect(evolutionRepo.reject).not.toHaveBeenCalled();
  });

  _skipIfNoPort('POST /api/rooms/:id/evolution-proposals keeps replaced proposal pending when regeneration fails', async () => {
    vi.mocked(store.get).mockReturnValue({
      id: 'room-team',
      topic: 'Team run',
      state: 'RUNNING' as const,
      agents: [],
      messages: [{
        id: 'msg-1',
        agentRole: 'USER' as const,
        agentName: '你',
        content: '旧提案没有解决验证问题',
        timestamp: 1,
        type: 'user_action' as const,
      }],
      sessionIds: {},
      a2aDepth: 0,
      a2aCallChain: [],
      teamId: 'software-development',
      teamId: 'software-development',
      teamVersionId: 'software-development-v1',
      teamName: '软件开发团队',
      teamVersionNumber: 1,
      maxA2ADepth: null,
      createdAt: 1,
      updatedAt: 1,
    });
    vi.mocked(evolutionRepo.get).mockReturnValue({
      id: 'evo-old',
      roomId: 'room-team',
      teamId: 'software-development',
      baseVersionId: 'software-development-v1',
      targetVersionNumber: 2,
      status: 'pending',
      summary: '旧提案',
      createdAt: 1,
      updatedAt: 1,
      changes: [],
    });
    vi.mocked(createEvolutionProposalFromRoom).mockRejectedValueOnce(Object.assign(
      new Error('生成 Team 改进提案失败，请补充改进意见后重试'),
      { code: 'EVOLUTION_PROPOSAL_AGENT_FAILED' },
    ));

    const result = await requestJson('POST', '/api/rooms/room-team/evolution-proposals', {
      feedback: '请重新生成',
      replacesProposalId: 'evo-old',
    });

    expect(result.status).toBe(503);
    expect(evolutionRepo.get).toHaveBeenCalledWith('evo-old');
    expect(evolutionRepo.reject).not.toHaveBeenCalled();
  });

  _skipIfNoPort('POST /api/rooms/:id/evolution-proposals rejects rooms without pinned TeamVersion', async () => {
    vi.mocked(store.get).mockReturnValue({
      id: 'room-without-version',
      topic: 'Team room without pinned version',
      state: 'RUNNING' as const,
      agents: [],
      messages: [],
      sessionIds: {},
      a2aDepth: 0,
      a2aCallChain: [],
      teamId: 'roundtable-forum',
      maxA2ADepth: null,
      createdAt: 1,
      updatedAt: 1,
    });
    vi.mocked(createEvolutionProposalFromRoom).mockRejectedValueOnce(
      new Error('Team-backed room required for evolution proposals'),
    );

    const result = await requestJson('POST', '/api/rooms/room-without-version/evolution-proposals', {});

    expect(result.status).toBe(400);
    expect(result.data).toHaveProperty('error', 'Team-backed room required for evolution proposals');
  });

  _skipIfNoPort('PATCH /api/teams/evolution-proposals/:proposalId/changes/:changeId persists a decision', async () => {
    vi.mocked(evolutionRepo.setChangeDecision).mockReturnValue({
      id: 'evo-1',
      roomId: 'room-team',
      teamId: 'software-development',
      baseVersionId: 'software-development-v1',
      targetVersionNumber: 2,
      status: 'in-review',
      summary: '建议强化验证',
      createdAt: 1,
      updatedAt: 2,
      changes: [{
        id: 'change-1',
        proposalId: 'evo-1',
        ordinal: 0,
        kind: 'edit-team-workflow',
        title: '增加验证阶段',
        why: '流程缺验证',
        evidenceMessageIds: ['msg-1'],
        targetLayer: 'workflow',
        before: '旧工作流',
        after: '新工作流',
        impact: '新房间生效',
        decision: 'accepted',
        decidedAt: 2,
      }],
    });

    const result = await requestJson('PATCH', '/api/teams/evolution-proposals/evo-1/changes/change-1', {
      decision: 'accepted',
    });

    expect(result.status).toBe(200);
    expect(evolutionRepo.setChangeDecision).toHaveBeenCalledWith('evo-1', 'change-1', 'accepted');
    expect(result.data).toMatchObject({ id: 'evo-1', status: 'in-review' });
  });

  _skipIfNoPort('PATCH /api/teams/evolution-proposals/:proposalId/changes/:changeId returns 404 for missing proposal or change', async () => {
    vi.mocked(evolutionRepo.setChangeDecision).mockImplementation(() => {
      throw Object.assign(new Error('Evolution change not found: change-missing'), {
        code: 'EVOLUTION_CHANGE_NOT_FOUND',
      });
    });

    const result = await requestJson('PATCH', '/api/teams/evolution-proposals/evo-1/changes/change-missing', {
      decision: 'accepted',
    });

    expect(result.status).toBe(404);
    expect(result.data).toHaveProperty('code', 'EVOLUTION_CHANGE_NOT_FOUND');
  });

  _skipIfNoPort('PATCH /api/teams/evolution-proposals/:proposalId/changes/:changeId returns 409 for stale proposal state', async () => {
    vi.mocked(evolutionRepo.setChangeDecision).mockImplementation(() => {
      throw Object.assign(new Error('Cannot decide change for applied proposal'), {
        code: 'EVOLUTION_PROPOSAL_STATE_CONFLICT',
      });
    });

    const result = await requestJson('PATCH', '/api/teams/evolution-proposals/evo-1/changes/change-1', {
      decision: 'accepted',
    });

    expect(result.status).toBe(409);
    expect(result.data).toHaveProperty('code', 'EVOLUTION_PROPOSAL_STATE_CONFLICT');
  });

  _skipIfNoPort('POST /api/teams/evolution-proposals/:proposalId/reject abandons a pending proposal', async () => {
    vi.mocked(evolutionRepo.reject).mockReturnValue({
      id: 'evo-1',
      roomId: 'room-team',
      teamId: 'software-development',
      baseVersionId: 'software-development-v1',
      targetVersionNumber: 2,
      status: 'rejected',
      summary: '不满意的提案',
      createdAt: 1,
      updatedAt: 2,
      changes: [],
    });

    const result = await requestJson('POST', '/api/teams/evolution-proposals/evo-1/reject');

    expect(result.status).toBe(200);
    expect(evolutionRepo.reject).toHaveBeenCalledWith('evo-1');
    expect(result.data).toMatchObject({ id: 'evo-1', status: 'rejected' });
  });

  _skipIfNoPort('POST /api/teams/evolution-proposals/:proposalId/merge returns the new TeamVersion when accepted changes exist', async () => {
    vi.mocked(evolutionRepo.merge).mockReturnValue({
      proposal: {
        id: 'evo-1',
        roomId: 'room-team',
        teamId: 'software-development',
        baseVersionId: 'software-development-v1',
        targetVersionNumber: 2,
        status: 'applied',
        summary: '建议强化验证',
        createdAt: 1,
        updatedAt: 2,
        appliedVersionId: 'software-development-v2',
        changes: [],
      },
      version: {
        id: 'software-development-v2',
        teamId: 'software-development',
        versionNumber: 2,
        name: '软件开发团队',
        memberIds: ['reviewer'],
        memberSnapshots: [],
        workflowPrompt: '新工作流',
        routingPolicy: {},
        teamMemory: [],
        maxA2ADepth: 5,
        createdAt: 2,
        createdFrom: 'evolution-pr',
      },
    });

    const result = await requestJson('POST', '/api/teams/evolution-proposals/evo-1/merge');

    expect(result.status).toBe(200);
    expect(evolutionRepo.merge).toHaveBeenCalledWith('evo-1', { confirmFailedValidation: false });
    expect(result.data).toMatchObject({
      proposal: { id: 'evo-1', status: 'applied', appliedVersionId: 'software-development-v2' },
      version: { id: 'software-development-v2', versionNumber: 2 },
    });
  });

  _skipIfNoPort('GET /api/teams/evolution-proposals/:proposalId/validation-cases returns related cases', async () => {
    vi.mocked(evolutionRepo.listValidationCasesForProposal).mockReturnValue([
      {
        id: 'case-1',
        teamId: 'software-development',
        sourceRoomId: 'room-team',
        sourceProposalId: 'evo-1',
        sourceChangeId: 'change-1',
        baseVersionId: 'software-development-v1',
        createdVersionId: 'software-development-v2',
        failureSummary: 'Reviewer 缺少验证证据',
        inputSnapshot: { prompt: '完成后直接交付' },
        expectedBehavior: '必须给出验证证据',
        assertionType: 'checklist',
        createdFromChangeId: 'change-1',
        status: 'active',
        evidenceMessageIds: ['msg-1'],
        createdAt: 1,
      },
    ]);

    const result = await requestJson('GET', '/api/teams/evolution-proposals/evo-1/validation-cases');

    expect(result.status).toBe(200);
    expect(evolutionRepo.listValidationCasesForProposal).toHaveBeenCalledWith('evo-1');
    expect(result.data).toMatchObject([{ id: 'case-1', expectedBehavior: '必须给出验证证据' }]);
  });

  _skipIfNoPort('POST /api/teams/evolution-proposals/:proposalId/preflight persists and returns validation results', async () => {
    vi.mocked(evolutionRepo.runPreflight).mockReturnValue({
      proposalId: 'evo-1',
      targetVersionId: 'software-development-v2',
      summary: { pass: 0, fail: 1, needsReview: 0 },
      results: [{
        id: 'run-1',
        proposalId: 'evo-1',
        validationCaseId: 'case-1',
        targetVersionId: 'software-development-v2',
        result: 'fail',
        reason: 'Draft TeamVersion does not contain expected behavior',
        checkedAt: 2,
      }],
    });

    const result = await requestJson('POST', '/api/teams/evolution-proposals/evo-1/preflight');

    expect(result.status).toBe(200);
    expect(evolutionRepo.runPreflight).toHaveBeenCalledWith('evo-1');
    expect(result.data).toMatchObject({ summary: { fail: 1 }, results: [{ result: 'fail' }] });
  });

  _skipIfNoPort('POST /api/teams/evolution-proposals/:proposalId/merge forwards failed validation confirmation', async () => {
    vi.mocked(evolutionRepo.merge).mockReturnValue({
      proposal: {
        id: 'evo-1',
        roomId: 'room-team',
        teamId: 'software-development',
        baseVersionId: 'software-development-v1',
        targetVersionNumber: 2,
        status: 'applied',
        summary: '建议强化验证',
        createdAt: 1,
        updatedAt: 2,
        appliedVersionId: 'software-development-v2',
        changes: [],
      },
    });

    const result = await requestJson('POST', '/api/teams/evolution-proposals/evo-1/merge', {
      confirmFailedValidation: true,
    });

    expect(result.status).toBe(200);
    expect(evolutionRepo.merge).toHaveBeenCalledWith('evo-1', { confirmFailedValidation: true });
  });

  _skipIfNoPort('GET /api/teams/:id/quality-timeline returns version validation evidence', async () => {
    vi.mocked(teamsRepo.get).mockReturnValue({
      id: 'software-development',
      name: '软件开发团队',
      builtin: true,
      activeVersionId: 'software-development-v2',
      createdAt: 1,
      updatedAt: 2,
    });
    vi.mocked(evolutionRepo.getTeamQualityTimeline).mockReturnValue([
      {
        versionId: 'software-development-v2',
        versionNumber: 2,
        createdAt: 2,
        createdFrom: 'evolution-pr',
        sourceProposalId: 'evo-1',
        acceptedChangeCount: 2,
        addedValidationCaseCount: 1,
        preflightSummary: { pass: 1, fail: 0, needsReview: 0 },
        validationCases: [],
        rollbackEvidence: {
          comparedToVersionId: 'software-development-v2',
          validationCasesAddedAfterThisVersion: 0,
          failingPreflightsAfterThisVersion: 0,
        },
      },
    ]);

    const result = await requestJson('GET', '/api/teams/software-development/quality-timeline');

    expect(result.status).toBe(200);
    expect(evolutionRepo.getTeamQualityTimeline).toHaveBeenCalledWith('software-development');
    expect(result.data).toMatchObject([{ versionId: 'software-development-v2', preflightSummary: { pass: 1 } }]);
  });

  _skipIfNoPort('POST /api/teams/evolution-proposals/:proposalId/merge returns 404 for a missing proposal', async () => {
    vi.mocked(evolutionRepo.merge).mockImplementation(() => {
      throw Object.assign(new Error('Evolution proposal not found: evo-missing'), {
        code: 'EVOLUTION_PROPOSAL_NOT_FOUND',
      });
    });

    const result = await requestJson('POST', '/api/teams/evolution-proposals/evo-missing/merge');

    expect(result.status).toBe(404);
    expect(result.data).toHaveProperty('code', 'EVOLUTION_PROPOSAL_NOT_FOUND');
  });

  _skipIfNoPort('POST /api/teams/evolution-proposals/:proposalId/merge returns 409 for merge conflicts', async () => {
    vi.mocked(evolutionRepo.merge).mockImplementation(() => {
      throw Object.assign(new Error('Target TeamVersion already exists: software-development-v2'), {
        code: 'EVOLUTION_TARGET_VERSION_EXISTS',
      });
    });

    const result = await requestJson('POST', '/api/teams/evolution-proposals/evo-1/merge');

    expect(result.status).toBe(409);
    expect(result.data).toHaveProperty('code', 'EVOLUTION_TARGET_VERSION_EXISTS');
  });

  _skipIfNoPort('POST /api/teams/drafts returns a reviewed TeamDraft without creating a Team', async () => {
    vi.mocked(generateTeamDraftFromGoal).mockResolvedValue({
      name: '软件交付团队',
      mission: '交付可验证的软件功能',
      members: [
        {
          displayName: '产品澄清员',
          role: '需求澄清',
          responsibility: '收敛目标和验收标准',
          systemPrompt: '你负责需求澄清，遇到范围变化必须请求用户确认。',
          whenToUse: '需求不清晰时',
        },
        {
          displayName: '实现工程师',
          role: '实现',
          responsibility: '修改代码并运行验证',
          systemPrompt: '你负责实现和验证证据。',
          whenToUse: '方案确认后',
        },
        {
          displayName: 'Reviewer',
          role: '审查',
          responsibility: '检查回归风险',
          systemPrompt: '你负责 review。',
          whenToUse: '交付前',
        },
      ],
      workflow: '澄清 → 实现 → 验证',
      teamProtocol: '关键范围变化需要用户确认。',
      routingPolicy: { rules: [{ when: '需要实现', memberRole: '实现' }] },
      teamMemory: ['必须保留验证证据'],
      validationCases: [{
        title: '验证证据',
        failureSummary: '交付缺少验证',
        inputSnapshot: { goal: '实现功能' },
        expectedBehavior: '最终汇报包含验证命令和结果',
        assertionType: 'checklist',
      }],
      generationRationale: '根据目标选择软件交付角色。',
      generationSource: 'agent',
    });

    const result = await requestJson('POST', '/api/teams/drafts', {
      goal: '帮我做一个软件功能，从需求澄清、方案设计、实现、review 到验收',
    });

    expect(result.status).toBe(200);
    expect(generateTeamDraftFromGoal).toHaveBeenCalledWith('帮我做一个软件功能，从需求澄清、方案设计、实现、review 到验收');
    expect(teamsRepo.createFromDraft).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ name: '软件交付团队', generationRationale: '根据目标选择软件交付角色。', generationSource: 'agent' });
  });

  _skipIfNoPort('POST /api/teams/drafts returns retryable error when Team Architect generation fails', async () => {
    vi.mocked(generateTeamDraftFromGoal).mockImplementation(() => {
      throw Object.assign(new Error('生成 Team 方案失败，请重试'), {
        code: 'TEAM_DRAFT_AGENT_FAILED',
      });
    });

    const result = await requestJson('POST', '/api/teams/drafts', {
      goal: '帮我做一个软件功能，从需求澄清、方案设计、实现、review 到验收',
    });

    expect(result.status).toBe(503);
    expect(teamsRepo.createFromDraft).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      code: 'TEAM_DRAFT_AGENT_FAILED',
      error: '生成 Team 方案失败，请重试',
    });
  });

  _skipIfNoPort('POST /api/teams/drafts returns actionable errors for vague goals', async () => {
    vi.mocked(generateTeamDraftFromGoal).mockImplementation(() => {
      throw Object.assign(new Error('请补充目标、交付物和边界后再生成 Team 方案'), {
        code: 'TEAM_GOAL_TOO_VAGUE',
      });
    });

    const result = await requestJson('POST', '/api/teams/drafts', { goal: '做事' });

    expect(result.status).toBe(400);
    expect(result.data).toMatchObject({
      code: 'TEAM_GOAL_TOO_VAGUE',
      error: '请补充目标、交付物和边界后再生成 Team 方案',
    });
    expect(teamsRepo.createFromDraft).not.toHaveBeenCalled();
  });

  _skipIfNoPort('POST /api/teams creates Team v1 from a reviewed draft', async () => {
    vi.mocked(teamsRepo.createFromDraft).mockReturnValue({
      team: {
        id: 'custom-team',
        name: '我的功能交付 Team',
        builtin: false,
        activeVersionId: 'custom-team-v1',
        createdAt: 1,
        updatedAt: 1,
      },
      version: {
        id: 'custom-team-v1',
        teamId: 'custom-team',
        versionNumber: 1,
        name: '我的功能交付 Team',
        memberIds: ['draft-member-1'],
        memberSnapshots: [],
        workflowPrompt: '工作流',
        routingPolicy: {},
        teamMemory: [],
        maxA2ADepth: 5,
        createdAt: 1,
        createdFrom: 'manual',
      },
      validationCases: [],
    });

    const draft = {
      name: '我的功能交付 Team',
      mission: '交付软件功能',
      members: [{
        displayName: '实现工程师',
        role: '实现',
        responsibility: '实现代码',
        systemPrompt: '实现并验证',
        whenToUse: '方案确认后',
      }],
      workflow: '实现并验证',
      teamProtocol: '需要用户确认',
      routingPolicy: { rules: [] },
      teamMemory: [],
      validationCases: [],
      generationRationale: '目标需要实现角色',
    };

    const result = await requestJson('POST', '/api/teams', { draft });

    expect(result.status).toBe(200);
    expect(teamsRepo.createFromDraft).toHaveBeenCalledWith(draft);
    expect(result.data).toMatchObject({
      team: { id: 'custom-team', activeVersionId: 'custom-team-v1' },
      version: { id: 'custom-team-v1', versionNumber: 1, createdFrom: 'manual' },
    });
  });

  _skipIfNoPort('POST /api/teams returns 400 for a malformed draft and does not create a Team', async () => {
    vi.mocked(teamsRepo.createFromDraft).mockImplementation(() => {
      throw Object.assign(new Error('Team draft requires workflow'), {
        code: 'TEAM_DRAFT_INVALID',
      });
    });

    const result = await requestJson('POST', '/api/teams', {
      draft: {
        name: '伪造 Team',
        mission: '交付软件功能',
        members: [{
          displayName: '实现工程师',
          role: '实现',
          responsibility: '实现代码',
          systemPrompt: '实现并验证',
          whenToUse: '方案确认后',
        }],
      },
    });

    expect(result.status).toBe(400);
    expect(result.data).toMatchObject({
      code: 'TEAM_DRAFT_INVALID',
      error: 'Team draft requires workflow',
    });
    expect(teamsRepo.createFromDraft).toHaveBeenCalledTimes(1);
  });

  _skipIfNoPort('PATCH /api/rooms/:id trims and persists a renamed topic', async () => {
    vi.mocked(store.get).mockReturnValue({
      id: 'room-rename',
      topic: '旧标题',
      state: 'RUNNING' as const,
      agents: [],
      messages: [],
      sessionIds: {},
      a2aDepth: 0,
      a2aCallChain: [],
      teamId: 'roundtable-forum',
      maxA2ADepth: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    vi.mocked(roomsRepo.update).mockReturnValue({
      id: 'room-rename',
      topic: '新的标题',
      state: 'RUNNING' as const,
      agents: [],
      messages: [],
      sessionIds: {},
      a2aDepth: 0,
      a2aCallChain: [],
      teamId: 'roundtable-forum',
      maxA2ADepth: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    vi.mocked(teamsRepo.get).mockReturnValue({
      id: 'roundtable-forum',
      name: '圆桌论坛',
      prompt: '圆桌论坛',
      builtin: true,
      maxA2ADepth: 5,
    });

    const result = await requestJson('PATCH', '/api/rooms/room-rename', {
      topic: '  新的标题  ',
    });

    expect(result.status).toBe(200);
    expect(result.data).toHaveProperty('topic', '新的标题');
    expect(roomsRepo.update).toHaveBeenCalledWith('room-rename', expect.objectContaining({
      topic: '新的标题',
    }));
    expect(store.update).toHaveBeenCalledWith('room-rename', expect.objectContaining({
      topic: '新的标题',
    }));
  });

  _skipIfNoPort('POST /api/rooms/:id/title-suggestions returns seven generated titles', async () => {
    vi.mocked(store.get).mockReturnValue({
      id: 'room-title',
      topic: '未命名讨论 20:13',
      state: 'RUNNING' as const,
      agents: [{
        id: 'worker-1',
        role: 'WORKER' as const,
        name: '测试员',
        domainLabel: '测试',
        configId: 'worker-1',
        status: 'idle' as const,
      }],
      messages: [{
        id: 'msg-1',
        agentRole: 'USER' as const,
        agentName: '你',
        content: '帮我梳理登录态方案',
        timestamp: Date.now(),
        type: 'user_action' as const,
        toAgentId: 'worker-1',
      }],
      sessionIds: {},
      a2aDepth: 0,
      a2aCallChain: [],
      teamId: 'roundtable-forum',
      maxA2ADepth: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const result = await requestJson('POST', '/api/rooms/room-title/title-suggestions');

    expect(result.status).toBe(200);
    expect(result.data).toHaveProperty('titles');
    expect(result.data).toHaveProperty('agentName', '测试员');
    expect((result.data.titles as unknown[])).toHaveLength(7);
    expect(generateTitleSuggestionsInline).toHaveBeenCalledWith('room-title', expect.objectContaining({
      id: 'worker-1',
      name: '测试员',
    }));
  });
});
