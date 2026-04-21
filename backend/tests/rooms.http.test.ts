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
  roomsRepo: { create: vi.fn(), update: vi.fn() },
  auditRepo: { log: vi.fn() },
  scenesRepo: { get: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

vi.mock('../src/config/agentConfig.js', () => ({
  getAgent: vi.fn(),
}));

// isRoomBusy is exported from stateMachine; partial mock to keep it real
vi.mock('../src/services/stateMachine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/stateMachine.js')>();
  return {
    ...actual,
    hostReply: vi.fn(),
    addUserMessage: vi.fn(),
    handleUserMessage: vi.fn(),
    generateReport: vi.fn(),
    // Must resolve so .catch() in the route handler doesn't throw on undefined
    routeToAgent: vi.fn().mockResolvedValue(undefined),
    stopAgentRun: vi.fn().mockReturnValue({ stopped: true, agentName: '测试员' }),
  };
});

import { roomsRouter } from '../src/routes/rooms.js';
import { store } from '../src/store.js';
import { roomsRepo, scenesRepo } from '../src/db/index.js';
import { getAgent } from '../src/config/agentConfig.js';
import { stopAgentRun } from '../src/services/stateMachine.js';

// Build a minimal Express app with the rooms router under test
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/rooms', roomsRouter);
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

  _skipIfNoPort('preserves the user-provided topic when creating a room', async () => {
    vi.mocked(scenesRepo.get).mockReturnValue({
      id: 'software-development',
      name: '软件开发',
      prompt: '软件开发场景',
      builtin: true,
      maxA2ADepth: 5,
    });
    vi.mocked(getAgent).mockReturnValue({
      id: 'worker-1',
      name: '架构师',
      role: 'WORKER',
      roleLabel: '架构设计',
      provider: 'claude-code',
      providerOpts: { thinking: true },
      systemPrompt: '你是架构师',
      enabled: true,
      tags: ['dev'],
    });

    const result = await requestJson('POST', '/api/rooms', {
      topic: '  实现登录态持久化  ',
      workerIds: ['worker-1'],
      sceneId: 'software-development',
    });

    expect(result.status).toBe(200);
    expect(result.data).toHaveProperty('topic', '实现登录态持久化');
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({
      topic: '实现登录态持久化',
      sceneId: 'software-development',
    }));
    expect(roomsRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      topic: '实现登录态持久化',
      sceneId: 'software-development',
    }));
  });

  _skipIfNoPort('PATCH /api/rooms/:id returns scene effective depth when clearing room override', async () => {
    vi.mocked(store.get).mockReturnValue({
      id: 'room-depth',
      topic: 'Test',
      state: 'RUNNING' as const,
      agents: [],
      messages: [],
      sessionIds: {},
      a2aDepth: 2,
      a2aCallChain: [],
      sceneId: 'software-development',
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
      sceneId: 'software-development',
      maxA2ADepth: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    vi.mocked(scenesRepo.get).mockReturnValue({
      id: 'software-development',
      name: '软件开发',
      prompt: '软件开发场景',
      builtin: true,
      maxA2ADepth: 10,
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
});
