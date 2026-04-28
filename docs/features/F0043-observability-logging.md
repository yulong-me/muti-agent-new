---
feature_ids: [F0043]
topics: [observability, logging, debugging, telemetry]
doc_kind: feature
created: 2026-04-13
status: implemented
---

# F0043: 全链路可观测性日志系统

## 动机

多智能体系统的行为难以追踪：
- 消息路由路径不透明（发给谁？走了什么路径？）
- 前后端状态不一致时无法快速定位
- A2A 调用链、streaming 过程、黑盒状态
- 铲屎官遇到问题时的诊断效率低

## 设计原则

1. **结构化**：所有日志为 JSON，机器可解析、人可阅读
2. **全链路**：前端交互 → HTTP API → 后端路由 → A2A 编排 → Provider 调用，每层都有埋点
3. **按级别**：DEBUG（开发诊断）/ INFO（业务事件）/ WARN（异常边缘）/ ERROR（错误）
4. **最小侵入**：用统一的 logger 模块，不散落 console.log

## 日志级别定义

| 级别 | 用途 | 示例 |
|------|------|------|
| DEBUG | 诊断信息，开发时开启 | 路由决策、消息内容、状态变化 |
| INFO | 业务事件，可长期保留 | 用户发消息、房间创建、AI 开始生成 |
| WARN | 边缘异常，不影响流程 | Agent 未找到、消息内容过长、状态回退 |
| ERROR | 流程错误 | API 调用失败、Provider 异常 |

## 前端埋点（`frontend/lib/logger.ts`）

### 结构
```typescript
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

interface LogEntry {
  ts: string          // ISO timestamp
  level: LogLevel
  event: string       // 事件名，如 'msg.send'、'route.to'、'agent.select'
  // 上下文
  roomId?: string
  agentId?: string
  agentName?: string
  [key: string]: unknown
}
```

### 事件清单

| event | 级别 | 字段 | 说明 |
|-------|------|------|------|
| `app.mount` | INFO | roomId | 组件挂载 |
| `app.room.join` | INFO | roomId | 进入房间 |
| `agent.select` | DEBUG | roomId, agentId, agentName, role | @mention 选中 agent |
| `msg.send` | INFO | roomId, contentLength, toAgentId, toAgentName, toAgentRole | 用户发送消息 |
| `msg.send.error` | ERROR | roomId, error | 发送失败 |
| `route.frontend` | DEBUG | roomId, fromAgentId, toAgentId, decision | 前端路由决策（toAgentId 为何值） |
| `poll.start` | DEBUG | roomId | 开始轮询 |
| `poll.end` | DEBUG | roomId, messageCount, duration_ms | 轮询完成 |
| `socket.connect` | INFO | socketId | Socket.IO 连接 |
| `socket.event` | DEBUG | socketId, event | Socket 事件 |
| `mention.picker.open` | DEBUG | roomId, atIdx, query, agentCount | @ picker 打开 |
| `mention.picker.select` | DEBUG | roomId, agentName, agentId | @ picker 选择 |
| `mention.picker.close` | DEBUG | roomId, reason | @ picker 关闭 |
| `state.update` | DEBUG | roomId, key, oldValue, newValue | 关键 state 变化 |
| `recipient.sync` | DEBUG | roomId, recipientId, source | recipientIdRef 同步（调试闭包问题） |

### 实现要点
- 结构化输出到 Console + 批量 POST 后端持久化
- 可通过 `localStorage.setItem('log_level', 'DEBUG')` 临时开启 DEBUG 级别
- 前端日志每 2s 批量 POST 到 `POST /api/logs`，写入 `logs/{roomId}.log`
- `RoomView` 挂载时自动调用 `setRoomId(roomId)` 设置日志上下文

## 后端埋点（`backend/src/lib/logger.ts`）

自定义结构化 logger，支持 `LOG_LEVEL=debug|info|warn|error` 环境变量控制。
`log.ts` 改为向后兼容重导出：`export { log, debug, info, warn, error } from './lib/logger.js'`。

### 文件持久化

每条日志同时写入文件：
- 有 `roomId` 字段 → `logs/{roomId}.log`（按 room 会话分文件）
- 无 `roomId` 字段 → `logs/server.log`（启动、请求、Socket 等通用日志）

