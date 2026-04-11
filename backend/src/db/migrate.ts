import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import { log } from '../log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(process.cwd(), 'config');

/** Apply DDL schema */
export function initSchema(): void {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(sql);
  // Migration: add tags column to agents table if it doesn't exist (existing DBs)
  try {
    db.exec("ALTER TABLE agents ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
    log('INFO', 'db:schema:migrate:agents:tags');
  } catch {
    // Column already exists — safe to ignore
  }
  // Migration: update messages CHECK constraint for MANAGER/WORKER roles
  try {
    // 清理上次失败的残留表（如果存在）
    try { db.exec("DROP TABLE IF EXISTS messages_new"); } catch { /* ignore */ }

    // 检查是否需要迁移：如果存在 AGENT/HOST 数据则需要迁移
    const oldData = db.prepare("SELECT agent_role FROM messages WHERE agent_role IN ('AGENT', 'HOST') LIMIT 1").get();
    if (!oldData) {
      log('INFO', 'db:schema:migrate:messages:already_migrated');
      return;
    }

    // 安全迁移：创建新表 → 用 CASE 映射角色 → 删除旧表 → 重命名
    db.exec(`
      CREATE TABLE messages_new (
        id              TEXT PRIMARY KEY,
        room_id         TEXT NOT NULL,
        agent_role      TEXT NOT NULL
                        CHECK (agent_role IN ('MANAGER','WORKER','USER')),
        agent_name      TEXT NOT NULL,
        content         TEXT NOT NULL,
        timestamp       INTEGER NOT NULL,
        type            TEXT NOT NULL
                        CHECK (type IN ('system','statement','question','rebuttal','summary','report','user_action')),
        thinking        TEXT,
        duration_ms     INTEGER,
        total_cost_usd  REAL,
        input_tokens    INTEGER,
        output_tokens   INTEGER,
        temp_msg_id     TEXT,
        FOREIGN KEY (room_id) REFERENCES rooms(id)
      )`);
    db.exec(`
      INSERT INTO messages_new
        SELECT
          id, room_id,
          CASE agent_role
            WHEN 'AGENT' THEN 'WORKER'
            WHEN 'HOST' THEN 'MANAGER'
            ELSE agent_role
          END,
          agent_name, content, timestamp, type,
          thinking, duration_ms, total_cost_usd,
          input_tokens, output_tokens, temp_msg_id
        FROM messages`);
    db.exec("DROP TABLE messages");
    db.exec("ALTER TABLE messages_new RENAME TO messages");
    log('INFO', 'db:schema:migrate:messages:check_constraint');
  } catch (err) {
    // 迁移失败时清理残留表
    try { db.exec("DROP TABLE IF EXISTS messages_new"); } catch { /* ignore */ }
    log('WARN', 'db:schema:migrate:messages:check_constraint_failed', { reason: String(err) });
  }
  log('INFO', 'db:schema:init');
}

/** Run JSON → DB migration with backup logic */
export function migrateFromJson(): void {
  const agentsPath = path.join(CONFIG_DIR, 'agents.json');
  const providersPath = path.join(CONFIG_DIR, 'providers.json');

  let migrated = false;

  if (fs.existsSync(agentsPath)) {
    try {
      // Backup before migration
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
            role: a.role as string,
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
      // Restore backup on failure
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
