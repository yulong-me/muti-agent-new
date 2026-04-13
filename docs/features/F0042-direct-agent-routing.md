---
feature_ids: [F0042]
topics: [routing, multi-agent, direct-message]
doc_kind: feature
created: 2026-04-13
status: phase1-done
title: F0042 直接 Agent 路由 — 用户直连专家
---

## 背景与问题

当前架构是「主持人中转」模式：

```
用户消息 → 主持人（路由器 prompt 分析） → 主持人决定 @谁 → Worker 响应
```

问题：
1. 主持人先分析再转发，**响应延迟加倍**（等主持人回复完才能触发 Worker）
2. 主持人 prompt 复杂，容易出现决策冲突（如同时「询问用户」+「@多个专家」）
3. 用户无法直接和某个专家对话，必须通过主持人转达

## 目标

改为「直接路由 + 主持人保留」模式：

```
用户消息
  ├─ 有 @agent → 直接发给该 agent（主持人可干预）
  └─ 无 @ → 默认发给主持人（MANAGER）
```

- **响应更快**：有 @ 时直达目标 agent，不再等主持人分析再转发
- **主持人保留**：主持人仍是「管对话流程的人」，用户直接 @ 是快捷方式，不是替代主持人职责
- **A2A 链保持**：agent 回复中的 @mention 仍正常触发
- **不支持多接收人**：每次只能选一个 agent

## API 设计

### POST /api/rooms/:id/messages

**请求体（方案 B — 显式 toAgentId）**：
```json
{
  "content": "秦始皇功绩如何？",
  "toAgentId": "shangyang"
}
```

- `toAgentId`：必填，room 内 agent 的 `id`
- `content`：消息内容，可包含任意 `@mention`（仅作对话上下文，不影响路由）

**行为**：
1. 解析 `toAgentId`，找到对应 agent
2. 直接调用 `streamingCallAgent(agentId, content)`
3. agent 回复中的 `@mention` → A2A 触发

**Backward compat**：
- 旧客户端发 `{ content }`（无 `toAgentId`）→ 后端按 `content` 里的第一个 `@mention` 路由（向后兼容方案 A）
- 完全没有 `@` 且无 `toAgentId` → 返回 400（「必须选择接收人」）

### 响应

```json
{ "status": "ok", "messageId": "uuid" }
```

## 前端改动

### 接收人选择 UI

**新增：`selectedRecipientId` state**

- 默认值：房间的 MANAGER agent.id
- 发送按钮旁显示当前接收人（如 `→ 主持人(软工)`）

**@mention picker 改造**：

| 操作 | 行为 |
|------|------|
| 输入 `@` | 弹出面板 → 选择 agent → 设为 `selectedRecipientId` |
| 选完后文本变成 `@xxx` | 面板关闭，textarea 保留 `@xxx`（展示用） |
| 无 `@` 输入 | `selectedRecipientId = MANAGER.id`（默认） |
| `Esc` / 点击外部 | 面板关闭 |

**发送时**：
```typescript
const toAgentId = selectedRecipientId  // 从 state 读取
POST /api/rooms/:id/messages
{ content: userInput, toAgentId }
```

### 消息气泡改动

用户消息气泡上显示接收人标识：

```
┌─────────────────────────────────┐
│ 你 (11:20)          → @全栈开发者 │
├─────────────────────────────────┤
│ 全栈开发者 (11:20)              │
│ 好的，我来帮你看看...
└─────────────────────────────────┘
```

## 后端改动

### stateMachine.ts

**核心逻辑**：

```
if (toAgentId === MANAGER) → handleUserMessage(roomId, content)  // 主持人路由
else (WORKER)            → 直接 streamingCallAgent(toAgentId)    // 跳过主持人
```

**新增 `routeToAgent(roomId, content, toAgentId)`**：

