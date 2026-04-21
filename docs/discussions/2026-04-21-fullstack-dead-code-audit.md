---
feature_ids: []
topics: [dead-code, audit, frontend, backend]
doc_kind: audit
created: 2026-04-21
---

# 前后端废代码审计（全量扫描）

## 结论摘要

本次扫描覆盖了：

- 前端运行时代码 `37` 个文件：`frontend/app` `6`、`frontend/components` `22`、`frontend/lib` `9`
- 前端测试代码 `2` 个文件：`frontend/tests`
- 后端运行时代码 `35` 个文件：`backend/src`
- 后端测试代码 `15` 个文件：`backend/tests`

合计扫描 `89` 个源文件。

核心结论：

1. 当前代码库里没有“大块完全脱离入口、无人 import 的运行时模块”。
2. 真正的废代码主要集中在三类：
   - 已经被产品流转淘汰、但还留在后端里的旧执行链路
   - 模块内部已经无人使用的函数、常量、状态和导出
   - 后端仍然挂着、但前端没有任何调用方的旧接口
3. 最值得优先处理的是一整簇“旧 Manager 流程”遗留代码；这是本次扫描里体量最大、价值最高的一组删除项。

## 扫描方法

本次审计不是只看文件名，而是用了四层证据交叉确认：

1. 运行时入口可达性
   - 前端从 `frontend/app/**/*` 入口出发建立 import 图
   - 后端从 `backend/src/server.ts` 出发建立 import 图
2. 编译器未使用符号检查
   - `pnpm --dir frontend exec tsc --noEmit --noUnusedLocals --noUnusedParameters`
   - `pnpm --dir backend exec tsc --noEmit --noUnusedLocals --noUnusedParameters`
3. 仓库级全文检索
   - 对每个候选符号做 repo 级 `rg`
   - 区分“运行时代码引用”“仅测试引用”“仅本文件自引用”
4. 前端 API 调用矩阵 vs 后端路由矩阵
   - 对照 `frontend` 中所有 `/api/*` 调用
   - 对照 `backend/src/routes` 和 `backend/src/server.ts` 中所有 HTTP 路由

## 一、确认可删的运行时代码

### 1. 旧 Manager 执行链已经失效，但仍残留在后端

证据链：

- 当前 room 创建逻辑明确只把 `WORKER` 放进房间，不再放 `MANAGER`
  - `backend/src/routes/rooms.ts:34`
  - `backend/src/routes/rooms.ts:90`
  - `backend/src/routes/rooms.ts:94`
- 但旧逻辑 `handleUserMessage()` 仍然要求房间里存在 `MANAGER`，否则直接返回
  - `backend/src/services/stateMachine.ts:348`
  - `backend/src/services/stateMachine.ts:356`
  - `backend/src/services/stateMachine.ts:357`
- 旧逻辑 `generateReport()` 也要求房间里存在 `MANAGER`
  - `backend/src/services/stateMachine.ts:508`
  - `backend/src/services/stateMachine.ts:512`
  - `backend/src/services/stateMachine.ts:513`
- 旧 Prompt 模块 `HOST_PROMPTS` 只被这条旧链路使用
  - `backend/src/prompts/host.ts:14`
  - `backend/src/services/stateMachine.ts:24`
  - `backend/src/services/stateMachine.ts:369`
  - `backend/src/services/stateMachine.ts:528`

确认可删项：

- `backend/src/services/stateMachine.ts:348` `handleUserMessage`
- `backend/src/services/stateMachine.ts:472` `callWorker`
- `backend/src/services/stateMachine.ts:508` `generateReport`
- 整个 `backend/src/prompts/host.ts`

移除方案：

1. 从 `stateMachine.ts` 删除 `handleUserMessage`、`callWorker`、`generateReport`
2. 删除 `HOST_PROMPTS` import 和围绕旧 Manager 流程的注释
3. 删除 `backend/src/prompts/host.ts`
4. 清理仅服务于旧 Manager 流程的测试与 mock
   - `backend/tests/stateMachine.test.ts` 里 `handleUserMessage()` 相关用例
   - `backend/tests/rooms.test.ts` 里对 `handleUserMessage` / `generateReport` 的 mock
   - `backend/tests/rooms.http.test.ts` 里对 `handleUserMessage` / `generateReport` 的 mock
   - `backend/tests/scenes.test.ts` 里对 `generateReport` 的 mock

风险：

- 运行时风险低，因为当前消息入口 `POST /api/rooms/:id/messages` 已经只走 `routeToAgent()`
  - `backend/src/routes/rooms.ts:166`
  - `backend/src/routes/rooms.ts:200`
