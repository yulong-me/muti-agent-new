import { v4 as uuid } from 'uuid';
import { db } from '../db.js';
import type {
  AgentRole,
  AgentRun,
  AgentRunDetail,
  AgentRunStatus,
  AgentRunWorkspaceChanges,
  ContextHealth,
  InvocationUsage,
  Message,
  SessionTelemetry,
  ToolCall,
} from '../../types.js';

export interface CreateRunningAgentRunInput {
  roomId: string;
  agentInstanceId: string;
  agentConfigId: string;
  agentName: string;
  agentRole: AgentRole;
  triggerMessageId?: string;
  parentRunId?: string;
  provider: string;
  model?: string;
  startedAt?: number;
}

export interface CompleteAgentRunInput {
  outputMessageId?: string;
  sessionId?: string;
  endedAt?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
  invocationUsage?: InvocationUsage;
  contextHealth?: ContextHealth;
  toolCalls?: ToolCall[];
  workspaceChanges?: AgentRunWorkspaceChanges;
  error?: unknown;
}

function stringifyJson(value: unknown | undefined): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function parseJson<T>(value: unknown): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value as string) as T;
  } catch {
    return undefined;
  }
}

function rowToRun(row: Record<string, unknown>): AgentRun {
  return {
    id: row.id as string,
    roomId: row.room_id as string,
    agentInstanceId: row.agent_instance_id as string,
    agentConfigId: row.agent_config_id as string,
    agentName: row.agent_name as string,
    agentRole: row.agent_role as AgentRole,
    triggerMessageId: (row.trigger_message_id as string | null) ?? undefined,
    outputMessageId: (row.output_message_id as string | null) ?? undefined,
    parentRunId: (row.parent_run_id as string | null) ?? undefined,
    sessionId: (row.session_id as string | null) ?? undefined,
    provider: row.provider as string,
    model: (row.model as string | null) ?? undefined,
    status: row.status as AgentRunStatus,
    startedAt: row.started_at as number,
    endedAt: (row.ended_at as number | null) ?? undefined,
    durationMs: (row.duration_ms as number | null) ?? undefined,
    inputTokens: (row.input_tokens as number | null) ?? undefined,
    outputTokens: (row.output_tokens as number | null) ?? undefined,
    totalCostUsd: (row.total_cost_usd as number | null) ?? undefined,
    invocationUsage: parseJson<InvocationUsage>(row.invocation_usage_json),
    contextHealth: parseJson<ContextHealth>(row.context_health_json),
    toolCalls: parseJson<ToolCall[]>(row.tool_calls_json),
    workspaceChanges: parseJson<AgentRunWorkspaceChanges>(row.workspace_changes_json),
    error: parseJson<Record<string, unknown>>(row.error_json),
  };
}

function rowToMessage(row: Record<string, unknown> | undefined): Message | undefined {
  if (!row) return undefined;
  return {
    id: row.id as string,
    agentRole: row.agent_role as Message['agentRole'],
    agentName: row.agent_name as string,
    content: row.content as string,
    timestamp: row.timestamp as number,
    type: row.type as Message['type'],
    thinking: (row.thinking as string | null) ?? undefined,
    toolCalls: parseJson<ToolCall[]>(row.tool_calls_json),
    duration_ms: (row.duration_ms as number | null) ?? undefined,
    total_cost_usd: (row.total_cost_usd as number | null) ?? undefined,
    input_tokens: (row.input_tokens as number | null) ?? undefined,
    output_tokens: (row.output_tokens as number | null) ?? undefined,
    sessionId: (row.session_id as string | null) ?? undefined,
    invocationUsage: parseJson<InvocationUsage>(row.invocation_usage_json),
    contextHealth: parseJson<ContextHealth>(row.context_health_json),
    tempMsgId: (row.temp_msg_id as string | null) ?? undefined,
    toAgentId: (row.to_agent_id as string | null) ?? undefined,
    runError: parseJson<Message['runError']>(row.run_error_json),
  };
}

function getMessage(id: string | undefined): Message | undefined {
  if (!id) return undefined;
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return rowToMessage(row);
}

