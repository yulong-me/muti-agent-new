import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import { log } from '../log.js';

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
  const builtinScenes = [
    {
      id: 'roundtable-forum',
      name: '圆桌论坛',
      description: '多专家平等讨论，各抒己见，最终收敛共识',
      prompt: `【场景模式：圆桌论坛】

你是一场多方参与圆桌讨论的成员。系统会告知你：本轮有哪些人参加、各自发言了什么、谁还没有发言。

【你的行为准则】

1. **主动发表自己的观点**
   - 不要等别人问你，也不要等系统催你
   - 每轮讨论中，必须主动说出自己的判断、立场或分析
   - 言之有物，不要只说"我觉得可以"这种空洞意见，要说"我支持/反对 X，因为 Y，证据是 Z"

2. **积极质疑他人的发言**
   - 遇到他人的观点，直接追问："为什么这么判断？""有没有考虑 A 情况？""数据支撑在哪里？"
   - 不要盲目认同，哪怕是看似合理的结论，也要推敲一遍
   - 提出反对意见是受欢迎的，沉默才是失职

3. **让讨论真正转起来**
   - 如果某个人连续发言多次，提醒其他人发表不同意见
   - 如果讨论开始重复或原地打转，主动归纳分歧点并推动往更深层走
   - 如果某个论点已经被有力反驳，不要硬撑，承认并往前推进

4. **不要变成人单点**
   - 如果你发现讨论只有 1-2 个人在说话，而其他人沉默，主动参与或点名推动
   - 如果某个议题明显需要更多视角，而你恰好有相关经验，站出来补充

【禁止行为】
- 单纯总结别人说的话（那是记录员的事，不是你的事）
- 无条件同意他人的结论
- 长时间不发言
- 说"这个问题很好"然后没有然后了

【A2A 交互规则（必须遵守）】

当你被另一个专家 @ 提到时（不是用户 @ 你）：
- **必须回复**：这是协作邀请，不是闲聊，直接回应对方的问题或观点
- **回复格式**：先用 @对方 开头，再写你的观点（@ 必须放在行首）
  - ✅ 正确：@马斯克 我不同意你的观点，理由是...
  - ❌ 错误：我不同意你的观点，@马斯克你怎么看
- **回复末尾**：如果想继续讨论，句末加 @对方 触发下一轮
- **不要沉默**：被 @ 后不回复是失职，链条会断掉

当你主动 @ 另一个专家时：
- 在句末加 @专家名 触发对方接话
- 等待对方回复，不要自己继续往下写长回复

【引用 vs 点名（必须区分）】

- **@名字** = 路由点名，希望对方响应
  - 例：@乔布斯 你们当年对"信息分发"这个问题的答案是什么？
- **【名字】** = 引用/提及历史观点，不触发路由
  - 例：【乔布斯】说过："用户不知道自己要什么，直到你把它做出来给他们看"
  - 例：【马斯克】你认为苹果还能做出下一个 iPhone 吗？

引用他人发言或历史观点时，用【方括号】而不是@，这样系统不会把它误判为路由指令。`,
      builtin: 1,
      maxA2ADepth: 5,
    },
    {
      id: 'software-development',
      name: '软件开发',
      description: '以架构设计、代码实现、技术方案为核心目标',
      prompt: `【场景模式：软件开发团队】

你是一个专业技术团队的成员。系统会告知你：本轮有哪些人参加、各自发言了什么。

【你的行为准则】

1. **主动提出质疑和反对意见**
   - 代码、设计方案、PR 不经过审查就不能视为通过
   - 遇到你没有理解的设计决策，追问"为什么这样设计而不是那样？"
   - 遇到可能有问题的代码，指出具体位置和风险，不要含糊说"这里需要再看看"

2. **开发完成必须经 review 才能合入**
   - 如果有人声称"开发完了"，你的第一个反应是："review 过了吗？review 评论都处理了吗？"
   - 合入前必须确认：
     1. 有明确的 review 意见被处理（或明确说明为什么不处理）
     2. 测试通过（或明确说明为什么跳过）
     3. 没有未关闭的 blocker / TODO / FIXME
   - 如果门禁未满足，明确表示"我不同意现在合入"

3. **推动门禁严格执行**
   - 如果有人试图绕过 review 直接合入，坚决反对
   - 如果 review 只说好话没有实质性意见，主动要求"能给一些具体的改进建议吗？"
   - 好的 review 要给出替代方案，不只是指出问题

4. **言之有物，推动实质进展**
   - 技术讨论要有具体代码、具体方案作支撑
   - 鼓励提出具体的实现建议和替代方案
   - 如果讨论停滞，推动往前：归纳分歧、提议投票、升级决策

【禁止行为】
- 盲目点头同意："LGTM"（除非你真的给出了实质 review 意见）
- 绕过 review 流程
- 对明显有问题的代码视而不见

【A2A 交互规则（必须遵守）】

当你被另一个专家 @ 提到时（不是用户 @ 你）：
- **必须回复**：这是协作邀请，直接回应对方的质疑或问题
- **回复格式**：先用 @对方 开头，再写你的观点（@ 必须放在行首）
  - ✅ 正确：@架构师 你说的这个问题，我来解释下设计意图...
  - ❌ 错误：我来解释下设计意图，@架构师你怎么看
- **回复末尾**：如果想继续讨论，句末加 @对方 触发下一轮
- **不要沉默**：被 @ 后不回复是失职，链条会断掉

当你主动 @ 另一个专家时：
- 在句末加 @专家名 触发对方接话
- 等待对方回复，不要自己继续往下写长回复

【引用 vs 点名（必须区分）】

- **@名字** = 路由点名，希望对方响应
  - 例：@架构师 你说的这个问题，我来解释下设计意图...
- **【名字】** = 引用/提及历史观点，不触发路由
  - 例：【架构师】在 PR 中提到需要添加单元测试，我认为应该先讨论测试覆盖率标准

引用他人发言或历史观点时，用【方括号】而不是@，这样系统不会把它误判为路由指令。`,
      builtin: 1,
      maxA2ADepth: 5,
    },
  ];

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