- 测试改动量中等，因为要同步删掉遗留断言和 mock

### 2. A2A Router 里有一整组无人调用的旧辅助函数

证据：

- 下列函数全仓库无运行时调用：
  - `backend/src/services/routing/A2ARouter.ts:142` `resolveAgent`
  - `backend/src/services/routing/A2ARouter.ts:160` `a2aRoute`
  - `backend/src/services/routing/A2ARouter.ts:184` `routeFromMessage`
  - `backend/src/services/routing/A2ARouter.ts:235` `resetA2ADepth`
- 其中 `routeFromMessage()` 的 `callChain` 参数还被 `tsc` 直接判定为未使用
  - `backend/src/services/routing/A2ARouter.ts:188`

移除方案：

1. 直接删掉上述四个函数
2. 保留当前仍在使用的 A2A 能力：
   - `resolveEffectiveMaxDepth`
   - `getEffectiveMaxDepthForRoom`
   - `scanForA2AMentions`
   - `updateA2AContext`
3. 重新跑后端类型检查和 `stateMachine` / `rooms` 相关测试

### 3. `BubbleSection.tsx` 里残留了一套未接线的气泡实现

证据：

- `frontend/components/BubbleSection.tsx:111` `MessageBubble`
- `frontend/components/BubbleSection.tsx:189` `getAgentColor`
- `frontend/components/BubbleSection.tsx:105` `MessageBubbleProps`

这组定义在仓库里没有任何调用方；真正被使用的是 `MessageList.tsx` 自己内部那套 `MessageBubble`

- `frontend/components/MessageList.tsx:181`

移除方案：

1. 删除 `BubbleSection.tsx` 中的 `MessageBubbleProps`
2. 删除 `MessageBubble`
3. 删除 `getAgentColor`
4. 保留 `BubbleSection` 本体

### 4. 明确无人使用的独立 helper / 常量

以下项在运行时代码和测试里都没有实际调用，或只被测试验证但运行时完全不走：

- `frontend/lib/settingsTabs.ts:26` `buildSettingsTabPath`
  - 只在 `backend/tests/settingsTabs.test.ts:35` 被测
  - 运行时代码里 settings 页面直接写死 `/settings/agents` 等路径
  - 处理方案：删除函数，并删掉对应测试断言
- `frontend/lib/api.ts:21` `SOCKET_URL`
  - 运行时直接用 `API_URL`
  - 处理方案：删除常量
- `frontend/lib/agents.tsx:76` `STATE_LABELS`
  - 无任何调用方
  - 处理方案：删除常量
- `backend/src/services/providers/index.ts:35` `getProviderNames`
  - 无任何调用方
  - 处理方案：删除函数
- `backend/src/services/workspace.ts:84` `getWorkspaceArgs`
  - 无任何调用方
  - 处理方案：删除函数
- `backend/src/types.ts:46` `ProviderEvent`
  - 无任何调用方，且和 `services/providers/index.ts` 的事件类型重复
  - 处理方案：删除类型
- `backend/src/types.ts:137` `BUILTIN_SCENE_IDS`
  - 无任何调用方
  - 处理方案：删除常量

### 5. 编译器直接确认的死局部变量 / 死 import

这批项由 `tsc --noUnusedLocals --noUnusedParameters` 直接报出，删除风险最低：

- `frontend/components/CreateRoomModal.tsx:25` `PROVIDER_COLORS`
- `frontend/components/SettingsModal.tsx:549` `loadingScenes`
- `frontend/components/SettingsModal.tsx:549` `setLoadingScenes`
- `frontend/components/SettingsModal.tsx:563` `router`
- `backend/src/routes/browse.ts:198` `created`
- `backend/src/routes/providers.ts:10` `ProviderConfig` import
- `backend/src/routes/providers.ts:12` `debug` import
- `backend/src/services/providers/claudeCode.ts:6` `info` import

移除方案：

1. 直接删掉这些局部量和 import
2. 重新跑两端 `tsc --noUnusedLocals`

### 6. 明确失效的 re-export / 注释

证据：

- `backend/src/server.ts:100` 注释写着“Export io so routes can emit events”
- 实际路由早已通过 `socketEmitter` 中央封装发事件，不再 import `server.ts` 的 `io`
- `backend/src/server.ts:101` `export { io }`
- `backend/src/server.ts:108` `export { log }`
- `backend/src/log.ts:2` 这个 barrel 额外 re-export 了 `debug/info/warn/error/logger`
- 但当前通过 `../log.js` 只 import `log`
  - `backend/src/server.ts:13`
  - `backend/src/db/index.ts:9`
  - `backend/src/db/migrate.ts:5`