```typescript
export async function routeToAgent(
  roomId: string,
  content: string,
  toAgentId: string,
): Promise<void> {
  addUserMessage(roomId, content)  // 仍保存用户消息

  const room = store.get(roomId)
  if (!room) return

  if (toAgentId === room.agents.find(a => a.role === 'MANAGER')?.id) {
    // 发给主持人 → 走现有路由器逻辑
    await handleUserMessage(roomId, content)
  } else {
    // 直接发给 Worker → 跳过主持人
    const target = room.agents.find(a => a.id === toAgentId)
    if (!target) throw new Error(`Agent not found: ${toAgentId}`)
    await callWorker(roomId, target.id, content)
  }
}
```

**Backward compat**：`handleUserMessage` 保留，无 `toAgentId` 时走原有路由器逻辑。

### A2A 保持不变

- `a2aOrchestrate` 不变：agent 回复中扫描 `@mention` → 触发其他 agent

## 数据库

- `messages` 表：`to_agent_id` 字段（可空，兼容旧数据）
  ```sql
  ALTER TABLE messages ADD COLUMN to_agent_id TEXT;
  ```

## 兼容性

| 场景 | 行为 |
|------|------|
| 新客户端 + `toAgentId`=MANAGER | 走主持人路由逻辑 |
| 新客户端 + `toAgentId`=WORKER | 直接发给目标 Worker |
| 旧客户端（无 `toAgentId`） | 走现有 `handleUserMessage` |
| `toAgentId` 指向不存在的 agent | 返回 400 |
| `toAgentId` 指向 disabled agent | 返回 400 |

## 实施步骤

### Phase 1 — 后端路由重构

1. `rooms.ts`：POST `/messages` 接受 `toAgentId`
2. `stateMachine.ts`：
   - 新增 `routeToAgent(roomId, content, toAgentId)`
   - `toAgentId === MANAGER` → 仍走现有 `handleUserMessage`（主持人路由逻辑）
   - `toAgentId === WORKER` → 直接调用目标 agent（跳过主持人 prompt）
3. Backward compat：无 `toAgentId` → 走现有 `handleUserMessage`
4. `migrate.ts`：加 `to_agent_id` 字段

### Phase 2 — 前端对接

5. `selectedRecipientId` state + 默认 MANAGER
6. 发送时传 `toAgentId`
7. @mention picker → 写入选中 agent 到 textarea + 设为 `selectedRecipientId`

### Phase 3 — 气泡 + 列表显示

8. 消息气泡加接收人标识（如 `→ @全栈开发者`）
9. 房间列表每条卡片显示「正在和谁对话」badge（最后一条用户消息的接收人）

## 影响评估

| 影响点 | 说明 |
|--------|------|
| 响应延迟 | 有 @WORKER 时 ↓ 减少主持人分析这一步 |
| 主持人角色 | 不变，仍是「管对话流程的人」 |
| A2A 链 | 不变，仍正常工作 |
| API 兼容性 | 旧客户端无 toAgentId → 走现有 handleUserMessage |
| 数据库 | 加 `to_agent_id` 列（向后兼容，可空） |

## 实施步骤

### Phase 1 — 后端路由重构（最小化）

1. `rooms.ts`：POST `/messages` 接受 `toAgentId`
2. `stateMachine.ts`：新增 `routeToAgent()`
3. `handleUserMessage` 改为 backward compat wrapper
4. `migrate.ts`：加 `to_agent_id` 字段

### Phase 2 — 前端对接

5. `selectedRecipientId` state + 默认 MANAGER
6. 发送时传 `toAgentId`
7. @mention picker → 写入选中 agent 到 textarea + 设为 `selectedRecipientId`

### Phase 3 — 气泡显示

8. 消息气泡加接收人标识

## 影响评估

| 影响点 | 说明 |
|--------|------|
| 响应延迟 | 有 @WORKER 时 ↓ 减少主持人分析这一步 |
| 主持人角色 | 不变，仍是「管对话流程的人」 |
| A2A 链 | 不变，仍正常工作 |
| API 兼容性 | 旧客户端无 toAgentId → 走现有 handleUserMessage |
| 数据库 | 加 `to_agent_id` 列（向后兼容，可空） |
