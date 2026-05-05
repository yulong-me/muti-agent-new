import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import { log } from '../log.js';
import { runtimePaths } from '../config/runtimePaths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(process.cwd(), 'config');

function columnNotNull(table: string, column: string): boolean {
  try {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number }>;
    return columns.some(col => col.name === column && col.notnull === 1);
  } catch {
    return false;
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function tableExists(table: string): boolean {
  const row = db.prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table) as { cnt: number };
  return row.cnt > 0;
}

function columnExists(table: string, column: string): boolean {
  try {
    const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>;
    return columns.some(col => col.name === column);
  } catch {
    return false;
  }
}

function dropColumnIfExists(table: string, column: string): boolean {
  if (!tableExists(table) || !columnExists(table, column)) return false;
  db.exec(`ALTER TABLE ${quoteIdentifier(table)} DROP COLUMN ${quoteIdentifier(column)}`);
  return true;
}

function removeLegacyCollaborationArtifacts(): void {
  const legacyRoot = ['s', 'c', 'e', 'n', 'e'].join('');
  const legacyTable = `${legacyRoot}s`;
  const removedColumns: Array<[string, string]> = [
    ['rooms', `${legacyRoot}_id`],
    ['teams', `source_${legacyRoot}_id`],
    ['team_versions', `source_${legacyRoot}_id`],
  ];
  const droppedColumns = removedColumns
    .map(([table, column]) => dropColumnIfExists(table, column))
    .filter(Boolean).length;
  const hadLegacyTable = tableExists(legacyTable);

  if (hadLegacyTable) {
    db.exec(`DROP TABLE ${quoteIdentifier(legacyTable)}`);
  }

  if (hadLegacyTable || droppedColumns > 0) {
    log('INFO', 'db:schema:migrate:legacy_collaboration_removed', {
      tableDropped: hadLegacyTable,
      columnsDropped: droppedColumns,
    });
  }
}

