<!-- CAT-CAFE-GOVERNANCE-START -->
> Pack version: 1.3.0 | Provider: codex

## Cat Cafe Governance Rules (Auto-managed)

### Hard Constraints (immutable)
- **Public local defaults**: use frontend 7002 and API 7001 as the local runtime defaults.
- **Redis port 6399** is Cat Cafe's production Redis. Never connect to it from external projects. Use 6398 for dev/test.
- **No self-review**: The same individual cannot review their own code. Cross-family review preferred.
- **Identity is constant**: Never impersonate another cat. Identity is a hard constraint.

### Collaboration Standards
- A2A handoff uses five-tuple: What / Why / Tradeoff / Open Questions / Next Action
- Vision Guardian: Read original requirements before starting. AC completion ≠ feature complete.
- Review flow: quality-gate → request-review → receive-review → merge-gate
- Skills are available via symlinked cat-cafe-skills/ — load the relevant skill before each workflow step
- Shared rules: See cat-cafe-skills/refs/shared-rules.md for full collaboration contract

### Quality Discipline (overrides "try simplest approach first")
- **Bug: find root cause before fixing**. No guess-and-patch. Steps: reproduce → logs → call chain → confirm root cause → fix
- **Uncertain direction: stop → search → ask → confirm → then act**. Never "just try it first"
- **"Done" requires evidence** (tests pass / screenshot / logs). Bug fix = red test first, then green

### Knowledge Engineering
- Documents use YAML frontmatter (feature_ids, topics, doc_kind, created)
- Three-layer info architecture: CLAUDE.md (≤100 lines) → Skills (on-demand) → refs/
- Backlog: BACKLOG.md (hot) → Feature files (warm) → raw docs (cold)
- Feature lifecycle: kickoff → discussion → implementation → review → completion
- SOP: See docs/SOP.md for the 6-step workflow
<!-- CAT-CAFE-GOVERNANCE-END -->

## 内置数据初始化策略（Seed-once）

系统内置的 Providers、Scenes、Agents 在**首次启动时**一次性 seed，之后系统不再自动覆盖用户修改过的数据。

### 真相源

| 数据类型 | 真相源 | 注入方式 |
|----------|--------|---------|
| Providers | `backend/src/db/repositories/providers.ts` `SEEDED_PROVIDERS` | `insertIfNotExists()` |
| Scenes | `backend/src/db/migrate.ts` `ensureBuiltinScenes()` | `INSERT WHERE NOT EXISTS` |
| Agents | `.agents/skills/{id}-perspective/SKILL.md` | `agentsRepo.upsert()` 补充缺失项 |
| Shared Rules | `cat-cafe-skills/refs/shared-rules.md` | （后续通过 `scenePromptBuilder.ts` 注入，本期仅文档占位） |

### Seed 机制（`app_meta.bootstrap_seed_version`）

| DB 状态 | 行为 |
|---------|------|
| 干净 DB（agents/providers/scenes 均为空） | seed 所有内置数据，写入 `bootstrap_seed_version=1` |
| 已有历史数据（任一核心表有数据），无 meta 标记 | 仅写入 `bootstrap_seed_version=1`，不补充/修改任何已有数据 |
| 已有 `bootstrap_seed_version` | 永不重新 seed / 覆盖任何内置数据 |

### 用户修改保护

- **Providers**：`insertIfNotExists()` — 仅 key 不存在时插入，已有记录（含用户修改的 api_key / base_url）保留
- **Scenes**：`INSERT WHERE NOT EXISTS` — 已存在的 builtin scene 不被覆盖，用户可自由编辑 builtin scene prompt
- **Agents**：仅插入缺失的内置 agent，已有 agent（含用户修改的 systemPrompt）保留

### 升级场景

老用户升级新版本：不会清空/覆盖已有 agents、providers、scenes；内置 scene 只在完全不存在时才插入。

如需"恢复内置数据"，需用户提供显式操作入口（本期暂不实现）。
