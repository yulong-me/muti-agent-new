import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockDbRef = vi.hoisted(() => ({
  db: undefined as Database.Database | undefined,
}));

vi.mock('../src/db/db.js', () => ({
  get db() {
    if (!mockDbRef.db) {
      throw new Error('Test DB is not initialized');
    }
    return mockDbRef.db;
  },
  DB_PATH: ':memory:',
}));

let db: Database.Database;

function initTestDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  const schemaPath = path.resolve(__dirname, '..', 'src', 'db', 'schema.sql');
  testDb.exec(fs.readFileSync(schemaPath, 'utf-8'));
  return testDb;
}

function seedRoomAndMessages(): void {
  db.prepare(`
    INSERT INTO rooms (id, topic, state, report, agent_ids, created_at, updated_at)
    VALUES ('room-1', '执行账本', 'RUNNING', NULL, '["worker-config"]', 1000, 1000)
  `).run();
  db.prepare(`
    INSERT INTO rooms (id, topic, state, report, agent_ids, created_at, updated_at)
    VALUES ('room-2', '其他房间', 'RUNNING', NULL, '["worker-config"]', 1000, 1000)
  `).run();
  db.prepare(`
    INSERT INTO messages (id, room_id, agent_role, agent_name, content, timestamp, type)
    VALUES ('trigger-1', 'room-1', 'USER', '你', '请实现账本', 1100, 'user_action')
  `).run();
  db.prepare(`
    INSERT INTO messages (id, room_id, agent_role, agent_name, content, timestamp, type, tool_calls_json, session_id, invocation_usage_json, context_health_json)
    VALUES (
      'output-1',
      'room-1',
      'WORKER',
      '实现工程师',
      '已完成',
      1200,
      'statement',
      '[{"toolName":"Bash","toolInput":{"command":"pwd"},"callId":"toolu_1","timestamp":1200}]',
      'session-1',
      '{"provider":"opencode","model":"gpt-5.5","inputTokens":12,"outputTokens":8,"totalTokens":20,"costUsd":0.01}',
      '{"usedTokens":20,"windowSize":200000,"leftTokens":199980,"leftPct":99.99,"fillRatio":0.0001,"source":"exact","state":"healthy"}'
    )
  `).run();
  db.prepare(`
    INSERT INTO sessions (agent_id, room_id, session_id, telemetry_json, created_at, updated_at)
    VALUES (
      'worker-config',
      'room-1',
      'session-1',
      '{"sessionId":"session-1","invocationUsage":{"provider":"opencode","model":"gpt-5.5"},"measuredAt":1300}',
      1000,
      1300
    )
  `).run();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  db = initTestDb();
  mockDbRef.db = db;
  seedRoomAndMessages();
});

afterEach(() => {
  mockDbRef.db = undefined;
  db.close();
});

