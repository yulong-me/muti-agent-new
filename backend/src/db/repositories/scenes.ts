import { db } from '../db.js';
import type { SceneConfig } from '../../types.js';

/** Slugify a scene name into a URL-safe ID */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** Generate a unique scene ID from name, appending -2, -3, … on collision */
function generateUniqueId(name: string): string {
  let base = slugify(name) || 'scene';
  let id = base;
  let counter = 1;
  while (true) {
    const row = db.prepare('SELECT id FROM scenes WHERE id = ?').get(id) as { id: string } | undefined;
    if (!row) break;
    id = `${base}-${++counter}`;
  }
  return id;
}

/** Scenes CRUD */
export const scenesRepo = {
  list(): SceneConfig[] {
    const rows = db.prepare('SELECT * FROM scenes ORDER BY builtin DESC, name ASC').all() as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      name: r.name as string,
      description: (r.description as string) ?? undefined,
      prompt: r.prompt as string,
      builtin: Boolean(r.builtin),
      maxA2ADepth: (r.max_a2a_depth as number) ?? 5,
    }));
  },

  get(id: string): SceneConfig | undefined {
    const r = db.prepare('SELECT * FROM scenes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return {
      id: r.id as string,
      name: r.name as string,
      description: (r.description as string) ?? undefined,
      prompt: r.prompt as string,
      builtin: Boolean(r.builtin),
      maxA2ADepth: (r.max_a2a_depth as number) ?? 5,
    };
  },

  /** Create a custom scene. ID is auto-generated from name. builtin is always false. */
  create(input: { name: string; description?: string; prompt: string }): SceneConfig {
    const id = generateUniqueId(input.name);
    db.prepare(`
      INSERT INTO scenes (id, name, description, prompt, builtin, max_a2a_depth)
      VALUES (@id, @name, @description, @prompt, 0, 5)
    `).run({
      id,
      name: input.name,
      description: input.description ?? null,
      prompt: input.prompt,
    });
    return { id, name: input.name, description: input.description, prompt: input.prompt, builtin: false, maxA2ADepth: 5 };
  },

  /** Update scene fields. builtin scenes are read-only. */
  update(
    id: string,
    input: { name?: string; description?: string; prompt?: string },
  ): SceneConfig | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    if (existing.builtin) {
      return undefined;
    } else {
      // custom: name, description, prompt all editable
      db.prepare(`
        UPDATE scenes SET name = @name, description = @description, prompt = @prompt WHERE id = @id
      `).run({
        id,
        name: (input.name && input.name.trim()) ? input.name.trim() : existing.name,
        description: input.description ?? existing.description ?? null,
        prompt: input.prompt ?? existing.prompt,
      });
    }
    return this.get(id);
  },

  /**
   * Delete a scene.
   * Returns 'BUILTIN' if builtin, 'IN_USE' if any room references it, 'OK' if deleted.
   */
  delete(id: string): 'OK' | 'BUILTIN' | 'IN_USE' {
    const existing = this.get(id);
    if (!existing) return 'OK'; // already gone
    if (existing.builtin) return 'BUILTIN';

    // Check if any active room references this scene
    const usage = db.prepare(
      "SELECT COUNT(*) as cnt FROM rooms WHERE scene_id = ? AND deleted_at IS NULL"
    ).get(id) as { cnt: number };
    if (usage.cnt > 0) return 'IN_USE';

    db.prepare('DELETE FROM scenes WHERE id = ?').run(id);
    return 'OK';
  },
};
