---
feature_ids: [F016]
related_features: [F003, F010, F012]
topics: [scene, prompt, room-config, settings, multi-agent]
doc_kind: spec
created: 2026-04-16
updated: 2026-04-20
---

# F016: 讨论室场景（Room Scenes: 内置场景 + Prompt 注入）

> Status: done | Owner: codex | Completed: 2026-04-20

## Changelog

- 2026-04-20: 补齐从 CreateRoomModal 直达场景管理的入口，支持 `/settings?tab=scene&returnTo=...` deeplink，并收口 feature 生命周期

## Why

当前系统里的 Agent 只有一层 `systemPrompt`，这会带来三个问题：

1. **缺少统一上下文层**：同一类工作方式（例如圆桌讨论、软件开发）需要全体参与专家遵守同一套协作规则，但现在只能分别修改每个 Agent prompt，难以统一管理。
2. **Agent 状态膨胀**：如果把“场景”挂在 Agent 上，同一个专家会被迫衍生出多个配置变体（例如 `PG-圆桌`、`PG-开发`），或者频繁修改现有 Agent。
3. **房间语义不清**：一次讨论本质上只有一个会议模式。若让不同 Agent 带着不同场景进入同一房间，会造成交互模式冲突。

因此需要引入新的配置实体：**Scene**。Scene 是一段可维护的 prompt 前缀，绑定在 **Room** 上，并在每次 Room 内 Agent 执行前统一注入。

## Decision Summary

本 Feature 明确采用以下决策：

1. **Scene 挂在 Room 上，不挂在 Agent 上**
2. **系统内置两个 Scene**：`roundtable-forum`、`software-development`
3. **每个 Room 创建时必须确定一个 Scene**，默认 `roundtable-forum`
4. **每次 Agent 执行前**，按 `Scene Prompt -> Action/Agent Prompt -> Runtime Context` 组装有效系统提示
5. **内置 Scene 不可删除、不可改 ID、不可改名称，但允许改 prompt/description**
6. **自定义 Scene 的 ID 由后端生成 slug 并冻结，不允许前端手填或后续编辑**
7. **自定义 Scene 被 Room 引用时禁止删除**，返回 `409 SCENE_IN_USE`，不做静默回退

## Scene 类型定义

### SceneConfig

```ts
interface SceneConfig {
  id: string
  name: string
  description?: string
  prompt: string
  builtin: boolean
}
```

字段语义：

- `id`: 稳定标识，用于数据库引用与 API 路径
- `name`: 用户可见名称
- `description`: 可选说明，用于设置页辅助解释
- `prompt`: 场景 prompt 正文
- `builtin`: 是否为系统内置场景

### builtin 规则

当 `builtin: true` 时：

- `id`：**不可编辑**
- `name`：**不可编辑**
- `prompt`：**允许编辑**
- `description`：**允许编辑**
- `DELETE`：**永久禁止**

当 `builtin: false` 时：

- `id`：创建后不可编辑
- `name`：允许编辑
- `description`：允许编辑
- `prompt`：允许编辑
- `DELETE`：若未被任何 Room 引用则允许

### 内置 Scene 常量

系统保留以下固定 ID：

```ts
const BUILTIN_SCENE_IDS = {
  ROUNDTABLE_FORUM: 'roundtable-forum',
  SOFTWARE_DEVELOPMENT: 'software-development',
} as const
```

对应默认数据：

1. `roundtable-forum` / `圆桌论坛`
2. `software-development` / `软件开发`

这些 ID 一经发布即冻结，后续只允许改 `prompt` 和 `description`，不允许改 ID 或名称。

### 自定义 Scene ID 生成方式

自定义 Scene 的 `id` 由后端在创建时自动生成：

- 规则：根据 `name` 生成 slug
- 示例：`Tech Review` -> `tech-review`
- 若冲突：自动追加递增后缀，如 `tech-review-2`

前端不提供 ID 输入框，避免引用不稳定或命名冲突。

## 核心模型

### Room 持有 scene_id

```ts
interface DiscussionRoom {
  id: string
  topic: string
  sceneId: string
  ...
}
```

原则：

- Room 是“本次会议/任务”的载体，因此持有 `sceneId`
- Agent 仍只表达“专家身份与常驻 prompt”
- 同一个 Agent 可以在不同 Room 中被不同 Scene 复用

### Agent 不引入 sceneId

本 Feature 不在 `AgentConfig` 中引入 `sceneId`。

如果某些本地开发库里已经存在试验性的 `agents.scene_id` 列：

- **不作为真相源**
- 应用不读、不写该列
- 本期不负责清理该遗留列，只在文档中明确其无效

## Prompt 组装规则

每次 Agent 真正执行前，有效系统提示统一按以下顺序组装：

