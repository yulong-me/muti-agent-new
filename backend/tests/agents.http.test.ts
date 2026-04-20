import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';

const mockAgentConfig = vi.hoisted(() => {
  let agents = [
    {
      id: 'architect',
      name: '架构师',
      roleLabel: '架构',
      role: 'WORKER' as const,
      provider: 'opencode' as const,
      providerOpts: { thinking: true },
      systemPrompt: '你是架构师',
      enabled: true,
      tags: ['架构'],
    },
  ];

  return {
    reset() {
      agents = [
        {
          id: 'architect',
          name: '架构师',
          roleLabel: '架构',
          role: 'WORKER' as const,
          provider: 'opencode' as const,
          providerOpts: { thinking: true },
          systemPrompt: '你是架构师',
          enabled: true,
          tags: ['架构'],
        },
      ];
    },
    getAgents: vi.fn(() => agents),
    getAgent: vi.fn((id: string) => agents.find(agent => agent.id === id)),
    saveAgents: vi.fn((nextAgents: typeof agents) => {
      agents = nextAgents;
    }),
  };
});

vi.mock('../src/config/agentConfig.js', () => mockAgentConfig);

import { agentsRouter } from '../src/routes/agents.js';

let server: http.Server;
let serverPort = 0;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agents', agentsRouter);
  return app;
}

async function reqJson(
  method: string,
  path: string,
  body?: object,
): Promise<{ status: number; data: Record<string, unknown> }> {
  return await new Promise((resolve) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port: serverPort,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let data: Record<string, unknown> = {};
        try { data = JSON.parse(raw); } catch { /* ignore */ }
        resolve({ status: res.statusCode ?? 0, data });
      });
    });
    req.on('error', (error) => resolve({ status: 0, data: { error: String(error) } }));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

beforeAll(async () => {
  server = http.createServer(makeApp());
  await new Promise<void>((resolve) => server.listen(0, () => {
    const addr = server.address();
    serverPort = typeof addr === 'object' && addr !== null ? addr.port : 0;
    resolve();
  }));
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAgentConfig.reset();
});

afterAll(() => {
  server.close();
});

describe('agents router model settings', () => {
  it('updates an agent model override via PUT /api/agents/:id', async () => {
    const result = await reqJson('PUT', '/api/agents/architect', {
      provider: 'opencode',
      providerOpts: { thinking: true, model: 'google/gemini-2.5-pro' },
    });

    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({
      id: 'architect',
      provider: 'opencode',
      providerOpts: { thinking: true, model: 'google/gemini-2.5-pro' },
    });
  });

  it('creates a new agent with a model override via POST /api/agents', async () => {
    const result = await reqJson('POST', '/api/agents', {
      id: 'reviewer',
      name: 'Reviewer',
      roleLabel: 'Review',
      provider: 'claude-code',
      providerOpts: { thinking: true, model: 'sonnet' },
      systemPrompt: '你是 reviewer',
      tags: ['review'],
    });

    expect(result.status).toBe(201);
    expect(result.data).toMatchObject({
      id: 'reviewer',
      provider: 'claude-code',
      providerOpts: { thinking: true, model: 'sonnet' },
    });
  });
});