日志目录：`backend/logs/`（自动创建）。

### 事件清单

| event | 级别 | 字段 | 说明 |
|-------|------|------|------|
| `server.start` | INFO | port, env | 服务启动 |
| `store:loaded_from_db` | INFO | roomCount | 从 DB 恢复 rooms |
| `→ request` | INFO | reqId, method, path | HTTP 请求进入 |
| `← response` | INFO | reqId, method, path, status, duration_ms | HTTP 响应返回 |
| `route.frontend` | DEBUG | roomId, contentLength, toAgentId, managerId | 前端路由请求 |
| `route.to` | DEBUG | roomId, toAgentId, toAgentName, toAgentRole, path, reason | 路由决策（核心） |
| `route.fallback` | WARN | roomId, reason | 路由回退 |
| `msg.user` | INFO | roomId, contentLength, toAgentId, toAgentName, toAgentRole | 用户消息入库 |
| `msg:user` | INFO | roomId, contentLength | 消息遥测 |
| `route:msg_error` | ERROR | roomId, error | 消息路由失败 |
| `stream.start` | DEBUG | roomId, agentId, agentName, msgId, agentRole | AI 开始生成 |
| `stream.end` | DEBUG | roomId, agentId, agentName, msgId, duration_ms, deltaCount, thinkingCount, outputLen | AI 生成完成 |
| `stream.error` | ERROR | roomId, agentId, agentName, provider, error | AI 生成错误 |
| `manager:output` | DEBUG | roomId, outputLength | Manager 输出完成 |
| `worker:direct:output` | DEBUG | roomId, workerName, outputLength | Worker 直接输出 |
| `a2a:scan` | DEBUG | roomId, fromAgentName, mentions | A2A mention 扫描 |
| `a2a:guard` | DEBUG | roomId, fromAgentName, mentionsCount, keptMention | A2A guard 触发 |
| `a2a:detected` | INFO | roomId, fromAgentName, mentions, depth | A2A mention 检测 |
| `a2a:route` | INFO | roomId, from, to, depth | A2A 路由执行 |
| `a2a:skip_cycle` | DEBUG | roomId, target, chain | A2A 循环跳过 |
| `a2a:depth_limit` | DEBUG | roomId, depth, chain | A2A 深度超限 |
| `a2a:agent_not_found` | WARN | roomId, mention | A2A 目标 Agent 未找到 |
| `provider:call_start` | DEBUG | roomId, agentId, agentName, promptLength, timeout, sessionId, cliPath | Provider 调用开始 |
| `provider:call_end` | DEBUG | roomId, agentId, agentName, duration_ms, sessionId | Provider 调用结束 |
| `provider:call_error` | ERROR | roomId, agentId, agentName, stderr | Provider CLI 错误退出 |
| `provider:error` | ERROR | roomId, agentId, agentName, error | Provider 进程错误 |
| `provider:command` | DEBUG | roomId, agentId, command, provider | Provider 执行命令 |
| `provider:non_json` | DEBUG | roomId, agentId, line | Provider 非 JSON 行 |
| `provider:event` | DEBUG | roomId, agentId, agentName, eventType, partType | Provider 事件 |
| `report:start` | INFO | roomId, contentLength | 报告生成开始 |
| `report:done` | INFO | roomId, reportLength | 报告生成完成 |
| `socket:connect` | INFO | socketId | Socket.IO 连接 |
| `socket:join` | INFO | socketId, roomId | Socket 加入房间 |
| `socket:leave` | INFO | socketId, roomId | Socket 离开房间 |
| `socket:disconnect` | INFO | socketId | Socket 断开连接 |

### 实现要点
- 环境变量 `LOG_LEVEL=debug|info|warn|error` 控制级别（默认 INFO）
- `DEBUG` 级别日志通过 `LOG_LEVEL=debug` 开启
- 统一使用 `logger.info('event.name', { ...fields })` 格式
- `log.ts` 保留为向后兼容重导出，实际日志模块在 `lib/logger.ts`

### 前端日志上报

`POST /api/logs` — 接收前端日志并持久化。

请求体：
```json
{
  "roomId": "room-uuid",
  "entries": [
    { "ts": "ISO", "level": "DEBUG", "event": "agent.select", "meta": { ... } }
  ]
}
```