移除方案：

1. 删掉 `backend/src/server.ts` 的 `export { io }` / `export { log }`
2. 删掉对应的过时注释
3. 将 `backend/src/log.ts` 收缩为只 re-export `log`

## 二、确认可收缩的“只剩测试或内部实现需要”的导出面

这一组不一定要删函数本体，但可以先缩公共面，避免继续扩散：

| 位置 | 符号 | 现状 | 建议 |
|------|------|------|------|
| `frontend/components/AgentAvatar.tsx:29` | `getAvatarInitial` | 仅本文件内部使用 | 去掉 `export`，保留内部 helper |
| `frontend/lib/agentModels.ts:1` | `ProviderModelConfigLike` | 仅本文件类型使用 | 改为内部类型 |
| `frontend/lib/agents.tsx:14` | `AgentRole` | 仅本文件接口引用 | 改为内部类型 |
| `frontend/lib/workspace.ts:5` | `BrowseEntry` | 仅本文件类型使用 | 改为内部类型 |
| `frontend/lib/workspace.ts:19` | `FilePreviewResult` | 仅本文件类型使用 | 改为内部类型 |
| `frontend/lib/workspace.ts:52` | `GitDiffResult` | 仅本文件类型使用 | 改为内部类型 |
| `backend/src/config/agentConfig.ts:4` | `agentsRepo` re-export | 无调用方 | 删除 re-export |
| `backend/src/config/agentConfig.ts:14` | `getAgentByName` | 无调用方 | 删除函数 |
| `backend/src/config/providerConfig.ts:15` | `ProvidersConfig` | 仅返回类型使用 | 改为内部类型 |
| `backend/src/db/index.ts:178` | `db` / `DB_PATH` re-export | 无调用方 | 删除 re-export |
| `backend/src/db/index.ts:182` | `agentsRepo` re-export | 无调用方 | 删除 re-export |
| `backend/src/db/index.ts:183` | `providersRepo` re-export | 无调用方 | 删除 re-export |
| `backend/src/db/repositories/audit.ts:4` | `AuditLog` export | 仅本文件使用 | 改为内部接口 |
| `backend/src/prompts/builtinScenes.ts:1` | `BuiltinSceneDefinition` export | 仅本文件使用 | 改为内部接口 |
| `backend/src/routes/browse.ts:16` | `BrowseEntry` export | 仅本文件使用 | 改为内部接口 |
| `backend/src/routes/browse.ts:22` | `BrowseResult` export | 仅本文件使用 | 改为内部接口 |
| `backend/src/routes/browse.ts:30` | `FilePreviewResult` export | 仅本文件使用 | 改为内部接口 |
| `backend/src/services/scenePromptBuilder.ts:15` | `RuntimeContext` export | 仅本文件使用 | 改为内部接口 |
| `backend/src/services/workspace.ts:22` | `WorkspaceSecurityError` export | 仅模块内部抛出/捕获 | 去掉 `export` |
| `backend/src/services/workspace.ts:64` | `getWorkspacePath` export | 运行时内部用，测试直接 import | 去掉 `export`，测试改走 `ensureWorkspace()` 断言 |
| `backend/src/services/providers/index.ts:18` | `StreamFn` export | 无外部类型引用 | 改为内部类型 |
| `backend/src/services/providers/claudeCode.ts:33` | `buildClaudeProviderLaunch` | 仅测试引用 | 若保留单元测试则迁移到 test util；否则去掉 `export` |
| `backend/src/services/providers/claudeCode.ts:75` | `parseClaudeAssistantToolUseEvents` | 仅测试引用 | 同上 |
| `backend/src/services/providers/opencode.ts:34` | `buildOpenCodeProviderLaunch` | 仅测试引用 | 同上 |
| `backend/src/services/providers/opencode.ts:80` | `parseOpenCodeToolUseEvent` | 仅测试引用 | 同上 |
| `backend/src/services/stateMachine.ts:66` | `addUserMessage` export | 函数本体仍被本文件使用 | 去掉 `export` |
| `backend/src/services/stateMachine.ts:831` | `a2aOrchestrate` export | 函数本体仍被本文件使用 | 去掉 `export`，测试改覆盖外部行为 |
| `backend/src/types.ts:2` | `DiscussionState` export | 仅供本文件其他接口引用 | 改为内部类型 |
| `backend/src/types.ts:4` | `AgentRole` export | 仅供本文件其他接口引用 | 改为内部类型 |

## 三、中等置信度候选：确认后再删

