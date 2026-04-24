import { db } from '../db.js';
import type { DiscussionRoom, Message } from '../../types.js';
import { agentsRepo } from './agents.js';
import { sessionsRepo } from './sessions.js';
import { v4 as uuid } from 'uuid';

function stringifyToolCalls(toolCalls: Message['toolCalls']): string | null {
  return toolCalls && toolCalls.length > 0 ? JSON.stringify(toolCalls) : null;
}

function parseToolCalls(value: unknown): Message['toolCalls'] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value as string) as Message['toolCalls'];
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function stringifyJson<T>(value: T | undefined): string | null {
  return value ? JSON.stringify(value) : null;
}

function parseJson<T>(value: unknown): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value as string) as T;
  } catch {
    return undefined;
  }
}

/** Rooms CRUD */
export const roomsRepo = {
  create(room: DiscussionRoom): DiscussionRoom {
    db.prepare(`
      INSERT INTO rooms (id, topic, state, report, agent_ids, workspace, scene_id, created_at, updated_at, max_a2a_depth)
      VALUES (@id, @topic, @state, @report, @agentIds, @workspace, @sceneId, @createdAt, @updatedAt, @maxA2ADepth)
    `).run({
      id: room.id,
      topic: room.topic,
      state: room.state,
      report: room.report ?? null,
      agentIds: JSON.stringify(room.agents.map(a => a.configId)),
      workspace: room.workspace ?? null,
      sceneId: room.sceneId,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      maxA2ADepth: room.maxA2ADepth ?? null,
    });
    return room;
  },

  get(id: string): DiscussionRoom | undefined {
    const row = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const agentIds: string[] = JSON.parse((row.agent_ids as string) ?? '[]');
    const agents = agentIds
      .map(configId => agentsRepo.get(configId))
      .filter((a): a is NonNullable<typeof a> => a !== undefined)
      .map(a => ({ id: uuid(), role: a.role, name: a.name, domainLabel: a.roleLabel, status: 'idle' as const, configId: a.id }));
    return {
      id: row.id as string,
      topic: row.topic as string,
      state: row.state as DiscussionRoom['state'],
      report: row.report as string | undefined,
      workspace: (row.workspace as string) ?? undefined,
      sceneId: (row.scene_id as string) ?? 'roundtable-forum',
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      agents,
      messages: messagesRepo.listByRoom(row.id as string),
      sessionIds: sessionsRepo.getByRoom(row.id as string),
      sessionTelemetryByAgent: sessionsRepo.getTelemetryByRoom(row.id as string),
      a2aDepth: 0,
      a2aCallChain: [],
      maxA2ADepth: (row.max_a2a_depth as number | null) ?? null,
    };
  },

  update(id: string, partial: Partial<DiscussionRoom>): DiscussionRoom | undefined {
    const existing = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) return undefined;
    db.prepare(`
      UPDATE rooms SET
        topic = @topic,
        state = @state,
        report = @report,
        agent_ids = @agentIds,
        updated_at = @updatedAt,
        max_a2a_depth = @maxA2ADepth
      WHERE id = @id
    `).run({
      id,
      topic: partial.topic ?? (existing.topic as string),
      state: partial.state ?? (existing.state as string),
      report: partial.report !== undefined ? partial.report : (existing.report as string | null),
      agentIds: partial.agents !== undefined
        ? JSON.stringify(partial.agents.map(a => a.configId))
        : (existing.agent_ids as string),
      updatedAt: Date.now(),
      maxA2ADepth: partial.maxA2ADepth !== undefined ? partial.maxA2ADepth : (existing.max_a2a_depth as number | null),
    });
    return this.get(id);
  },

  list(): DiscussionRoom[] {
    const rows = db.prepare('SELECT id FROM rooms WHERE deleted_at IS NULL ORDER BY updated_at DESC').all() as { id: string }[];
    return rows.map(r => this.get(r.id)!);
  },

  /**
   * Lightweight list for sidebar — single query, no full message load.
   * Returns id/topic/createdAt/updatedAt/state/workspace/preview for navigation.
   */
  listSidebar(): Array<{
    id: string
    topic: string
    createdAt: number
    updatedAt: number
    state: DiscussionRoom['state']
    workspace?: string
    preview?: string
    agentCount: number
  }> {
    type SidebarRow = {
      id: string
      topic: string
      created_at: number
      updated_at: number
      state: string
      workspace: string | null
      preview: string | null
      agent_ids: string
    }
    const rows = db.prepare(`
      SELECT
        r.id,
        r.topic,
        r.created_at,
        r.updated_at,
        r.state,
        r.workspace,
        (
          SELECT content FROM messages m
          WHERE m.room_id = r.id
            AND m.agent_role != 'MANAGER'
            AND m.type != 'system'
          ORDER BY timestamp DESC
          LIMIT 1
        ) AS preview,
        r.agent_ids
      FROM rooms r
      WHERE r.deleted_at IS NULL
      ORDER BY r.updated_at DESC
    `).all() as SidebarRow[]

    return rows.map(r => {
      let agentCount = 0
      try {
        const ids: string[] = JSON.parse(r.agent_ids ?? '[]')
        agentCount = ids.length
      } catch (_e) {
        agentCount = 0
      }
      const preview = r.preview
        ? r.preview.slice(0, 120)
        : undefined
      return {
        id: r.id,
        topic: r.topic,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        state: r.state as DiscussionRoom['state'],
        workspace: r.workspace ?? undefined,
        preview,
        agentCount,
      }
    })
  },

  archive(id: string): void {
    db.prepare('UPDATE rooms SET deleted_at = ? WHERE id = ?').run(Date.now(), id);
  },

  listArchived(): { id: string; topic: string; state: string; createdAt: number; deletedAt: number }[] {
    const rows = db.prepare('SELECT id, topic, state, created_at, deleted_at FROM rooms WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all() as {
      id: string; topic: string; state: string; created_at: number; deleted_at: number
    }[];
    return rows.map(r => ({
      id: r.id,
      topic: r.topic,
      state: r.state,
      createdAt: r.created_at,
      deletedAt: r.deleted_at,
    }));
  },

  permanentDelete(id: string): void {
    db.prepare('DELETE FROM messages WHERE room_id = ?').run(id);
    db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
  },
};