响应：`{ "status": "ok", "written": N }`

## 日志阅读指南

### F0042 路由问题诊断

```
[FE] msg.send     room=xxx toAgentId=yyy toAgentName=架构师 toAgentRole=WORKER
[BE] route.to     room=xxx toAgentId=yyy toAgentName=架构师 toAgentRole=WORKER path=callWorker
```

### A2A 调用链追踪

```
[BE] a2a.detected  from=主持人 mentions=[架构师, 全栈开发者]
[BE] a2a.route    from=主持人 to=架构师 depth=1
[BE] stream.start agentId=xxx agentName=架构师
[BE] a2a.route    from=架构师 to=全栈开发者 depth=2
[BE] stream.start agentId=yyy agentName=全栈开发者
```

## 实施步骤

1. 重构 `backend/src/log.ts` → `backend/src/lib/logger.ts`，支持 DEBUG 级别和结构化字段 ✅
2. 后端各模块迁移：`routes/rooms.ts` → `services/stateMachine.ts` → `services/providers/*` ✅
3. 新建 `frontend/lib/logger.ts`，前端 telemetry 模块化（向后兼容 `telemetry()` 别名） ✅
4. 前端各组件迁移：`RoomView.tsx`、`settings/(tabs)/agents/page.tsx` 中的 console.log → structured logger ✅
5. ~~写 `docs/features/F0043-observability-usage.md` 日志阅读指南~~ （本文件已含指南，inline 完成）

### 已实现事件清单（后端）

| event | 级别 | 字段 | 说明 |
|-------|------|------|------|
| `server:start` | INFO | port, env | 服务启动 |
| `store:loaded_from_db` | INFO | roomCount | 从 DB 恢复 rooms |
| `→ request` | INFO | reqId, method, path | HTTP 请求进入 |
| `← response` | INFO | reqId, method, path, status, duration_ms | HTTP 响应返回 |
| `msg:recv` | INFO | roomId, contentLength, contentSnippet, mentions, toAgentId, managerId | 后端收到用户消息（核心用户旅程） |
| `route.to` | DEBUG | roomId, toAgentId, toAgentName, toAgentRole, path, reason | 路由决策 |
| `route.fallback` | WARN | roomId, reason | 路由回退 |
| `msg.user` | INFO | roomId, contentLength, toAgentId, toAgentName, toAgentRole | 用户消息入库 |
| `route:msg_error` | ERROR | roomId, error | 消息路由失败 |
| `ai:start` | INFO | roomId, agentName, agentRole, provider, cliPath, promptLength, sessionId, workspace | AI 开始生成（用户旅程视角） |
| `ai:end` | INFO | roomId, agentName, agentRole, outputSnippet, outputLength, duration_ms, total_cost_usd, input_tokens, output_tokens | AI 生成结束（用户旅程视角） |
| `stream.start` | DEBUG | roomId, agentId, agentName, msgId, agentRole | AI 开始生成 |
| `manager:output` | DEBUG | roomId, outputLength | Manager 输出完成 |
| `worker:direct:output` | DEBUG | roomId, workerName, outputLength | Worker 直接输出 |
| `a2a:scan` | DEBUG | roomId, fromAgentName, mentions | A2A mention 扫描 |
| `a2a:guard` | DEBUG | roomId, fromAgentName, mentionsCount, keptMention | A2A guard 触发 |
| `a2a:detected` | INFO | roomId, fromAgentName, mentions, depth | A2A mention 检测 |
| `a2a:route` | INFO | roomId, from, to, depth | A2A 路由执行 |
| `a2a:skip_cycle` | DEBUG | roomId, target, chain | A2A 循环跳过 |
| `a2a:depth_limit` | DEBUG | roomId, depth, chain | A2A 深度超限 |
| `a2a:agent_not_found` | WARN | roomId, mention | A2A 目标 Agent 未找到 |
| `provider:call_start` | DEBUG | roomId, agentId, agentName, promptLength, timeout, sessionId, cliPath | Provider 调用开始 |
| `provider:call_end` | DEBUG | roomId, agentId, agentName, duration_ms, sessionId | Provider 调用结束 |
| `provider:call_error` | ERROR | roomId, agentId, agentName, stderr | Provider CLI 错误退出 |
| `provider:error` | ERROR | roomId, agentId, agentName, error | Provider 进程错误 |
| `provider:command` | DEBUG | roomId, agentId, command, provider | Provider 执行命令 |
| `provider:non_json` | DEBUG | roomId, agentId, line | Provider 非 JSON 行 |
| `provider:event` | DEBUG | roomId, agentId, agentName, eventType, partType | Provider 事件 |
| `report:start` | INFO | roomId, contentLength | 报告生成开始 |
| `report:done` | INFO | roomId, reportLength | 报告生成完成 |
| `socket:connect` | INFO | socketId | Socket.IO 连接 |
| `socket:join` | INFO | socketId, roomId | Socket 加入房间 |
| `socket:leave` | INFO | socketId, roomId | Socket 离开房间 |
| `socket:disconnect` | INFO | socketId | Socket 断开连接 |

