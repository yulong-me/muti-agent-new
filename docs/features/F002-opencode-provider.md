---
feature_ids: [F002]
related_features: [F001]
topics: [opencode, provider, streaming, multi-agent]
doc_kind: spec
created: 2026-04-10
updated: 2026-04-20
---

# F002: Multi-Provider Agent System

> Status: done | Owner: codex | Completed: 2026-04-20

## Why

F001 早期只支持 `claude -p` 作为 Agent 调用源，所有 Agent 绑定同一底层工具，无法按 Agent 维度切换 provider、模型和 provider 特定参数。

本期目标：
1. 接入 `OpenCode`，让系统可以在 Claude Code / OpenCode 之间按 Agent 级别切换
2. 给每个 Agent 暴露独立的 provider / model / thinking 配置
3. 把这些配置接到真实运行时，而不是只停留在设置页

## What

- 新增 `streamOpenCodeProvider()`，与 `streamClaudeCodeProvider()` 共用统一 `ClaudeEvent` 类型
- 统一 Provider 抽象接口（`getProvider()` factory），新增 provider 无需修改调用方
- Agent 配置持久化到 `agents` 表，Provider 配置持久化到 `providers` 表；首次启动只 seed 一次
- 系统级配置页面支持 `/settings/agents`、`/settings/providers`、`/settings/scenes`
- `provider.defaultModel` 与 `agent.providerOpts.model` 都会透传到真实 CLI 命令

## Agent 配置页面

### 路由与布局

```text
/settings/agents
├── Agent 列表
│   ├── Agent 名称 + 角色 Badge
│   ├── Provider 选择器 (claude-code | opencode)
│   ├── 模型输入框 (providerOpts.model，可为空表示跟随 Provider 默认模型)
│   ├── Thinking 开关
│   └── 保存按钮
└── + 新增 Agent 按钮
```

### 后端 API

```text
GET  /api/agents          → 返回 agents 表中的 Agent 列表
PUT  /api/agents/:id      → 更新指定 Agent 配置
POST /api/agents          → 新增 Agent
DELETE /api/agents/:id    → 删除 Agent（仅限非 MANAGER 角色，当前主线实际均为 WORKER）
```

### 数据流

```text
前端 /settings/agents
  → GET /api/agents
  → AgentConfig[]（SQLite 真相源）

讨论室创建/执行时:
  前端 GET /api/agents → 展示 Agent 列表（带 provider / model 信息）
  后端 streamingCallAgent → 读取 agentConfig.provider / providerOpts → 路由到对应 Provider
```

## OpenCode CLI 输出格式

测试环境确认过 `opencode run --help` 支持：

- `--format json`
- `--thinking`
- `--session <id>`
- `-m, --model <provider/model>`
- `--dir <path>`

## Provider 抽象与配置

### 统一 Provider 接口

```typescript
type ClaudeEvent =
  | { type: 'start'; agentId: string; timestamp: number; messageId: string }
  | { type: 'delta'; agentId: string; text: string }
  | { type: 'thinking_delta'; agentId: string; thinking: string }
  | { type: 'tool_use'; agentId: string; toolName: string; toolInput: Record<string, unknown> }
  | { type: 'end'; agentId: string; duration_ms: number; total_cost_usd: number; input_tokens: number; output_tokens: number }
  | { type: 'error'; agentId: string; message: string }

type StreamFn = (
  prompt: string,
  agentId: string,
  opts?: Record<string, unknown>,
) => AsyncGenerator<ClaudeEvent, void, undefined>
```

### Agent 级别 Provider 配置

```typescript
interface AgentConfig {
  id: string
  name: string
  role: 'MANAGER' | 'WORKER'
  provider: 'claude-code' | 'opencode'
  providerOpts: {
    model?: string
    thinking?: boolean
  }
}
```

### 配置存储位置

当前实现以 SQLite 为真相源：

- `agents` 表保存 Agent 的 provider / providerOpts
- `providers` 表保存 CLI 路径、默认模型、API Key、超时等 Provider 配置

运行时模型选择策略：

```text
agent.providerOpts.model ?? provider.defaultModel
```

如果 Agent 自己配置了模型，优先使用 Agent 覆盖；否则回退到 Provider 默认模型。两者都会透传到实际 CLI：

```text
claude -p ... --model <model>
opencode run -m <provider/model> ...
```

### 初始化时的 Provider 路由

```typescript
const provider = getProvider(agentConfig.provider)
const gen = provider(prompt, agentId, {
  ...agentConfig.providerOpts,
  sessionId,
  workspace,
})
```

## Acceptance Criteria

- [x] AC-1: `streamOpenCode(prompt, agentId)` 成功解析 opencode NDJSON 输出
- [x] AC-2: `reasoning` 事件映射到 `thinking_delta`，可正常渲染推理过程
- [x] AC-3: `callAgentWithStreaming` 可同时支持 claude 和 opencode（通过 provider 参数切换）
- [x] AC-4: 错误事件（non-zero exit、stderr）正确抛出为异常
- [x] AC-5: 每个 Agent 可在配置中独立指定 provider 和 providerOpts
- [x] AC-6: 新增 Provider 只需实现 `stream()` 接口，无需修改调用方
- [x] AC-7: `/settings/agents` 页面可查看、编辑、保存、新增、删除 Agent 配置
- [x] AC-8: 配置变更实时生效（后端重新读取配置）

## Risk

- OpenCode 的 NDJSON 事件格式未来可能变化，需要继续靠解析测试兜底
- 不同 provider 的 cost 口径不完全一致，前端只消费归一化后的字段

## Changelog

- 2026-04-20: 完成 Agent 级模型配置闭环。`provider.defaultModel` 与 `agent.providerOpts.model` 会透传到 `claude` / `opencode` CLI；Agent 设置页新增模型输入框；新增 `/settings/[tab]` 路由以支持 `/settings/agents`、`/settings/providers`、`/settings/scenes`。

## Verification

- `pnpm --dir backend exec vitest run tests/providerToolUse.test.ts tests/agentModels.test.ts tests/settingsTabs.test.ts tests/agents.http.test.ts`
- `pnpm --dir frontend build`