### 1. 前端 logger 里有一整套“DebugPanel API”，但仓库里没有 DebugPanel

证据：

- 注释明确写着“供 DebugPanel 消费”
  - `frontend/lib/logger.ts:8`
  - `frontend/lib/logger.ts:37`
- 但 repo 里不存在 `DebugPanel`，也没有任何调用方
  - `frontend/lib/logger.ts:43` `getDebugLog`
  - `frontend/lib/logger.ts:47` `clearDebugLog`
  - `frontend/lib/logger.ts:145` `setLogLevel`
- `logger()` 每次还会维护一份内存 ring buffer
  - `frontend/lib/logger.ts:116`
  - `frontend/lib/logger.ts:117`

判断：

- 如果你已经不打算做前端日志面板，这一整簇都可以收掉
- 如果你准备后面补 DebugPanel，就先只删导出，不删内部 store

建议：

1. 先确认是否还有“前端日志面板”计划
2. 如果没有：
   - 删除 `getDebugLog` / `clearDebugLog` / `setLogLevel`
   - 删除 `debugLogStore` 和相关注释
   - 保留当前真正被用到的 `error` / `telemetry` / `setRoomId`

### 2. 后端存在一组“前端无调用方”的接口

以下接口在本仓库里没有任何前端调用痕迹；其中部分也没有测试覆盖：

| 路由 | 位置 | 仓库内调用情况 | 建议 |
|------|------|----------------|------|
| `GET /api/agents/:id` | `backend/src/routes/agents.ts:12` | 无前端、无测试 | 若无外部 API 使用者，可删 |
| `GET /api/providers/:name` | `backend/src/routes/providers.ts:42` | 无前端、无测试 | 若设置页不需要单查，可删 |
| `GET /api/providers/:name/preview` | `backend/src/routes/providers.ts:73` | 无前端、无测试 | 高概率可删 |
| `GET /api/rooms/:id` | `backend/src/routes/rooms.ts:117` | 无前端、无测试 | 当前前端只拉 `/messages` 和 `/sidebar`，可评估删除 |
| `POST /api/rooms/:id/report` | `backend/src/routes/rooms.ts:242` | 无前端，只有测试 | 若产品上已无“手动生成报告按钮”，可删 |
| `GET /api/rooms/archived` | `backend/src/routes/rooms.ts:287` | 无前端、无测试 | 若没有归档列表 UI，可删 |
| `DELETE /api/rooms/archived/:id` | `backend/src/routes/rooms.ts:356` | 无前端、无测试 | 同上 |
| `GET /api/debug` | `backend/src/server.ts:57` | 无前端、无测试 | 若不是运维/手工排障接口，可删 |
| `GET /health` | `backend/src/server.ts:76` | 无前端、无测试 | 若没有部署探针，谨慎删除 |

这组我不建议直接删，原因不是“技术上删不动”，而是它们属于 API 面，可能存在仓库外消费者。

## 四、建议执行顺序

建议分 4 个批次做，而不是一次性大删：

### 批次 A：低风险、编译器直报项

目标：先把最确定的死局部量和死 import 清掉。

范围：

- `CreateRoomModal.tsx` 未用 `PROVIDER_COLORS`
- `SettingsModal.tsx` 未用 `loadingScenes` / `router`
- `browse.ts` 未用 `created`
- `providers.ts` 未用 import
- `claudeCode.ts` 未用 `info`

### 批次 B：确认可删的运行时废代码

目标：删掉现在产品流转已经不会走到的逻辑。

范围：

- `stateMachine.ts` 旧 Manager 链路
- `prompts/host.ts`
- `A2ARouter.ts` 旧辅助函数
- `BubbleSection.tsx` 未接线子组件
- `settingsTabs.ts` 的 `buildSettingsTabPath`
- `api.ts` 的 `SOCKET_URL`
- `agents.tsx` 的 `STATE_LABELS`
- `providers/index.ts` 的 `getProviderNames`
- `workspace.ts` 的 `getWorkspaceArgs`
- `types.ts` 的 `ProviderEvent` / `BUILTIN_SCENE_IDS`

### 批次 C：缩公共面，不改行为

目标：把“其实只给内部/测试用”的导出收紧。

范围：

- 前后端各种仅内部使用的 type/interface/function export
- `server.ts` / `log.ts` 的过时 re-export
- provider helper 的 test-only export

### 批次 D：需要产品确认的接口和调试能力

目标：确认 API 面和 DebugPanel 能力是否还保留。

范围：

- 前端 logger DebugPanel cluster
- 无前端调用方的后端接口

