import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import { log } from '../log.js';
import { BUILTIN_SCENES } from '../prompts/builtinScenes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(process.cwd(), 'config');

/** Normalize legacy agent roles to F004 values */
function normalizeRole(role: string): string {
  if (role === 'AGENT') return 'WORKER';
  if (role === 'HOST') return 'MANAGER';
  return role;
}

/** Apply DDL schema */
export function initSchema(): void {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');

  // Check if tables exist (new users may have empty DB)
  const agentsExists = (db.prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='agents'").get() as { cnt: number }).cnt > 0;

  if (agentsExists) {
    // Migration: add tags column to agents table if it doesn't exist (existing DBs)
    try {
      db.exec("ALTER TABLE agents ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
      log('INFO', 'db:schema:migrate:agents:tags');
    } catch {
      // Column already exists — safe to ignore
    }

    // Normalize existing agent roles: AGENT→WORKER, HOST→MANAGER
    db.exec("UPDATE agents SET role = 'WORKER' WHERE role = 'AGENT'");
    db.exec("UPDATE agents SET role = 'MANAGER' WHERE role = 'HOST'");
    log('INFO', 'db:schema:migrate:agents:role_normalized');

    // Startup warning: check for any remaining legacy roles
    const legacy = db.prepare("SELECT COUNT(*) as cnt FROM agents WHERE role IN ('AGENT','HOST')").get() as { cnt: number };
    if (legacy.cnt > 0) {
      log('WARN', `db:agents:legacy_roles_remaining=${legacy.cnt}`);
    }
  }

  // Migration: add agent_ids column to rooms table for persistent agent membership
  try {
    db.exec("ALTER TABLE rooms ADD COLUMN agent_ids TEXT NOT NULL DEFAULT '[]'");
    log('INFO', 'db:schema:migrate:rooms:agent_ids');
  } catch {
    // Column already exists — safe to ignore
  }

  // F0042 Migration: add to_agent_id column to messages table (nullable, backward compat)
  try {
    db.exec("ALTER TABLE messages ADD COLUMN to_agent_id TEXT");
    log('INFO', 'db:schema:migrate:messages:to_agent_id');
  } catch {
    // Column already exists — safe to ignore
  }

  // F014 Migration: persist structured run errors so reconnect/poll can recover UI state.
  try {
    db.exec("ALTER TABLE messages ADD COLUMN run_error_json TEXT");
    log('INFO', 'db:schema:migrate:messages:run_error_json');
  } catch {
    // Column already exists — safe to ignore
  }

  // Tool calls are part of replayable agent messages, not transient socket-only state.
  try {
    db.exec("ALTER TABLE messages ADD COLUMN tool_calls_json TEXT");
    log('INFO', 'db:schema:migrate:messages:tool_calls_json');
  } catch {
    // Column already exists — safe to ignore
  }

  // Soft delete: add deleted_at column to rooms table
  try {
    db.exec("ALTER TABLE rooms ADD COLUMN deleted_at INTEGER");
    log('INFO', 'db:schema:migrate:rooms:deleted_at');
  } catch {
    // Column already exists — safe to ignore
  }

  // F006: add workspace column to rooms table
  try {
    db.exec("ALTER TABLE rooms ADD COLUMN workspace TEXT");
    log('INFO', 'db:schema:migrate:rooms:workspace');
  } catch {
    // Column already exists — safe to ignore
  }

  // F016: add scene_id column to rooms table
  try {
    db.exec("ALTER TABLE rooms ADD COLUMN scene_id TEXT NOT NULL DEFAULT 'roundtable-forum'");
    log('INFO', 'db:schema:migrate:rooms:scene_id');
  } catch {
    // Column already exists — safe to ignore
  }

  // F016/F016-FIX: add description column to scenes table (may have been created before this column existed)
  try {
    db.exec("ALTER TABLE scenes ADD COLUMN description TEXT");
    log('INFO', 'db:schema:migrate:scenes:description');
  } catch {
    // Column already exists — safe to ignore
  }

  // F017: add max_a2a_depth column to rooms table (nullable, null=inherit scene default)
  try {
    db.exec("ALTER TABLE rooms ADD COLUMN max_a2a_depth INTEGER");
    log('INFO', 'db:schema:migrate:rooms:max_a2a_depth');
  } catch {
    // Column already exists — safe to ignore
  }

  // F017: add max_a2a_depth column to scenes table (default 5)
  try {
    db.exec("ALTER TABLE scenes ADD COLUMN max_a2a_depth INTEGER DEFAULT 5 NOT NULL");
    log('INFO', 'db:schema:migrate:scenes:max_a2a_depth');
  } catch {
    // Column already exists — safe to ignore
  }

  // Seed-once: add app_meta table (stores bootstrap_seed_version to prevent re-seeding on restart)
  try {
    db.exec("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    log('INFO', 'db:schema:migrate:app_meta');
  } catch {
    // Table already exists — safe to ignore
  }

  // F004 Migration: INIT/RESEARCH/DEBATE/CONVERGING → RUNNING, HOST → MANAGER, AGENT → WORKER
  try {
    const roomsSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='rooms'").get() as { sql: string } | undefined;
    if (!roomsSchema) {
      // 表不存在，直接应用 schema
      db.exec(sql);
      log('INFO', 'db:schema:init');
      // Builtin scene seed is now handled in index.ts's initDB() bootstrap block (protected by app_meta)
      return;
    }

    // 如果 CHECK 约束已经是 RUNNING/DONE，说明已迁移
    if (roomsSchema.sql.includes('RUNNING') && roomsSchema.sql.includes('DONE')) {
      db.exec(sql);
      log('INFO', 'db:schema:migrate:rooms:already_migrated');
      // Builtin scene seed is now handled in index.ts's initDB() bootstrap block (protected by app_meta)
      return;
    }

    // 旧 schema 检测到：迁移数据 → 重建表
    log('INFO', 'db:schema:migrate:rooms:detected_old_schema');

    // 备份旧数据到临时表
    db.exec("DROP TABLE IF EXISTS rooms_backup");
    db.exec("DROP TABLE IF EXISTS messages_backup");
    db.exec("CREATE TABLE rooms_backup AS SELECT * FROM rooms");
    db.exec("CREATE TABLE messages_backup AS SELECT * FROM messages");

    // 重建 rooms 和 messages 表（先 messages 再 rooms，因 messages.room_id → rooms.id）
    db.exec("DROP TABLE IF EXISTS messages");
    db.exec("DROP TABLE IF EXISTS rooms");
    db.exec(sql);

    // 迁移 rooms 数据: INIT/RESEARCH/DEBATE/CONVERGING → RUNNING, DONE → DONE
    // agent_ids: 旧 room 无存储，回填 ["host"]（主持人必定在）
    // deleted_at: 旧 room 全部为 NULL（未归档）
    // scene_id: 旧 room 统一回填为 roundtable-forum
    db.exec(`
      INSERT INTO rooms (id, topic, state, report, agent_ids, workspace, scene_id, created_at, updated_at, deleted_at)
      SELECT
        id, topic,
        CASE state
          WHEN 'INIT' THEN 'RUNNING'
          WHEN 'RESEARCH' THEN 'RUNNING'
          WHEN 'DEBATE' THEN 'RUNNING'
          WHEN 'CONVERGING' THEN 'RUNNING'
          ELSE state
        END,
        report,
        '["host"]',
        NULL,
        'roundtable-forum',
        created_at, updated_at,
        NULL
      FROM rooms_backup`);

    // 迁移 messages 数据: HOST → MANAGER, AGENT → WORKER, 移除 temp_msg_id 列
    db.exec(`
      INSERT INTO messages (id, room_id, agent_role, agent_name, content, timestamp, type, thinking, duration_ms, total_cost_usd, input_tokens, output_tokens)
      SELECT
        id, room_id,
        CASE agent_role
          WHEN 'HOST' THEN 'MANAGER'
          WHEN 'AGENT' THEN 'WORKER'
          ELSE agent_role
        END,
        agent_name, content, timestamp, type, thinking, duration_ms, total_cost_usd, input_tokens, output_tokens
      FROM messages_backup`);

    // 清理临时表
    db.exec("DROP TABLE rooms_backup");
    db.exec("DROP TABLE messages_backup");

    log('INFO', 'db:schema:migrate:rooms:migrated');
  } catch (err) {
    // 迁移失败时从备份恢复，不丢失数据
    try {
      db.exec("DROP TABLE IF EXISTS rooms");
      db.exec("DROP TABLE IF EXISTS messages");
      db.exec("CREATE TABLE rooms AS SELECT * FROM rooms_backup");
      db.exec("CREATE TABLE messages AS SELECT * FROM messages_backup");
      db.exec("DROP TABLE rooms_backup");
      db.exec("DROP TABLE messages_backup");
      log('WARN', 'db:schema:migrate:rooms:rolled_back', { reason: String(err) });
    } catch (restoreErr) {
      log('ERROR', 'db:schema:migrate:rooms:restore_failed', { migrateErr: String(err), restoreErr: String(restoreErr) });
    }
  }

  // NOTE: builtin scene seeding is now handled by ensureBuiltinScenes() in initDB()'s
  // bootstrap block (protected by app_meta.bootstrap_seed_version). It is NOT called
  // unconditionally here any more, to avoid resurrecting deleted builtin scenes on restart.
}

/** Run JSON → DB migration with backup logic */
export function migrateFromJson(): void {
  const agentsPath = path.join(CONFIG_DIR, 'agents.json');
  const providersPath = path.join(CONFIG_DIR, 'providers.json');

  let migrated = false;

  if (fs.existsSync(agentsPath)) {
    try {
      fs.copyFileSync(agentsPath, agentsPath + '.bak');
      log('INFO', 'db:migrate:agents:backup', { path: agentsPath + '.bak' });

      const agents = JSON.parse(fs.readFileSync(agentsPath, 'utf-8')) as Record<string, unknown>[];
      const insert = db.prepare(`
        INSERT OR REPLACE INTO agents (id, name, role, role_label, provider, provider_opts, system_prompt, enabled)
        VALUES (@id, @name, @role, @roleLabel, @provider, @providerOpts, @systemPrompt, @enabled)
      `);
      const insertMany = db.transaction((items: Record<string, unknown>[]) => {
        for (const a of items) {
          insert.run({
            id: a.id as string,
            name: a.name as string,
            role: normalizeRole(a.role as string),
            roleLabel: (a.roleLabel ?? a.name) as string,
            provider: a.provider as string,
            providerOpts: JSON.stringify(a.providerOpts ?? {}),
            systemPrompt: a.systemPrompt as string,
            enabled: (a.enabled ?? true) ? 1 : 0,
          });
        }
      });
      insertMany(agents);
      fs.unlinkSync(agentsPath);
      fs.unlinkSync(agentsPath + '.bak');
      log('INFO', 'db:migrate:agents:done', { count: agents.length });
      migrated = true;
    } catch (err) {
      const bak = agentsPath + '.bak';
      if (fs.existsSync(bak)) {
        fs.copyFileSync(bak, agentsPath);
        log('ERROR', 'db:migrate:agents:rollback', { error: String(err) });
      }
      throw err;
    }
  }

  if (fs.existsSync(providersPath)) {
    try {
      fs.copyFileSync(providersPath, providersPath + '.bak');
      log('INFO', 'db:migrate:providers:backup', { path: providersPath + '.bak' });

      const providers = JSON.parse(fs.readFileSync(providersPath, 'utf-8')) as Record<string, unknown>;
      const insert = db.prepare(`
        INSERT OR REPLACE INTO providers (name, label, cli_path, default_model, api_key, base_url, timeout, thinking, last_tested, last_test_result)
        VALUES (@name, @label, @cliPath, @defaultModel, @apiKey, @baseUrl, @timeout, @thinking, @lastTested, @lastTestResult)
      `);
      for (const [name, p] of Object.entries(providers)) {
        const prov = p as Record<string, unknown>;
        insert.run({
          name,
          label: prov.label as string ?? name,
          cliPath: prov.cliPath as string,
          defaultModel: prov.defaultModel as string,
          apiKey: prov.apiKey as string ?? '',
          baseUrl: prov.baseUrl as string ?? '',
          timeout: prov.timeout as number ?? 90,
          thinking: prov.thinking !== false ? 1 : 0,
          lastTested: prov.lastTested as number | null,
          lastTestResult: prov.lastTestResult ? JSON.stringify(prov.lastTestResult) : null,
        });
      }
      fs.unlinkSync(providersPath);
      fs.unlinkSync(providersPath + '.bak');
      log('INFO', 'db:migrate:providers:done', { count: Object.keys(providers).length });
      migrated = true;
    } catch (err) {
      const bak = providersPath + '.bak';
      if (fs.existsSync(bak)) {
        fs.copyFileSync(bak, providersPath);
        log('ERROR', 'db:migrate:providers:rollback', { error: String(err) });
      }
      throw err;
    }
  }

  if (!migrated) {
    log('INFO', 'db:migrate:skip', { reason: 'no json files found' });
  }
}

// F016: Seed builtin scenes if they don't exist (idempotent)
export function ensureBuiltinScenes(): void {
  const builtinScenes = BUILTIN_SCENES;

  // Seed-once: INSERT ... WHERE NOT EXISTS — do NOT overwrite user-edited builtin scenes
  const insertIfNotExists = db.prepare(`
    INSERT INTO scenes (id, name, description, prompt, builtin, max_a2a_depth)
    SELECT @id, @name, @description, @prompt, @builtin, @maxA2ADepth
    WHERE NOT EXISTS (SELECT 1 FROM scenes WHERE id = @id)
  `);

  for (const scene of builtinScenes) {
    try {
      insertIfNotExists.run(scene);
      log('INFO', 'db:scene:seed', { id: scene.id, name: scene.name, action: 'inserted' });
    } catch (err) {
      log('WARN', 'db:scene:seed:failed', { id: scene.id, error: String(err) });
    }
  }
}
