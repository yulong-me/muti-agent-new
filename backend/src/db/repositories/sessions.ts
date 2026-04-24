import { db } from '../db.js';
import type { SessionTelemetry } from '../../types.js';

function parseJson<T>(value: unknown): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value as string) as T;
  } catch {
    return undefined;
  }
}

export const sessionsRepo = {
  upsert(agentId: string, roomId: string, sessionId: string, telemetry?: SessionTelemetry): void {
    db.prepare(`
      INSERT OR REPLACE INTO sessions (agent_id, room_id, session_id, telemetry_json, created_at, updated_at)
      VALUES (
        @agentId,
        @roomId,
        @sessionId,
        @telemetryJson,
        COALESCE((SELECT created_at FROM sessions WHERE agent_id = @agentId AND room_id = @roomId), @createdAt),
        @updatedAt
      )
    `).run({
      agentId,
      roomId,
      sessionId,
      telemetryJson: telemetry ? JSON.stringify(telemetry) : null,
      createdAt: Date.now(),
      updatedAt: telemetry?.measuredAt ?? Date.now(),
    });
  },

  getByRoom(roomId: string): Record<string, string> {
    const rows = db.prepare('SELECT agent_id, session_id FROM sessions WHERE room_id = ?').all(roomId) as {
      agent_id: string;
      session_id: string;
    }[];
    return Object.fromEntries(rows.map(r => [r.agent_id, r.session_id]));
  },

  getTelemetryByRoom(roomId: string): Record<string, SessionTelemetry> {
    const rows = db.prepare('SELECT agent_id, telemetry_json, session_id, updated_at FROM sessions WHERE room_id = ?').all(roomId) as {
      agent_id: string;
      telemetry_json: string | null;
      session_id: string;
      updated_at: number;
    }[];
    return Object.fromEntries(
      rows.flatMap(row => {
        const telemetry = parseJson<SessionTelemetry>(row.telemetry_json)
          ?? {
            sessionId: row.session_id,
            measuredAt: row.updated_at || Date.now(),
          };
        return telemetry ? [[row.agent_id, telemetry]] : [];
      }),
    );
  },

  deleteByRoom(roomId: string): void {
    db.prepare('DELETE FROM sessions WHERE room_id = ?').run(roomId);
  },
};
