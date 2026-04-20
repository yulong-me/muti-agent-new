---
feature_ids: [F014]
related_features: []
topics: [ux, error-handling, resilience, process-management]
doc_kind: spec
created: 2026-04-16
updated: 2026-04-20
---

# F014: 专家进程容错与全链路 UX 保护保护机制（Agent Resilience & UX Recovery）

> Status: in-progress | Owner: codex

## Why

在“用户 + 多专家”的协作模型下，一条消息发送到后端后，往往需要拉起 / 调度真实的 Agent 进程进行长链条处理。这期间充满了不确定性：
1. **进程异常**：Agent 子进程随时可能因内存溢出、环境异常而崩溃（Crash）。
2. **生命周期挂死**：死锁、外部 API 无响应或者 LLM 提供商网络波动，导致进程长期挂起（Hang）。
3. **数据结构异常**：LLM 产出的 JSON 结构幻觉导致解析失败（Parsing Error），引发程序抛出未捕获异常。

如果这些底层异常直接抛弃或向上穿透，会导致用户界面永久处于“等待（Loading）”状态，或者满屏乱码栈信息，让用户“**不知所措**”。必须建立一套防病态、对用户充满人文关怀的异常保护机制。

## What

建立**“请求-调度-执行-响应”**全生命周期的兜底与 UX 保障体系：
1. **防挂死（Timeouts & Heartbeats）**：为所有挂靠的 Expert Process 加入显式的超时干预与首包/Token心跳检测。
2. **异常捕获转义（Exception Translation）**：后端拦截所有非预期的子进程 Panic、Exit Code 非 0 和解析错误，不再向前端吐出原始错误堆栈，而是转化为标准化的内部错误码结构。
3. **人类友好的界面展现（Human-Readable UX）**：在聊天窗口渲染特定状态的“错误卡片”，用清晰、温柔的提示语安抚用户（例如：“啊哦，专家构思时遇到了点小问题”）。
4. **可操作的挽回动作（Actionable Recovery）**：所有报错必须伴随明确的下一步动作，如提供明确的 **[一键重试]**、**[复制原始提问]** 或 **[换个专家试试]** 的按钮，确保用户动作不丢失。

## In Scope

- **执行层超时熔断**：
  - 进程启动设定 Maximum TTL。
  - Streaming 下游 Token 发送间隔（Idle Time）超时熔断设置（如 15 秒无新流数据则判定超时）。
- **进程状态守护**：后端捕获异常崩溃信号，利用特殊系统消息结构向客户端发送 `ROOM_ERROR_EVENT`。
- **UI 层 ErrorBoundary 与 Fallback Card**：
  - 会话中单个气泡维度的异常展示 UI（而不是让整个页面白屏崩溃）。
  - 若正在流式输出中途挂死，能在半成品气泡后方追加显眼的“连接中断”提示。
- **用户输入状态保护**：如果发出去立马失败，用户的输入词或草稿能被完美保留并提供重发功能。

## Out of Scope

- 基础设施或 K8s/Docker 级别的自动伸缩与自愈（Auto-healing）偏向于运维体系，这里主要关照应用层和用户视觉体验。
- LLM 返回的逻辑错误或代码 Bug 识别（交由专门的代码测试 Agent 来验证）。

## Error Mapping & UX Copywriting (示例)

| 底层异常情况 | 监测机制 | 建议提示语 (UX Copy) | 提供给用户的操作 |
|-------------|----------|-------------------|----------------|
| 子进程意外退出 (Exit > 0) | Process Event Listener | "该专家服务刚刚开小差退出了，请尝试重新唤醒它。" | [点击重试] |
| 进程假死 (Hang/Timeout) | 15s Ticker Token 监测 | "等待专家的响应超时了，可能他正在思考人生..." | [中止并重发] |
| 消息解析/JSON幻觉错误 | try-catch 拦截 | "解析专家给出的方案时遇到了格式混乱，建议换个问法。" | [编辑并重试] |
| LLM 服务方(API)宕机 | HTTP 5xx 拦截 | "第三方大模型服务网络有些小波动，暂时无法触达。" | [重试] [稍后再试] |

## Acceptance Criteria

- [ ] AC-1: **超时阻断** - 用户发送消息指定给某 Agent，若 15 秒内没有任何 Token 流返回，前端结束 Loading 开始呈现「响应超时卡片」，并展示重试入口。
- [ ] AC-2: **进程静默崩溃捕获** - 若后台跑工具的进程 OOM 或被 Kill，前端不应一直展示 Loading，而是立即收到结束信号并渲染「服务异常断开卡片」。
- [ ] AC-3: **友好提示语** - 前端严禁向终端用户直接显示如 `TypeError: Cannot read property 'map' of undefined` 等纯代码日志，所有错误走 Fallback UI 与拟人化抱歉文案。
- [ ] AC-4: **体验连续性** - 在出现任何上述错误后，用户此前辛苦编写的长篇 Prompt / 消息内容不会白白丢失，可以在错误卡片右下角快速找回或一件重发指令。
- [ ] AC-5: **错误上报日志** - 后端虽然对用户掩盖了错误堆栈，但必须输出标准的结构化错误日志，并携带当前的 `TraceId` / `RoomId` 供研发时候通过排错系统追溯根本原因（结合之前的 F0043 可观测性）。

## Proposed Changes

- **Backend** (`ProcessManager` / `Executor`): 引入看门狗（Watchdog）机制监听进程管道和生命周期，加入基于 `AbortController` 的网络与进程超时逻辑。
- **Frontend 组件**：增加 `ErrorBubble.tsx` 和专门的 `TimeoutCard.tsx` 替代死板的悬停动画；完善聊天气泡级的全局错误捕获机制。

## Changelog

- 2026-04-20: 补齐超时 phase 语义。`AGENT_TIMEOUT` 现在区分 `first_token` 与 `idle` 两种 phase；前者继续显示“响应超时”，后者改为“连接中断”，并在错误卡片上明确提示“已保留部分输出”，用于覆盖“回答进行到一半卡住”的场景。
- 2026-04-20: 错误卡片新增“换个专家试试”恢复动作。当前房间里若还有其他 WORKER，可直接把原问题改写为发给另一位专家并回填到输入框，减少用户手工改写 @mention 的成本。

## Verification

- `pnpm --dir backend exec vitest run tests/stateMachine.test.ts -t "超时|连接中断"`
- `pnpm --dir backend exec vitest run tests/errorRecovery.test.ts`
- `pnpm --dir backend test`
- `pnpm --dir backend build`
- `pnpm --dir frontend build`
