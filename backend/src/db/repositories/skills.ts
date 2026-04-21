import { db } from '../db.js';
import type { ProviderName } from './agents.js';

export type SkillSourceType = 'managed' | 'workspace';
export type SkillMode = 'auto' | 'required';
export type SkillProviderCompat = ProviderName;

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  sourceType: SkillSourceType;
  sourcePath: string;
  enabled: boolean;
  readOnly: boolean;
  builtin: boolean;
  providerCompat: SkillProviderCompat[];
  updatedAt: number;
  checksum: string;
}

export interface SkillBindingRecord {
  skillId: string;
  mode: SkillMode;
  enabled: boolean;
  createdAt: number;
  skill: SkillRecord;
}

function parseSkill(row: Record<string, unknown>): SkillRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    sourceType: row.source_type as SkillSourceType,
    sourcePath: row.source_path as string,
    enabled: Boolean(row.enabled),
    readOnly: Boolean(row.read_only),
    builtin: Boolean(row.builtin),
    providerCompat: JSON.parse((row.provider_compat as string) ?? '[]') as SkillProviderCompat[],
    updatedAt: row.updated_at as number,
    checksum: row.checksum as string,
  };
}

function parseBinding(row: Record<string, unknown>): SkillBindingRecord {
  return {
    skillId: row.binding_skill_id as string,
    mode: row.binding_mode as SkillMode,
    enabled: Boolean(row.binding_enabled),
    createdAt: row.binding_created_at as number,
    skill: parseSkill(row),
  };
}

function isMissingTableError(err: unknown): boolean {
  return /no such table/i.test(String(err));
}

export const skillsRepo = {
  listManaged(): SkillRecord[] {
    try {
      const rows = db.prepare(
        "SELECT * FROM skills WHERE source_type = 'managed' ORDER BY updated_at DESC, name ASC",
      ).all() as Record<string, unknown>[];
      return rows.map(parseSkill);
    } catch (err) {
      if (isMissingTableError(err)) return [];
      throw err;
    }
  },

  getById(id: string): SkillRecord | undefined {
    try {
      const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      return row ? parseSkill(row) : undefined;
    } catch (err) {
      if (isMissingTableError(err)) return undefined;
      throw err;
    }
  },

  getManagedByName(name: string): SkillRecord | undefined {
    try {
      const row = db.prepare(
        "SELECT * FROM skills WHERE source_type = 'managed' AND name = ?",
      ).get(name) as Record<string, unknown> | undefined;
      return row ? parseSkill(row) : undefined;
    } catch (err) {
      if (isMissingTableError(err)) return undefined;
      throw err;
    }
  },

  upsert(skill: SkillRecord): SkillRecord {
    db.prepare(`
      INSERT OR REPLACE INTO skills
        (id, name, description, source_type, source_path, enabled, read_only, builtin, provider_compat, updated_at, checksum)
      VALUES
        (@id, @name, @description, @sourceType, @sourcePath, @enabled, @readOnly, @builtin, @providerCompat, @updatedAt, @checksum)
    `).run({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      sourceType: skill.sourceType,
      sourcePath: skill.sourcePath,
      enabled: skill.enabled ? 1 : 0,
      readOnly: skill.readOnly ? 1 : 0,
      builtin: skill.builtin ? 1 : 0,
      providerCompat: JSON.stringify(skill.providerCompat),
      updatedAt: skill.updatedAt,
      checksum: skill.checksum,
    });
    return skill;
  },

  delete(id: string): void {
    db.prepare('DELETE FROM skills WHERE id = ?').run(id);
  },

  countBindingUsage(skillId: string): { agentCount: number; roomCount: number } {
    try {
      const agentCount = (
        db.prepare('SELECT COUNT(*) as cnt FROM agent_skill_bindings WHERE skill_id = ?').get(skillId) as { cnt: number }
      ).cnt;
      const roomCount = (
        db.prepare('SELECT COUNT(*) as cnt FROM room_skill_bindings WHERE skill_id = ?').get(skillId) as { cnt: number }
      ).cnt;
      return { agentCount, roomCount };
    } catch (err) {
      if (isMissingTableError(err)) return { agentCount: 0, roomCount: 0 };
      throw err;
    }
  },
};

function listBindingsFor(table: 'agent_skill_bindings' | 'room_skill_bindings', ownerColumn: 'agent_id' | 'room_id', ownerId: string): SkillBindingRecord[] {
  try {
    const rows = db.prepare(`
      SELECT
        s.*,
        b.skill_id AS binding_skill_id,
        b.mode AS binding_mode,
        b.enabled AS binding_enabled,
        b.created_at AS binding_created_at
      FROM ${table} b
      JOIN skills s ON s.id = b.skill_id
      WHERE b.${ownerColumn} = ?
        AND s.source_type = 'managed'
      ORDER BY b.created_at ASC, s.name ASC
    `).all(ownerId) as Record<string, unknown>[];
    return rows.map(parseBinding);
  } catch (err) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

function replaceBindingsFor(table: 'agent_skill_bindings' | 'room_skill_bindings', ownerColumn: 'agent_id' | 'room_id', ownerId: string, bindings: Array<{
  skillId: string;
  mode: SkillMode;
  enabled: boolean;
}>): void {
  const replace = db.transaction(() => {
    db.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = ?`).run(ownerId);
    const insert = db.prepare(`
      INSERT INTO ${table} (${ownerColumn}, skill_id, mode, enabled, created_at)
      VALUES (@ownerId, @skillId, @mode, @enabled, @createdAt)
    `);
    const createdAt = Date.now();
    for (const binding of bindings) {
      insert.run({
        ownerId,
        skillId: binding.skillId,
        mode: binding.mode,
        enabled: binding.enabled ? 1 : 0,
        createdAt,
      });
    }
  });
  replace();
}

export const agentSkillBindingsRepo = {
  list(agentId: string): SkillBindingRecord[] {
    return listBindingsFor('agent_skill_bindings', 'agent_id', agentId);
  },

  replace(agentId: string, bindings: Array<{ skillId: string; mode: SkillMode; enabled: boolean }>): void {
    replaceBindingsFor('agent_skill_bindings', 'agent_id', agentId, bindings);
  },
};

export const roomSkillBindingsRepo = {
  list(roomId: string): SkillBindingRecord[] {
    return listBindingsFor('room_skill_bindings', 'room_id', roomId);
  },

  replace(roomId: string, bindings: Array<{ skillId: string; mode: SkillMode; enabled: boolean }>): void {
    replaceBindingsFor('room_skill_bindings', 'room_id', roomId, bindings);
  },
};