/** Messages CRUD */
export const messagesRepo = {
  insert(roomId: string, msg: Message): Message {
    db.prepare(`
      INSERT INTO messages (id, room_id, agent_role, agent_name, content, timestamp, type, thinking, tool_calls_json, duration_ms, total_cost_usd, input_tokens, output_tokens, session_id, invocation_usage_json, context_health_json, temp_msg_id, to_agent_id, run_error_json)
      VALUES (@id, @roomId, @agentRole, @agentName, @content, @timestamp, @type, @thinking, @toolCallsJson, @durationMs, @totalCostUsd, @inputTokens, @outputTokens, @sessionId, @invocationUsageJson, @contextHealthJson, @tempMsgId, @toAgentId, @runErrorJson)
    `).run({
      id: msg.id,
      roomId,
      agentRole: msg.agentRole,
      agentName: msg.agentName,
      content: msg.content,
      timestamp: msg.timestamp,
      type: msg.type,
      thinking: msg.thinking ?? null,
      toolCallsJson: stringifyToolCalls(msg.toolCalls),
      durationMs: msg.duration_ms ?? null,
      totalCostUsd: msg.total_cost_usd ?? null,
      inputTokens: msg.input_tokens ?? null,
      outputTokens: msg.output_tokens ?? null,
      sessionId: msg.sessionId ?? null,
      invocationUsageJson: stringifyJson(msg.invocationUsage),
      contextHealthJson: stringifyJson(msg.contextHealth),
      tempMsgId: msg.tempMsgId ?? null,
      toAgentId: msg.toAgentId ?? null,
      runErrorJson: msg.runError ? JSON.stringify(msg.runError) : null,
    });
    return msg;
  },

  updateContent(messageId: string, content: string, meta?: Partial<Message>): void {
    db.prepare(`
      UPDATE messages SET
        content = @content,
        thinking = @thinking,
        tool_calls_json = @toolCallsJson,
        duration_ms = @durationMs,
        total_cost_usd = @totalCostUsd,
        input_tokens = @inputTokens,
        output_tokens = @outputTokens,
        session_id = @sessionId,
        invocation_usage_json = @invocationUsageJson,
        context_health_json = @contextHealthJson,
        run_error_json = @runErrorJson
      WHERE id = @id
    `).run({
      id: messageId,
      content,
      thinking: meta?.thinking ?? null,
      toolCallsJson: stringifyToolCalls(meta?.toolCalls),
      durationMs: meta?.duration_ms ?? null,
      totalCostUsd: meta?.total_cost_usd ?? null,
      inputTokens: meta?.input_tokens ?? null,
      outputTokens: meta?.output_tokens ?? null,
      sessionId: meta?.sessionId ?? null,
      invocationUsageJson: stringifyJson(meta?.invocationUsage),
      contextHealthJson: stringifyJson(meta?.contextHealth),
      runErrorJson: meta?.runError ? JSON.stringify(meta.runError) : null,
    });
  },

  listByRoom(roomId: string): Message[] {
    const rows = db.prepare(
      'SELECT * FROM messages WHERE room_id = ? ORDER BY timestamp ASC'
    ).all(roomId) as Record<string, unknown>[];
    return rows.map(r => {
      let runError: Message['runError'] | undefined;
      if (r.run_error_json) {
        try {
          runError = JSON.parse(r.run_error_json as string) as Message['runError'];
        } catch {
          runError = undefined;
        }
      }
      const toolCalls = parseToolCalls(r.tool_calls_json);
      const invocationUsage = parseJson<Message['invocationUsage']>(r.invocation_usage_json);
      const contextHealth = parseJson<Message['contextHealth']>(r.context_health_json);

      return {
        id: r.id as string,
        agentRole: r.agent_role as Message['agentRole'],
        agentName: r.agent_name as string,
        content: r.content as string,
        timestamp: r.timestamp as number,
        type: r.type as Message['type'],
        thinking: r.thinking as string | undefined,
        toolCalls,
        duration_ms: r.duration_ms as number | undefined,
        total_cost_usd: r.total_cost_usd as number | undefined,
        input_tokens: r.input_tokens as number | undefined,
        output_tokens: r.output_tokens as number | undefined,
        sessionId: (r.session_id as string) ?? undefined,
        invocationUsage,
        contextHealth,
        tempMsgId: r.temp_msg_id as string | undefined,
        toAgentId: (r.to_agent_id as string) ?? undefined,
        runError,
      };
    });
  },
};