describe('agentRunsRepo', () => {
  it('creates the agent_runs table with status constraints and indexes', () => {
    const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_runs'")
      .get() as { sql: string } | undefined;
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agent_runs'")
      .all() as Array<{ name: string }>;

    expect(table?.sql).toContain("CHECK (status IN ('running','succeeded','failed','stopped'))");
    expect(indexes.map(index => index.name)).toEqual(expect.arrayContaining([
      'idx_agent_runs_room_id',
      'idx_agent_runs_status',
    ]));
  });

  it('records running, success, failed, and stopped run lifecycle states', async () => {
    const { agentRunsRepo } = await import('../src/db/repositories/agentRuns.js');

    const running = agentRunsRepo.createRunning({
      roomId: 'room-1',
      agentInstanceId: 'worker-runtime-1',
      agentConfigId: 'worker-config',
      agentName: '实现工程师',
      agentRole: 'WORKER',
      triggerMessageId: 'trigger-1',
      provider: 'opencode',
      model: 'gpt-5.5',
      startedAt: 1200,
    });

    expect(running).toMatchObject({
      roomId: 'room-1',
      agentConfigId: 'worker-config',
      status: 'running',
      triggerMessageId: 'trigger-1',
    });

    agentRunsRepo.markSucceeded(running.id, {
      outputMessageId: 'output-1',
      sessionId: 'session-1',
      endedAt: 1300,
      durationMs: 100,
      inputTokens: 12,
      outputTokens: 8,
      totalCostUsd: 0.01,
      invocationUsage: { provider: 'opencode', model: 'gpt-5.5', totalTokens: 20 },
      contextHealth: {
        usedTokens: 20,
        windowSize: 200000,
        leftTokens: 199980,
        leftPct: 99.99,
        fillRatio: 0.0001,
        source: 'exact',
        state: 'healthy',
      },
      toolCalls: [{ toolName: 'Bash', toolInput: { command: 'pwd' }, callId: 'toolu_1', timestamp: 1200 }],
      workspaceChanges: { hasChanges: true, created: ['src/App.tsx'], modified: [], deleted: [] },
    });

    const succeeded = agentRunsRepo.getDetail('room-1', running.id);
    expect(succeeded).toMatchObject({
      id: running.id,
      status: 'succeeded',
      outputMessageId: 'output-1',
      sessionId: 'session-1',
      triggerMessage: { id: 'trigger-1', content: '请实现账本' },
      outputMessage: { id: 'output-1', content: '已完成' },
      sessionTelemetry: { sessionId: 'session-1' },
      toolCalls: [expect.objectContaining({ toolName: 'Bash' })],
      workspaceChanges: { hasChanges: true, created: ['src/App.tsx'] },
    });

    const failed = agentRunsRepo.createRunning({
      roomId: 'room-1',
      agentInstanceId: 'worker-runtime-2',
      agentConfigId: 'worker-config',
      agentName: '实现工程师',
      agentRole: 'WORKER',
      provider: 'opencode',
      startedAt: 1400,
    });
    agentRunsRepo.markFailed(failed.id, {
      endedAt: 1500,
      durationMs: 100,
      error: { code: 'AGENT_PROVIDER_ERROR', message: 'provider failed', retryable: true },
    });
    expect(agentRunsRepo.getDetail('room-1', failed.id)).toMatchObject({
      status: 'failed',
      error: { code: 'AGENT_PROVIDER_ERROR', message: 'provider failed' },
    });

    const stopped = agentRunsRepo.createRunning({
      roomId: 'room-1',
      agentInstanceId: 'worker-runtime-3',
      agentConfigId: 'worker-config',
      agentName: '实现工程师',
      agentRole: 'WORKER',
      provider: 'opencode',
      startedAt: 1600,
    });
    agentRunsRepo.markStopped(stopped.id, {
      endedAt: 1700,
      durationMs: 100,
      error: { code: 'AGENT_STOPPED', message: 'stopped', retryable: false },
    });
    expect(agentRunsRepo.getDetail('room-1', stopped.id)).toMatchObject({
      status: 'stopped',
      error: { code: 'AGENT_STOPPED' },
    });
  });

  it('lists runs by room and rejects cross-room detail access', async () => {
    const { agentRunsRepo } = await import('../src/db/repositories/agentRuns.js');
    const roomRun = agentRunsRepo.createRunning({
      roomId: 'room-1',
      agentInstanceId: 'worker-runtime-1',
      agentConfigId: 'worker-config',
      agentName: '实现工程师',
      agentRole: 'WORKER',
      provider: 'opencode',
      startedAt: 1200,
    });
    agentRunsRepo.createRunning({
      roomId: 'room-2',
      agentInstanceId: 'worker-runtime-2',
      agentConfigId: 'worker-config',
      agentName: '实现工程师',
      agentRole: 'WORKER',
      provider: 'opencode',
      startedAt: 1200,
    });

    expect(agentRunsRepo.listByRoom('room-1').map(run => run.id)).toEqual([roomRun.id]);
    expect(agentRunsRepo.getDetail('room-2', roomRun.id)).toBeUndefined();
  });
});