## 五、执行后的验证标准

等你确认后，我建议按下面标准验证“删干净且没回归”：

1. 前端 `tsc --noEmit --noUnusedLocals --noUnusedParameters`
2. 后端 `tsc --noEmit --noUnusedLocals --noUnusedParameters`
3. 后端 `pnpm --dir backend test`
4. 手工 smoke：
   - 创建 room
   - 发消息给专家
   - A2A @mention 继续工作
   - 停止专家输出
   - 添加专家入群
   - 设置页 Agent / Provider / Scene 正常打开
   - Workspace 文件浏览 / Git 面板正常

## 附录：本次全量扫描覆盖范围

### frontend/app（6）

```text
frontend/app/layout.tsx
frontend/app/page.tsx
frontend/app/room/[id]/page.tsx
frontend/app/settings/[tab]/page.tsx
frontend/app/settings/layout.tsx
frontend/app/settings/page.tsx
```

### frontend/components（22）

```text
frontend/components/AgentAvatar.tsx
frontend/components/AgentInviteDrawer.tsx
frontend/components/AgentPanel.tsx
frontend/components/BubbleErrorBoundary.tsx
frontend/components/BubbleSection.tsx
frontend/components/CreateRoomModal.tsx
frontend/components/DirectoryBrowser.tsx
frontend/components/DirectoryPicker.tsx
frontend/components/ErrorBubble.tsx
frontend/components/MentionPicker.tsx
frontend/components/MessageList.tsx
frontend/components/OutgoingMessageQueue.tsx
frontend/components/RoomComposer.tsx
frontend/components/RoomListSidebar.tsx
frontend/components/RoomView_new.tsx
frontend/components/SettingsModal.tsx
frontend/components/SettingsPageClient.tsx
frontend/components/ThemeProvider.tsx
frontend/components/WorkspaceFilesPanel.tsx
frontend/components/WorkspaceGitPanel.tsx
frontend/components/WorkspacePreviewDialog.tsx
frontend/components/WorkspaceSidebar.tsx
```

### frontend/lib（9）

```text
frontend/lib/agentModels.ts
frontend/lib/agents.tsx
frontend/lib/api.ts
frontend/lib/errorRecovery.ts
frontend/lib/logger.ts
frontend/lib/mentions.ts
frontend/lib/outgoingQueue.ts
frontend/lib/settingsTabs.ts
frontend/lib/workspace.ts
```

### frontend/tests（2）

```text
frontend/tests/input-lag-regression.mjs
frontend/tests/message-stats-zero-regression.tsx
```

### backend/src（35）

```text
backend/src/config/agentConfig.ts
backend/src/config/providerConfig.ts
backend/src/db/db.ts
backend/src/db/index.ts
backend/src/db/migrate.ts
backend/src/db/repositories/agents.ts
backend/src/db/repositories/audit.ts
backend/src/db/repositories/providers.ts
backend/src/db/repositories/rooms.ts
backend/src/db/repositories/scenes.ts
backend/src/db/repositories/sessions.ts
backend/src/lib/logger.ts
backend/src/log.ts
backend/src/prompts/builtinAgents.ts
backend/src/prompts/builtinScenes.ts
backend/src/prompts/host.ts
backend/src/routes/agents.ts
backend/src/routes/browse.ts
backend/src/routes/git.ts
backend/src/routes/logs.ts
backend/src/routes/providers.ts
backend/src/routes/rooms.ts
backend/src/routes/scenes.ts
backend/src/server.ts
backend/src/services/agentRuns.ts
backend/src/services/providers/claudeCode.ts
backend/src/services/providers/index.ts
backend/src/services/providers/opencode.ts
backend/src/services/routing/A2ARouter.ts
backend/src/services/scenePromptBuilder.ts
backend/src/services/socketEmitter.ts
backend/src/services/stateMachine.ts
backend/src/services/workspace.ts
backend/src/store.ts
backend/src/types.ts
```

### backend/tests（15）

```text
backend/tests/agentModels.test.ts
backend/tests/agents.http.test.ts
backend/tests/browse.test.ts
backend/tests/builtinScenes.test.ts
backend/tests/errorRecovery.test.ts
backend/tests/git.test.ts
backend/tests/mentions.test.ts
backend/tests/outgoingQueue.test.ts
backend/tests/providerToolUse.test.ts
backend/tests/rooms.http.test.ts
backend/tests/rooms.test.ts
backend/tests/scenes.test.ts
backend/tests/settingsTabs.test.ts
backend/tests/stateMachine.test.ts
backend/tests/workspace.test.ts
```
