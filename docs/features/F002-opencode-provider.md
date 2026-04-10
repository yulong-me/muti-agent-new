---
feature_ids: [F002]
related_features: [F001]
topics: [opencode, provider, streaming, multi-agent]
doc_kind: spec
created: 2026-04-10
---

# F002: Multi-Provider Agent System

> Status: spec | Owner: TBD

## Why

F001 当前只支持 `claude -p` 作为 Agent 调用源，每个 Agent 绑定同一底层工具，无法差异化选择。

**我们想要**：
1. **接入 OpenCode**：支持 20+ 模型（OpenAI、Anthropic、Gemini、Ollama、本地模型等），一套接口切换全生态
2. **Agent 级别配置**：每个 Agent 可独立选择 provider 和模型参数

## What

- 新增 `streamOpenCode()`，与 `streamClaudeCode()` 共用 `ClaudeEvent` 类型
- 统一 Provider 抽象接口（`Provider.stream()`），新增 provider 无需修改调用方
- `backend/src/config/agents.ts` 集中管理每个 Agent 的 provider + providerOpts

## OpenCode CLI 输出格式

测试版本：**1.2.27**，路径 `~/.opencode/bin/opencode`

### `opencode run --format json` — NDJSON 事件类型

```
step_start   → {type, timestamp, sessionID, part: {id, messageID, type, snapshot}}
reasoning    → {type, timestamp, sessionID, part: {id, messageID, type:"reasoning", text}}
text         → {type, timestamp, sessionID, part: {id, messageID, type:"text", text}}
tool_use     → {type, timestamp, sessionID, part: {id, messageID, type:"tool_use", ...}}
tool_result  → {type, timestamp, sessionID, part: {id, messageID, type:"tool_result", ...}}
step_finish  → {type, timestamp, sessionID, part: {type:"step-finish", reason, cost, tokens}}
error        → {type, timestamp, sessionID, part: {type:"error", error}}
```

关键选项：
- `--format json` — 输出 NDJSON 行
- `--thinking` — 开启推理过程输出（`reasoning` 事件）
- `--continue` / `-c` — 继续上一 session
- `--session <id>` — 继续指定 session
- `--model <provider/model>` — 指定模型
- `--dir <path>` — 指定工作目录

### `opencode serve` — Headless Server

```
opencode serve --port 4096 --hostname 127.0.0.1
```
启动 HTTP server，支持 attach 模式进行流式交互（WebSocket）。可作为长期 running agent 的替代方案。

## 实现方案

### 方案 A：subprocess spawn（推荐）

直接 spawn `opencode run --format json --thinking -- <prompt>`，逐行解析 NDJSON，映射到 `ClaudeEvent` 类型。

**优点**：无状态，每次调用独立，兼容现有 `callAgentWithStreaming` 接口
**缺点**：冷启动有 CLI 初始化开销

### 方案 B：serve + attach

启动 `opencode serve` 为长期进程，通过 HTTP attach 获取流式事件。

**优点**：session 复用，冷启动更快
**缺点**：需要管理 server 生命周期，增加复杂度

**建议**：先用方案 A，serve 模式作为后续优化方向。

## 事件映射（OpenCode → ClaudeEvent）

| OpenCode event type | ClaudeEvent type | 备注 |
|---|---|---|
| `step_start` | `start` | 提取 messageId |
| `reasoning` | `thinking_delta` | `part.text` → `thinking` |
| `text` | `delta` | `part.text` → `text` |
| `step_finish` | `end` | 从 `part.tokens` / `part.cost` 提取 |
| `error` | `error` | |

## Provider 抽象与配置

### 统一 Provider 接口

每个 Provider 实现相同签名，调用方无感知底层 CLI：

```typescript
type ClaudeEvent =
  | { type: 'start'; agentId: string; timestamp: number; messageId: string }
  | { type: 'delta'; agentId: string; text: string }
  | { type: 'thinking_delta'; agentId: string; thinking: string }
  | { type: 'end'; agentId: string; duration_ms: number; total_cost_usd: number; input_tokens: number; output_tokens: number }
  | { type: 'error'; agentId: string; message: string }

interface Provider {
  name: 'claude-code' | 'opencode' | 'ollama' | ...   // 唯一标识
  stream(prompt: string, agentId: string, opts?: Record<string, unknown>): AsyncGenerator<ClaudeEvent>
}
```