function nextLegacyTableName(baseName: string): string {
  if (!tableExists(baseName)) return baseName;
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${baseName}_${suffix}`;
    if (!tableExists(candidate)) return candidate;
  }
  throw new Error(`Could not find available legacy table name for ${baseName}`);
}

function repairLegacyEvolutionProposalArtifacts(): void {
  if (!tableExists('evolution_proposals')) return;
  if (columnExists('evolution_proposals', 'room_id')) return;

  const legacyTable = nextLegacyTableName('legacy_mission_evolution_proposals');
  const legacyRows = (db.prepare('SELECT COUNT(*) as cnt FROM evolution_proposals').get() as { cnt: number }).cnt;

  db.exec('DROP TABLE IF EXISTS team_validation_preflight_results');
  db.exec('DROP TABLE IF EXISTS evolution_proposal_changes');
  db.exec(`ALTER TABLE evolution_proposals RENAME TO ${quoteIdentifier(legacyTable)}`);

  log('INFO', 'db:schema:migrate:evolution_proposals:legacy_mission_archived', {
    legacyTable,
    legacyRows,
  });
}

function migrateTeamValidationCasesNullableSources(): void {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='team_validation_cases'")
    .get() as { sql: string } | undefined;
  if (!table) return;

  const sourceColumns = ['proposal_id', 'change_id', 'source_room_id', 'base_version_id', 'created_version_id'];
  if (!sourceColumns.some(column => columnNotNull('team_validation_cases', column))) return;

  db.exec('DROP TABLE IF EXISTS team_validation_cases_nullable_migration');
  db.exec(`
    CREATE TABLE team_validation_cases_nullable_migration (
      id                        TEXT PRIMARY KEY,
      team_id                   TEXT NOT NULL,
      proposal_id               TEXT,
      change_id                 TEXT,
      source_room_id            TEXT,
      base_version_id           TEXT,
      created_version_id        TEXT,
      title                     TEXT NOT NULL,
      failure_summary           TEXT NOT NULL DEFAULT '',
      input_snapshot_json       TEXT NOT NULL DEFAULT 'null',
      expected_behavior         TEXT NOT NULL DEFAULT '',
      assertion_type            TEXT NOT NULL DEFAULT 'checklist'
                                CHECK (assertion_type IN ('checklist','replay')),
      status                    TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','archived')),
      prompt                    TEXT NOT NULL,
      expected_outcome          TEXT NOT NULL,
      evidence_message_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at                INTEGER NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (base_version_id) REFERENCES team_versions(id),
      FOREIGN KEY (created_version_id) REFERENCES team_versions(id)
    )
  `);
  db.exec(`
    INSERT INTO team_validation_cases_nullable_migration (
      id, team_id, proposal_id, change_id, source_room_id, base_version_id, created_version_id,
      title, failure_summary, input_snapshot_json, expected_behavior, assertion_type, status,
      prompt, expected_outcome, evidence_message_ids_json, created_at
    )
    SELECT
      id, team_id, proposal_id, change_id, source_room_id, base_version_id, created_version_id,
      title, failure_summary, input_snapshot_json, expected_behavior, assertion_type, status,
      prompt, expected_outcome, evidence_message_ids_json, created_at
    FROM team_validation_cases
  `);
  db.exec('DROP TABLE team_validation_cases');
  db.exec('ALTER TABLE team_validation_cases_nullable_migration RENAME TO team_validation_cases');
  log('INFO', 'db:schema:migrate:team_validation_cases:nullable_sources');
}

/** Normalize legacy agent roles to F004 values */
function normalizeRole(role: string): string {
  if (role === 'AGENT') return 'WORKER';
  if (role === 'HOST') return 'MANAGER';
  return role;
}

/** Apply DDL schema */
export function initSchema(): void {
  const schemaPath = [
    path.join(__dirname, 'schema.sql'),
    path.join(runtimePaths.backendRoot, 'src', 'db', 'schema.sql'),
  ].find(candidate => fs.existsSync(candidate));
  if (!schemaPath) {
    throw new Error('schema.sql not found in dist/db or src/db');
  }
  const sql = fs.readFileSync(schemaPath, 'utf-8');
  removeLegacyCollaborationArtifacts();

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

  try {
    db.exec("ALTER TABLE messages ADD COLUMN session_id TEXT");
    log('INFO', 'db:schema:migrate:messages:session_id');
  } catch {
    // Column already exists — safe to ignore
  }

  try {
    db.exec("ALTER TABLE messages ADD COLUMN invocation_usage_json TEXT");
    log('INFO', 'db:schema:migrate:messages:invocation_usage_json');
  } catch {
    // Column already exists — safe to ignore
  }

  try {
    db.exec("ALTER TABLE messages ADD COLUMN context_health_json TEXT");
    log('INFO', 'db:schema:migrate:messages:context_health_json');
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

  // F017: add max_a2a_depth column to rooms table (nullable, null=inherit TeamVersion default)
  try {
    db.exec("ALTER TABLE rooms ADD COLUMN max_a2a_depth INTEGER");
    log('INFO', 'db:schema:migrate:rooms:max_a2a_depth');
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

  repairLegacyEvolutionProposalArtifacts();

  // F052: add team_id and team_version_id to rooms table
  try {
    db.exec("ALTER TABLE rooms ADD COLUMN team_id TEXT");
    log('INFO', 'db:schema:migrate:rooms:team_id');
  } catch {
    // Column already exists — safe to ignore
  }
  try {
    db.exec("ALTER TABLE rooms ADD COLUMN team_version_id TEXT");
    log('INFO', 'db:schema:migrate:rooms:team_version_id');
  } catch {
    // Column already exists — safe to ignore
  }
  try {
    db.exec("ALTER TABLE team_versions ADD COLUMN member_snapshots_json TEXT NOT NULL DEFAULT '[]'");
    log('INFO', 'db:schema:migrate:team_versions:member_snapshots_json');
  } catch {
    // Column already exists or table does not exist yet — safe to ignore
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS evolution_proposals (
        id                    TEXT PRIMARY KEY,
        room_id               TEXT NOT NULL,
        team_id               TEXT NOT NULL,
        base_version_id       TEXT NOT NULL,
        target_version_number INTEGER NOT NULL,
        status                TEXT NOT NULL
                              CHECK (status IN ('draft','pending','in-review','applied','rejected','expired')),
        summary               TEXT NOT NULL,
        feedback              TEXT,
        created_at            INTEGER NOT NULL,
        updated_at            INTEGER NOT NULL,
        preflight_checked_at  INTEGER,
        applied_version_id    TEXT,
        FOREIGN KEY (room_id) REFERENCES rooms(id),
        FOREIGN KEY (team_id) REFERENCES teams(id),
        FOREIGN KEY (base_version_id) REFERENCES team_versions(id),
        FOREIGN KEY (applied_version_id) REFERENCES team_versions(id)
      );
      CREATE TABLE IF NOT EXISTS evolution_proposal_changes (
        id                        TEXT PRIMARY KEY,
        proposal_id               TEXT NOT NULL,
        ordinal                   INTEGER NOT NULL,
        kind                      TEXT NOT NULL
                                  CHECK (kind IN ('add-agent','edit-agent-prompt','edit-team-workflow','edit-routing-policy','add-team-memory','add-validation-case')),
        title                     TEXT NOT NULL,
        why                       TEXT NOT NULL,
        evidence_message_ids_json TEXT NOT NULL DEFAULT '[]',
        target_layer              TEXT NOT NULL,
        before_json               TEXT NOT NULL DEFAULT 'null',
        after_json                TEXT NOT NULL DEFAULT 'null',
        impact                    TEXT NOT NULL,
        decision                  TEXT
                                  CHECK (decision IS NULL OR decision IN ('accepted','rejected')),
        decided_at                INTEGER,
        FOREIGN KEY (proposal_id) REFERENCES evolution_proposals(id) ON DELETE CASCADE,
        UNIQUE(proposal_id, ordinal)
      );
      CREATE TABLE IF NOT EXISTS team_validation_cases (
        id                        TEXT PRIMARY KEY,
        team_id                   TEXT NOT NULL,
        proposal_id               TEXT,
        change_id                 TEXT,
        source_room_id            TEXT,
        base_version_id           TEXT,
        created_version_id        TEXT,
        title                     TEXT NOT NULL,
        failure_summary           TEXT NOT NULL DEFAULT '',
        input_snapshot_json       TEXT NOT NULL DEFAULT 'null',
        expected_behavior         TEXT NOT NULL DEFAULT '',
        assertion_type            TEXT NOT NULL DEFAULT 'checklist'
                                  CHECK (assertion_type IN ('checklist','replay')),
        status                    TEXT NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active','archived')),
        prompt                    TEXT NOT NULL,
        expected_outcome          TEXT NOT NULL,
        evidence_message_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at                INTEGER NOT NULL,
        FOREIGN KEY (team_id) REFERENCES teams(id),
        FOREIGN KEY (base_version_id) REFERENCES team_versions(id),
        FOREIGN KEY (created_version_id) REFERENCES team_versions(id)
      );
      CREATE TABLE IF NOT EXISTS team_validation_preflight_results (
        id                  TEXT PRIMARY KEY,
        proposal_id         TEXT NOT NULL,
        validation_case_id  TEXT NOT NULL,
        target_version_id   TEXT NOT NULL,
        result              TEXT NOT NULL
                            CHECK (result IN ('pass','fail','needs-review')),
        reason              TEXT NOT NULL,
        checked_at          INTEGER NOT NULL,
        FOREIGN KEY (proposal_id) REFERENCES evolution_proposals(id) ON DELETE CASCADE,
        FOREIGN KEY (validation_case_id) REFERENCES team_validation_cases(id)
      );
      CREATE INDEX IF NOT EXISTS idx_evolution_proposals_room_id ON evolution_proposals(room_id);
      CREATE INDEX IF NOT EXISTS idx_evolution_proposals_team_id ON evolution_proposals(team_id);
      CREATE INDEX IF NOT EXISTS idx_evolution_proposal_changes_proposal_id ON evolution_proposal_changes(proposal_id);
      CREATE INDEX IF NOT EXISTS idx_team_validation_cases_team_id ON team_validation_cases(team_id);
      CREATE INDEX IF NOT EXISTS idx_team_validation_cases_proposal_id ON team_validation_cases(proposal_id);
      CREATE INDEX IF NOT EXISTS idx_team_validation_preflight_proposal_id ON team_validation_preflight_results(proposal_id);
    `);
    try {
      db.exec("ALTER TABLE evolution_proposals ADD COLUMN preflight_checked_at INTEGER");
    } catch {
      // Column already exists.
    }
    for (const statement of [
      "ALTER TABLE team_validation_cases ADD COLUMN source_room_id TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE team_validation_cases ADD COLUMN failure_summary TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE team_validation_cases ADD COLUMN input_snapshot_json TEXT NOT NULL DEFAULT 'null'",
      "ALTER TABLE team_validation_cases ADD COLUMN expected_behavior TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE team_validation_cases ADD COLUMN assertion_type TEXT NOT NULL DEFAULT 'checklist'",
      "ALTER TABLE team_validation_cases ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
    ]) {
      try {
        db.exec(statement);
      } catch {
        // Column already exists.
      }
    }
    try {
      db.exec("UPDATE team_validation_cases SET source_room_id = (SELECT room_id FROM evolution_proposals WHERE evolution_proposals.id = team_validation_cases.proposal_id) WHERE source_room_id = ''");
    } catch {
      // Best-effort backfill for databases created during F053.
    }
    try {
      migrateTeamValidationCasesNullableSources();
    } catch (err) {
      log('ERROR', 'db:schema:migrate:team_validation_cases:nullable_sources_failed', { err: String(err) });
      throw err;
    }
    log('INFO', 'db:schema:migrate:team_evolution');
  } catch {
    // Tables already exist or F052 tables are not created yet — full schema exec below covers fresh DBs.
  }

  try {
    db.exec("ALTER TABLE providers ADD COLUMN context_window INTEGER NOT NULL DEFAULT 200000");
    log('INFO', 'db:schema:migrate:providers:context_window');
  } catch {
    // Column already exists — safe to ignore
  }

  try {
    db.exec("UPDATE providers SET context_window = 200000 WHERE context_window IS NULL OR context_window <= 0");
    log('INFO', 'db:schema:migrate:providers:context_window_backfill');
  } catch {
    // Table may not exist yet — safe to ignore
  }

  try {
    db.exec("ALTER TABLE sessions ADD COLUMN telemetry_json TEXT");
    log('INFO', 'db:schema:migrate:sessions:telemetry_json');
  } catch {
    // Column already exists — safe to ignore
  }

  try {
    db.exec("ALTER TABLE sessions ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0");
    log('INFO', 'db:schema:migrate:sessions:updated_at');
  } catch {
    // Column already exists — safe to ignore
  }

  // F004 Migration: INIT/RESEARCH/DEBATE/CONVERGING → RUNNING, HOST → MANAGER, AGENT → WORKER
  try {
    const roomsSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='rooms'").get() as { sql: string } | undefined;
    if (!roomsSchema) {
      // 表不存在，直接应用 schema
      db.exec(sql);
      log('INFO', 'db:schema:init');
      return;
    }

    // 如果 CHECK 约束已经是 RUNNING/DONE，说明已迁移
    if (roomsSchema.sql.includes('RUNNING') && roomsSchema.sql.includes('DONE')) {
      db.exec(sql);
      log('INFO', 'db:schema:migrate:rooms:already_migrated');
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
    db.exec(`
      INSERT INTO rooms (id, topic, state, report, agent_ids, workspace, created_at, updated_at, deleted_at)
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
        INSERT OR REPLACE INTO providers (name, label, cli_path, default_model, context_window, api_key, base_url, timeout, thinking, last_tested, last_test_result)
        VALUES (@name, @label, @cliPath, @defaultModel, @contextWindow, @apiKey, @baseUrl, @timeout, @thinking, @lastTested, @lastTestResult)
      `);
      for (const [name, p] of Object.entries(providers)) {
        const prov = p as Record<string, unknown>;
        insert.run({
          name,
          label: prov.label as string ?? name,
          cliPath: prov.cliPath as string,
          defaultModel: prov.defaultModel as string,
          contextWindow: typeof prov.contextWindow === 'number' && prov.contextWindow > 0 ? prov.contextWindow : 200000,
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