```text
Scene Prompt
+ Action / Agent Prompt
+ Runtime Context
```

解释：

### 1. Scene Prompt

由 Room 的 `sceneId` 对应的 Scene 提供，定义本次会议模式。

### 2. Action / Agent Prompt

这是“当前动作”的基础 prompt，来源可能有两类：

- Agent 自身 `systemPrompt`
- 系统动作 prompt，例如报告生成、总结、主持性收敛等

它不是 Scene 的替代，而是 Scene 约束下的角色/动作描述。

### 3. Runtime Context

本 Feature 对 Runtime Context 的定义如下：

- `【工作目录】...`（若当前链路已提供）
- 当前用户输入 / 当前被路由的任务文本
- 当前房间已有对话上下文（完整 transcript 或已有机制产出的摘要）
- 路由附带信息，如目标专家、toAgentId、A2A 调用链等

**不包含** Scene Prompt 本身，因为 Scene Prompt 已经在最前层统一注入。

## Inline Report / 系统动作处理方案

当前 `stateMachine.ts` 中的 Inline Report / Summary 类逻辑可能直接拼接硬编码 prompt。  
本 Feature 不要求“所有动作 prompt 消失”，而要求它们**不再绕过 Scene 层**。

明确方案：

1. 保留系统动作 prompt 的存在是允许的，例如：
   - `GENERATE_REPORT`
   - `SUMMARIZE_DISCUSSION`
   - 其他主持性系统动作
2. 这些 prompt 只能作为 **Action Prompt** 传入统一组装器
3. 最终系统提示必须经过统一函数，例如：

```ts
buildRoomScopedSystemPrompt({
  roomId,
  basePrompt,   // Agent prompt 或系统动作 prompt
  runtimeContext,
})
```

结论：

- **Scene 必须覆盖 Inline Report 路径**
- AC 不再表述为“所有硬编码移除”
- AC 改为“所有执行路径都必须先经过 Scene 组装器，硬编码 prompt 不能直接成为最终 system prompt”

## API 设计

### GET /api/scenes

用途：获取所有 Scene 列表

返回：

```ts
type SceneListItem = {
  id: string
  name: string
  description?: string
  prompt: string
  builtin: boolean
  canDelete: boolean
  canEditPrompt: boolean
  canEditName: boolean
}
```

规则：

- builtin Scene 返回 `canDelete: false`
- builtin Scene 返回 `canEditName: false`
- builtin Scene 返回 `canEditPrompt: true`

### POST /api/scenes

用途：创建自定义 Scene

请求：

```json
{
  "name": "代码走查",
  "description": "更强调 review、风险和改动边界",
  "prompt": "..."
}
```

规则：

- 前端不可传 `id`
- 前端不可传 `builtin: true`
- 后端强制创建为 `builtin: false`
- 后端生成稳定 slug 作为 `id`

成功返回 `201` + 完整 SceneConfig

### PUT /api/scenes/:id

用途：编辑 Scene

请求：

```json
{
  "description": "可选",
  "prompt": "...",
  "name": "仅自定义 Scene 可改"
}
```

规则：

- builtin Scene：只允许改 `prompt`、`description`
- custom Scene：允许改 `name`、`prompt`、`description`
- 无论 builtin/custom，`id` 都不可变

错误：

- `404 Scene not found`
- `400 Invalid payload`
- `403 BUILTIN_NAME_LOCKED`（尝试修改 builtin 的 name）

### DELETE /api/scenes/:id

用途：删除自定义 Scene

规则：

- builtin Scene：返回 `403 BUILTIN_SCENE`
- 若有任一 Room 正在引用该 Scene：返回 `409 SCENE_IN_USE`
- 不做自动回退为默认 Scene
- 不做级联修改 Room

这是本 Feature 的明确删除语义，避免静默改变历史 Room 行为。

## 数据与迁移策略

### 存储

新增独立 Scene 存储，例如：

- `scenes` 表
- 字段：`id`, `name`, `description`, `prompt`, `builtin`

`rooms` 表新增：

- `scene_id TEXT NOT NULL DEFAULT 'roundtable-forum'`

### 迁移落点

迁移逻辑统一落在：

- `backend/src/db/migrate.ts`

具体放在现有 `initSchema()` 的增量迁移分支中，沿用当前仓库已经在使用的**幂等式迁移风格**：

- `ALTER TABLE ... ADD COLUMN ...`，若已存在则忽略
- 启动时补齐默认值和回填

### 是否引入 migration_id

本 Feature **不引入新的 migration_id / schema_versions 表**。  
原因：当前仓库尚未建立版本化迁移框架，本期继续沿用现有“幂等列迁移 + 启动补齐”的模式。

文档要求实现时做到：