### Agent 级别 Provider 配置

在 `rooms.ts` 的讨论室创建流程中，每个 Agent 可指定自己的 provider：

```typescript
interface AgentConfig {
  id: string
  name: string
  role: 'HOST' | 'RESEARCHER' | 'DEBATER'
  provider: ProviderName     // 'claude-code' | 'opencode'
  providerOpts?: {           // provider 特定参数
    model?: string           // opencode: provider/model
    thinking?: boolean       // opencode: 是否输出 reasoning
    // 未来扩展: ollama host, ollama model, etc.
  }
}
```

### 配置存储位置

方案：在 `backend/src/config/agents.ts`（或 `.json`）集中管理：

```typescript
// backend/src/config/agents.ts
export const AGENT_CONFIGS: Record<string, AgentConfig> = {
  'claude-sonnet': {
    id: 'claude-sonnet',
    name: 'Sonnet',
    role: 'HOST',
    provider: 'claude-code',
    providerOpts: {},
  },
  'claude-opus': {
    id: 'claude-opus',
    name: 'Opus',
    role: 'RESEARCHER',
    provider: 'opencode',
    providerOpts: { model: 'anthropic/claude-sonnet-4-7', thinking: true },
  },
  'gemini': {
    id: 'gemini',
    name: 'Gemini',
    role: 'DEBATER',
    provider: 'opencode',
    providerOpts: { model: 'google/gemini-2-5-pro', thinking: false },
  },
}
```

前端在创建讨论室时读取 `AGENT_CONFIGS`，展示每个 Agent 使用的模型和 provider。

### 初始化时的 Provider 路由

在 `stateMachine.ts` 的 `streamingCallAgent` 中：

```typescript
import { CLAUDE_CODE_PROVIDER, OPENCODE_PROVIDER } from './providers/index.js'

const provider = getProvider(agentConfig.provider)  // factory lookup
const gen = provider.stream(prompt, agentId, agentConfig.providerOpts)
for await (const event of gen) { /* 统一处理 */ }
```

## Acceptance Criteria

- [ ] AC-1: `streamOpenCode(prompt, agentId)` 成功解析 opencode NDJSON 输出
- [ ] AC-2: `reasoning` 事件映射到 `thinking_delta`，可正常渲染推理过程
- [ ] AC-3: `callAgentWithStreaming` 可同时支持 claude 和 opencode（通过 provider 参数切换）
- [ ] AC-4: 错误事件（non-zero exit、stderr）正确抛出为异常
- [ ] AC-5: 每个 Agent 可在配置中独立指定 provider 和 providerOpts
- [ ] AC-6: 新增 Provider 只需实现 `stream()` 接口，无需修改调用方

## Dependencies

- F001 状态机框架（backend/src/services/agentCaller.ts）
- opencode CLI 1.2.27+ 已安装于 `~/.opencode/bin/opencode`

## Risk

- opencode 未来版本可能更改 NDJSON 事件格式 → 用版本检测做兼容
- `--thinking` flag 可能影响某些模型的输出行为 → 默认开启，可配置关闭
- 不同 provider 的 cost 单位不一致 → 统一归一化为 USD，前端仅显示

## Open Questions

1. ~~是否需要 session 复用（方案 B）？还是每次 spawn 独立进程？~~ 选方案 A（每次 spawn）
2. tool_use / tool_result 事件是否需要转发到前端渲染？暂不实现，后续按需扩展
3. 前端是否需要暴露模型选择器？还是固定后端配置？→ **固定后端配置，暂不暴露前端**
4. OpenCode 的 cost 字段单位是否与 claude 一致？→ 需实测后确认
5. 配置用 `.ts` 还是 `.json`？→ TS 支持类型检查，优先 TS
