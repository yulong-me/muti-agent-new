---
feature_ids: [F025]
related_features: [F002, F0043, F021]
topics: [session, telemetry, context, opencode, claude, ui]
doc_kind: spec
created: 2026-04-23
---

# F025: Session 上下文大小遥测（Session xxk）

> **Status**: spec | **Owner**: codex | **Priority**: P1

## Why

当前“Session xxk”这件事本质上是一个独立能力，不应该继续混在房间长记忆和 checkpoint / rollover 策略里。

需要单独解决的问题是：

1. 用户需要知道某条 agent 回复当时处在哪个 session，以及这个 session 当时大约吃了多少上下文。
2. 这个数字不能再拿“本轮 input tokens”冒充，必须有明确来源和稳定口径。
3. 这套能力应该能独立存在，即使未来 room memory 策略变化，`Session xxk` 仍然可以单独工作。

因此，这个 Feature 只解决一件事：

**为每条 agent 消息和当前活跃 session 提供可解释、可验证的上下文大小统计，并以 `Session xxk` 的形式展示。**

## What

### 范围

本 Feature 只负责：

- 定义 `session context used` 的统计口径
- 定义不同 provider 的数据源优先级
- 把结果固化到消息快照和 session 状态里
- 在 UI 上显示 `Session xxk`

本 Feature 不负责：

- room checkpoint 策略
- transcript 裁剪策略
- history retrieval 策略
- rollover 触发策略本身

### 用户可见行为

1. agent 消息气泡中，在“名字后、时间前”显示 `Session xxk`
2. 右侧 Agent 面板中，当前活跃 session 和历史 session 都能显示对应的 `xxk`
3. 悬浮可查看详细信息：
   - `SessionId`
   - `已用 xxk`
   - `总上限 xxk`（若已知）
   - `上下文占用 xx%`（若已知）
   - `来源：Provider 直出 / 本地记录 / 估算`

### 核心定义

`Session xxk` 表示：

**该条消息生成时，对应 session 的“当前上下文大小”快照。**

它不是：

- 整个 session 生命周期的累计 token spend
- 整个账户的累计 usage
- 本轮 output tokens

显示值的来源字段统一为：

- `sessionId`
- `contextUsedTokens`
- `contextLimitTokens`
- `contextRemainingTokens`
- `contextUtilization`
- `contextTelemetrySource`
- `measuredAt`

## Design

### 数据源优先级

按以下顺序取值：

1. `provider`
   provider 直接返回 `context_used / context_limit / context_remaining / context_utilization`

2. `local`
   provider 不直出时，读取本地真相源文件 / 数据库

3. `estimated`
   前两者都拿不到时，才允许走应用侧估算

`contextTelemetrySource` 只允许：

- `provider`
- `local`
- `estimated`

### 统计口径

#### 1. OpenCode

优先本地真相源：

- 路径：`~/.local/share/opencode/opencode.db`
- 表：`message`
- 记录：同一个 `session_id` 的最新 assistant message

统计公式：

```text
contextUsedTokens = tokens.total - tokens.output
```

原因：

- `tokens.total` 包含本轮上下文和其它计费项
- `tokens.output` 是模型本轮输出
- `total - output` 能更接近“送入模型时的上下文规模”

已验证样例：

```text
total = 93485
output = 304
used  = 93181
UI    = Session 93k
```

#### 2. Claude Code

优先本地真相源：

- 路径：`~/.claude/projects/**/*.jsonl`
- 记录：同一个 `sessionId` 的最新 assistant usage

统计公式：

```text
contextUsedTokens =
  input_tokens
  + cache_read_input_tokens
  + cache_creation_input_tokens
```

原因：

- `input_tokens` 对应当前这轮进入模型的输入规模
- `cache_read_input_tokens / cache_creation_input_tokens` 也是这一轮上下文构成的一部分
- 这比只看 `input_tokens` 更接近真实 session 上下文大小

#### 3. Context Limit

优先级：

1. provider 直出 `context_limit_tokens`
2. 本地记录里的模型窗口值
3. 应用内模型窗口映射表

如果 limit 缺失：

- `Session xxk` 仍然允许显示
- 但 tooltip 中不强制显示“总上限 / 百分比”

### UI 显示口径

显示规则：

```text
Session label = round_k(contextUsedTokens)
```

例：

- `53539` -> `Session 54k`
- `93181` -> `Session 93k`
- `143526` -> `Session 144k`

### 历史快照规则

消息气泡必须显示：

**这条消息生成当时的 session 快照**

不能显示：

- 当前最新 session 的状态
- 之后被 rollover 覆盖的新值

因此每条消息都要固化：

- `sessionId`
- `sessionEpoch`
- `contextUsedTokens`
- `contextLimitTokens`
- `contextRemainingTokens`
- `contextUtilization`
- `contextTelemetrySource`

### 允许的回退

只有在 `provider` 和 `local` 都拿不到时，才允许使用 `estimated`。

估算只作为兜底，不作为主要路径。

估算时必须满足：

- UI 标注来源为 `估算`
- 不得伪装成 provider 官方值

## Acceptance Criteria

- [ ] AC-1: 新增统一的 session telemetry 字段集：`sessionId / contextUsedTokens / contextLimitTokens / contextRemainingTokens / contextUtilization / contextTelemetrySource / measuredAt`
- [ ] AC-2: OpenCode 在存在本地 `opencode.db` 记录时，优先使用 `message.tokens.total - message.tokens.output` 作为 `contextUsedTokens`
- [ ] AC-3: Claude Code 在存在本地 jsonl usage 记录时，优先使用 `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` 作为 `contextUsedTokens`
- [ ] AC-4: agent 消息气泡显示 `Session xxk`，值来自该消息自己的 `sessionSnapshot.contextUsedTokens`
- [ ] AC-5: 右侧 Agent 面板显示当前活跃 session 的 `Session xxk`，值来自最新 session telemetry，而不是临时前端估算
- [ ] AC-6: tooltip 能显示 `SessionId / 已用 / 上限 / 占比 / 来源`，缺失字段时允许部分省略
- [ ] AC-7: 对同一个 session 的多条消息，显示值必须与各自时点的本地真相源记录一致，不允许再把“本轮 input”误当成“session used”
- [ ] AC-8: 当来源是 `estimated` 时，UI 必须明确标识为估算，不得与 `provider / local` 混淆

## Dependencies

- [F002](./F002-opencode-provider.md)
- [F0043](./F0043-observability-logging.md)
- [F021](./F021-database-persistence.md)

## Risk

| 风险 | 影响 | 缓解 |
|------|------|------|
| 本地文件 / 数据库路径变化 | `local` 路径失效 | 封装 provider-specific reader，并保留 `estimated` 兜底 |
| 不同模型窗口大小不一致 | `limit / utilization` 不准 | limit 缺失时只显示 `Session xxk`，不要硬显示剩余百分比 |
| 历史消息没有快照 | 老消息无法回填 | 允许历史消息显示为空，新消息开始按新口径落库 |
| 把“当前上下文大小”误解成“总成本” | 用户误解 | 文档和 tooltip 明确写“已用上下文”，不写累计 spend |

## Open Questions

| ID | 问题 | 状态 |
|----|------|------|
| OQ-1 | 是否要为不同模型维护更完整的 context window 映射表？ | ⬜ 未定 |
| OQ-2 | 是否需要补历史消息的 sessionSnapshot 回填工具？ | ⬜ 未定 |
| OQ-3 | UI 是否需要把 `SessionId` 默认折叠，只在点击后展示？ | ⬜ 未定 |