1. `rooms.scene_id` 不存在时新增
2. 旧 `rooms` 数据统一回填 `roundtable-forum`
3. 启动时确保两个 builtin Scene 存在
4. 迁移重复执行不应报错

### 关于“旧 Room 数据迁移”

这里的“旧 Room 数据”专指：

- 已落库在 SQLite 的历史 `rooms`

不涉及：

- Agent JSON 配置迁移
- Room 导出/导入格式演进

## Frontend 设计

### Settings Modal：Scene 管理 Tab

新增独立 `Scene` Tab，不把 Scene 混进 Agent 编辑表单。

建议交互：

1. 左侧列表 / 表格：
   - 名称
   - builtin 标识
   - 简短 description
2. 右侧编辑面板：
   - `name`
   - `description`
   - `prompt`
   - 删除按钮

规则：

- builtin Scene 显示 `内置` badge
- builtin Scene 的删除按钮禁用
- builtin Scene 的名称输入框禁用
- builtin Scene 的 prompt 输入框可编辑

### CreateRoomModal：Scene 选择器

创建 Room 时新增 **单选下拉（select）**，不使用卡片墙。

原因：

- 当前 CreateRoomModal 已有主题、专家、工作目录等输入
- Scene 只有少量选项，单选下拉更稳定、占位更小

规则：

- 默认选中 `圆桌论坛`
- 选项展示 `name + description`
- 创建时提交 `sceneId`

### Room View

当前期只要求 Scene 在创建时确定并参与运行时 prompt 注入。

不要求：

- 在 Room 内动态切换 Scene
- 在 Room Header 实时编辑 Scene

## In Scope

- SceneConfig 类型与存储
- 两个 builtin Scene 的启动补齐
- Room 级 `sceneId`
- CreateRoomModal 的 Scene 选择
- Settings Modal 的 Scene 管理
- 所有执行路径统一经过 Scene Prompt 组装器
- 幂等迁移与旧 Room 回填

## Out of Scope

- Agent 级 Scene
- Room 运行中切换 Scene
- 删除 Scene 时自动把引用 Room 回退到默认 Scene
- Scene 版本历史
- Scene 预览 diff / 回滚
- 运行时多 Scene 叠加

## Acceptance Criteria

- [x] AC-1: 系统启动后默认存在两个 builtin Scene，ID 固定为 `roundtable-forum` 与 `software-development`
- [x] AC-2: `SceneConfig` 类型明确包含 `id`, `name`, `description?`, `prompt`, `builtin`
- [x] AC-3: `rooms` 持有 `scene_id`；旧 `rooms` 在 `backend/src/db/migrate.ts` 中通过幂等迁移回填为 `roundtable-forum`
- [x] AC-4: CreateRoomModal 必须提交 `sceneId`，未传时后端使用默认值 `roundtable-forum`
- [x] AC-5: Settings Modal 存在独立 Scene 管理入口，支持查看、新增、编辑、删除自定义 Scene
- [x] AC-6: builtin Scene 不可删除、不可改 ID、不可改名称，但允许改 `prompt` 与 `description`
- [x] AC-7: 自定义 Scene 的 ID 由后端基于名称生成 slug；创建后 ID 冻结，不允许编辑
- [x] AC-8: `GET /api/scenes`, `POST /api/scenes`, `PUT /api/scenes/:id`, `DELETE /api/scenes/:id` 的行为与错误语义在本文档中明确
- [x] AC-9: 任一 Agent 执行路径，包括 Inline Report / Summary，都必须先经过 Room Scene 组装器；动作 prompt 不能直接作为最终 system prompt
- [x] AC-10: 删除被 Room 引用的自定义 Scene 时返回 `409 SCENE_IN_USE`，不做静默回退

## Dependencies

- F003: Tool Agent 执行链路
- F010: CreateRoomModal / SettingsModal UI 载体
- F012: 当前 Room 模型与无 MANAGER 路由方式

## Risks

- 如果 Scene Prompt 与动作 prompt 边界不清，仍可能出现重复约束
- builtin Scene 允许编辑 prompt，可能让既有 Room 的行为漂移，需要在产品层面接受这一点
- 如果未来新增 Room 内动态换 Scene，本期的“删除时 409 拒绝”策略需要重新评估
- 当前仓库没有 schema version 体系，迁移只能继续依赖幂等式启动逻辑

## Open Questions

- 是否需要在 Settings 中提供“最终 prompt 预览”，帮助调试 `Scene Prompt + Action Prompt + Runtime Context` 的叠加结果？
- builtin Scene 的 prompt 编辑是否需要审计日志或“恢复默认”按钮？本期未纳入范围。

## Verification

- `pnpm --dir backend exec vitest run tests/scenes.test.ts tests/builtinScenes.test.ts tests/settingsTabs.test.ts`
- `pnpm --dir backend test`
- `pnpm --dir frontend build`