function buildSessionTelemetry(run: AgentRun): SessionTelemetry | undefined {
  if (!run.sessionId) return undefined;
  return {
    sessionId: run.sessionId,
    invocationUsage: run.invocationUsage,
    contextHealth: run.contextHealth,
    measuredAt: run.endedAt ?? run.startedAt,
  };
}

function completeRun(id: string, status: Exclude<AgentRunStatus, 'running'>, input: CompleteAgentRunInput): void {
  const endedAt = input.endedAt ?? Date.now();
  db.prepare(`
    UPDATE agent_runs SET
      status = @status,
      output_message_id = COALESCE(@outputMessageId, output_message_id),
      session_id = COALESCE(@sessionId, session_id),
      ended_at = @endedAt,
      duration_ms = @durationMs,
      input_tokens = @inputTokens,
      output_tokens = @outputTokens,
      total_cost_usd = @totalCostUsd,
      invocation_usage_json = @invocationUsageJson,
      context_health_json = @contextHealthJson,
      tool_calls_json = @toolCallsJson,
      workspace_changes_json = @workspaceChangesJson,
      error_json = @errorJson
    WHERE id = @id
  `).run({
    id,
    status,
    outputMessageId: input.outputMessageId ?? null,
    sessionId: input.sessionId ?? null,
    endedAt,
    durationMs: input.durationMs ?? null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    totalCostUsd: input.totalCostUsd ?? null,
    invocationUsageJson: stringifyJson(input.invocationUsage),
    contextHealthJson: stringifyJson(input.contextHealth),
    toolCallsJson: stringifyJson(input.toolCalls),
    workspaceChangesJson: stringifyJson(input.workspaceChanges),
    errorJson: stringifyJson(input.error),
  });
}

export const agentRunsRepo = {
  createRunning(input: CreateRunningAgentRunInput): AgentRun {
    const runId = uuid();
    const startedAt = input.startedAt ?? Date.now();
    db.prepare(`
      INSERT INTO agent_runs (
        id, room_id, agent_instance_id, agent_config_id, agent_name, agent_role,
        trigger_message_id, output_message_id, parent_run_id, session_id,
        provider, model, status, started_at, ended_at, duration_ms,
        input_tokens, output_tokens, total_cost_usd,
        invocation_usage_json, context_health_json, tool_calls_json, workspace_changes_json, error_json
      )
      VALUES (
        @id, @roomId, @agentInstanceId, @agentConfigId, @agentName, @agentRole,
        @triggerMessageId, NULL, @parentRunId, NULL,
        @provider, @model, 'running', @startedAt, NULL, NULL,
        NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL
      )
    `).run({
      id: runId,
      roomId: input.roomId,
      agentInstanceId: input.agentInstanceId,
      agentConfigId: input.agentConfigId,
      agentName: input.agentName,
      agentRole: input.agentRole,
      triggerMessageId: input.triggerMessageId ?? null,
      parentRunId: input.parentRunId ?? null,
      provider: input.provider,
      model: input.model ?? null,
      startedAt,
    });
    return this.getDetail(input.roomId, runId)!;
  },

  markSucceeded(id: string, input: CompleteAgentRunInput): void {
    completeRun(id, 'succeeded', input);
  },

  markFailed(id: string, input: CompleteAgentRunInput): void {
    completeRun(id, 'failed', input);
  },

  markStopped(id: string, input: CompleteAgentRunInput): void {
    completeRun(id, 'stopped', input);
  },

  listByRoom(roomId: string): AgentRun[] {
    const rows = db.prepare('SELECT * FROM agent_runs WHERE room_id = ? ORDER BY started_at DESC, id DESC')
      .all(roomId) as Record<string, unknown>[];
    return rows.map(rowToRun);
  },

  getDetail(roomId: string, runId: string): AgentRunDetail | undefined {
    const row = db.prepare('SELECT * FROM agent_runs WHERE id = ? AND room_id = ?')
      .get(runId, roomId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const run = rowToRun(row);
    return {
      ...run,
      triggerMessage: getMessage(run.triggerMessageId),
      outputMessage: getMessage(run.outputMessageId),
      sessionTelemetry: buildSessionTelemetry(run),
    };
  },
};