### 已实现事件清单（前端）

| event | 级别 | 字段 | 说明 |
|-------|------|------|------|
| `ui:room:enter` | INFO | roomId | 用户进入房间 |
| `ui:msg:send` | INFO | roomId, contentLength, contentSnippet, toAgentId, toAgentName, toAgentRole, mentionText | 用户发送消息（核心用户旅程） |
| `ui:mention:pick` | INFO | roomId, agentName, agentId, agentRole | 用户从 @ 列表选择 Agent |
| `ui:ai:start` | INFO | roomId, agentName, agentRole | AI 开始响应（前端感知） |
| `ui:ai:end` | INFO | roomId, agentName, duration_ms, total_cost_usd, output_tokens | AI 生成结束（前端感知） |
| `socket:connect` | DEBUG | | Socket 连接 |
| `socket:join_room` | DEBUG | roomId | Socket 加入房间 |
| `socket:stream_start` | DEBUG | agentName, id | Socket 流开始 |
| `socket:stream_end` | DEBUG | id, duration_ms | Socket 流结束 |
| `room:list:load` | DEBUG | | 房间列表加载 |
| `msg:send_error` | ERROR | roomId, status, error | 消息发送失败 |
| `room:list_error` | ERROR | error | 房间列表加载失败 |
| `agent:load_error` | ERROR | error | Agent 配置加载失败 |
| `agent:save_error` | ERROR | error | Agent 配置保存失败 |
| `agent:delete_error` | ERROR | error | Agent 删除失败 |

## 日志阅读指南

### 日志文件位置

```
backend/logs/
├── server.log              # 服务启动/请求/Socket（无 roomId）
└── {roomId}.log           # 该 room 的前后端所有日志
```

### 快速定位问题

```bash
# 查看某 room 的所有日志
cat backend/logs/{roomId}.log | jq

# 筛选 ERROR 级别
cat backend/logs/{roomId}.log | jq 'select(.level == "ERROR")'

# 筛选后端路由决策
cat backend/logs/{roomId}.log | jq 'select(.event | startswith("route"))'

# 筛选前端行为
cat backend/logs/{roomId}.log | jq 'select(.source == "frontend")'

# 查看流式生成过程
cat backend/logs/{roomId}.log | jq 'select(.event | startswith("stream") or startswith("provider"))'

# 按时间范围
cat backend/logs/{roomId}.log | jq "select(.ts >= \"2026-04-13T14:00:00\")"
```

### 调试 F0042 路由问题

```
ui:msg:send     toAgentId=xxx toAgentName=架构师 mentionText=架构师     ← 用户发送了 @架构师
msg:recv        toAgentId=xxx mentions=[架构师]                        ← 后端收到请求
route.to        toAgentId=xxx toAgentName=架构师 path=callWorker      ← 路由到架构师
ai:start        agentName=架构师 provider=claude-code cliPath=/usr/bin/… ← 架构师启动，命令是 xxx
ai:end          agentName=架构师 outputLength=1234 duration_ms=8500   ← 架构师生成完毕
```

### 调试 F0042 路由问题

前端发送时记录了 `ui:msg:send`（含 mentionText 和 toAgentId）。
后端接收时记录了 `msg:recv`。
搜索这两个事件的 `toAgentId` 字段对比即可。
