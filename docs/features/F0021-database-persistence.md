---
featId: F021
name: 数据库持久化
status: done
completed: 2026-04-11
owner: 宪宪
created: 2026-04-11
topics: [backend, database, persistence]
related:
  - F013 (审计日志)
  - F001 (Provider/Agent 配置)
---

# F021: 数据库持久化

## Problem / Why

当前所有运行时状态（Thread、Message、Session）都在内存中，进程重启后丢失。Config 虽然有 JSON 文件但缺乏 CRUD 统一接口。需要引入数据库层，支持持久化存储。

## Scope (MVP)

- **SQLite** + `better-sqlite3`（同步嵌入式，单实例最合适）
  - 选型理由：当前单 backend 进程，无并发写竞争；零运维；迁移成本低
  - 未来如需多实例部署 → 迁移到 PostgreSQL（repository 模式隔离，换 DB driver 即可）
- Thread / Message 表：持久化对话历史
- Config 表：agents.json + providers.json 迁移到 DB（CRUD 统一接口）
- Audit Log 表：F013 审计日志迁移到同一 DB
- **一次性迁移**：现有 JSON → DB，迁移后删除旧 JSON 文件
- Backend 路由统一走 DB，不再直接读写 JSON 文件
- SQLite 文件放在 `backend/data/` 目录

## Schema Design

### 表结构

```sql
-- Thread (DiscussionRoom)
CREATE TABLE rooms (
  id          TEXT PRIMARY KEY,
  topic       TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'INIT'
              CHECK (state IN ('INIT','RESEARCH','DEBATE','CONVERGING','DONE')),
  report      TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Message
CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  room_id         TEXT NOT NULL,
  agent_role      TEXT NOT NULL
                  CHECK (agent_role IN ('HOST','AGENT','USER')),
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
);

-- Agent (from agents.json)
CREATE TABLE agents (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL,
  role_label   TEXT NOT NULL,
  provider     TEXT NOT NULL,
  provider_opts TEXT NOT NULL DEFAULT '{}',
  system_prompt TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1
);

-- Provider (from providers.json)
-- ⚠️ api_key 明文存储，MVP 可接受；生产环境应加密或使用密钥管理服务
CREATE TABLE providers (
  name          TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  cli_path      TEXT NOT NULL,
  default_model TEXT NOT NULL,
  api_key       TEXT NOT NULL DEFAULT '',
  base_url      TEXT NOT NULL DEFAULT '',
  timeout       INTEGER NOT NULL DEFAULT 90,
  thinking      INTEGER NOT NULL DEFAULT 1,
  last_tested   INTEGER,
  last_test_result TEXT
);

-- Audit Log
CREATE TABLE audit_logs (
  id         TEXT PRIMARY KEY,
  timestamp  INTEGER NOT NULL,
  agent_id   TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  metadata   TEXT
);

-- Session (from DiscussionRoom.sessionIds)
CREATE TABLE sessions (
  agent_id    TEXT NOT NULL,
  room_id     TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (agent_id, room_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);
```

### 迁移 (JSON → DB)

```typescript
// backend/src/db/migrate.ts
// 启动时检测 JSON 文件是否存在 → 读取 → 写入 DB → 删除 JSON
// 迁移前自动备份：agents.json → agents.json.bak，providers.json → providers.json.bak
// 迁移成功后删除备份；迁移失败则保留备份可回滚
```

### 文件结构

```
backend/src/db/
  schema.sql      // 表定义（CHECK 约束 + 所有 DDL）
  db.ts           // better-sqlite3 单例
  migrate.ts      // JSON → DB 迁移（含备份逻辑）
  repositories/
    rooms.ts      // rooms + messages CRUD
    agents.ts     // agents CRUD
    providers.ts  // providers CRUD
    audit.ts      // audit_log CRUD
    sessions.ts   // sessions CRUD
  index.ts
```

## Acceptance Criteria

- [x] `better-sqlite3` 加入 `backend/package.json`
- [x] `npm rebuild better-sqlite3` 可正常编译（验证 native 模块可用）
- [x] `backend/data/` 加入 `.gitignore`（.db 文件不提交）
- [x] SQLite DB 在 `backend/data/muti-agent.db` 自动创建（schema.sql 执行）
- [x] `schema.sql` 文件存在且与 Markdown 一致
- [x] 迁移前自动备份 JSON → `.bak`，迁移成功后才删除备份
- [x] `/api/agents` 走 DB 不走 JSON 文件
- [x] `/api/providers` 走 DB 不走 JSON 文件
- [x] 新建 Room 时写入 DB
- [x] 新消息写入 DB（`room_id` 关联）
- [x] 审计日志写入 DB
- [x] Session IDs 持久化到 DB（含 created_at）
- [x] 所有路由可跨进程重启恢复
- [x] 进程重启后数据完整恢复（内存 → DB 替换完成）

## Dependencies

- `better-sqlite3` npm 包（native 模块，需 rebuild）
- `backend/data/` 目录需 gitignore（SQLite 文件本身不提交）

## Next

→ 开 worktree 实现
