---
feature_ids: [F007]
related_features: [F004, F0042]
topics: [multi-agent, chat, room-management]
doc_kind: spec
created: 2026-04-14
---

# F007: 讨论中邀请 Agent 入群

> Status: done | Owner: codex

## Why

当前只能在创建 Room 时选定参与专家。讨论过程中发现需要某位专家介入时，必须新建 Room 再复制上下文，体验割裂。

类似群聊"拉人入群"的操作体验：无需中断讨论，随时从侧边栏邀请新 Agent 加入，当前上下文（历史消息）对新成员可见。

## What

在 Room 运行过程中，通过 UI 按钮触发 Agent 选择器，选中的 Agent 被加入 room 并收到加入通知，同时在聊天区显示系统消息。

## UI Mockup

```
┌─ RoomView_new ──────────────────────────────────────────┐
│ [←] 自由讨论                    [🕐] [☾] [+] [⋯]         │
│                                                         │
│  主持人: 好的，我们继续...                               │
│  ┌──────────────────────────────────┐                   │
│  │ 司马迁: 从历史角度看...           │                   │
│  └──────────────────────────────────┘                   │
│                                                         │
│  诸葛亮: 我认为应该分三步走。                           │
│                                                         │
│  曹操: 我有不同看法。                                   │
│                                                         │
│  ┌──────────────────────────────────┐                   │
│  │ 💬 乔布斯 加入了讨论               │  ← 系统消息       │
│  └──────────────────────────────────┘                   │
│                                                         │
│  乔布斯: 从产品角度看这个问题...                         │
│  ┌──────────────────────────────────┐                   │
│  │ [💬 Thinking...]                  │                   │
│  │ [💬 Output...]                    │                   │
│  └──────────────────────────────────┘                   │
│                                                         │
│  ┌─────────────────────────────────────────┐             │
│  │ 输入消息...                     [发送]  │             │
│  └─────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────┘

点击 [+] 按钮后：
┌─ 邀请专家 ────────────────────────────────────────┐
│ 🔍 搜索专家...                                    │
│ ─────────────────────────────────────────────────│
│ 👤 乔布斯           产品设计 / 创新思维     [邀请] │
│ 👤 爱因斯坦         物理学 / 科研方法     [邀请] │
│ 👤 图灵             计算机科学 / AI        [邀请] │
│ 👤 马斯克           商业 / 航天 / 能源    [邀请] │
│ ─────────────────────────────────────────────────│
│                                  [取消]            │
└──────────────────────────────────────────────────┘
```

## Architecture

### Frontend

- **RoomHeader**：`[+]` 按钮，点击弹出 `AgentInviteDrawer`（或内联选择列表）
- **AgentInviteDrawer**：搜索 + 列表，展示未在当前 room 的 agent，点击"邀请"触发 API
- **MessageBubble**：识别 `type === 'system'`，渲染为居中系统消息
- **Socket 事件**：监听 `room:agent-joined` 事件，实时刷新 agent 列表和消息区

### Backend

```
POST /api/rooms/:id/agents
Body: { agentId: string }
→ 验证 room 存在且在 RUNNING 状态
→ 验证 agentId 未在当前 room
→ 创建 agent entry，追加到 room.agents
→ 写入系统消息 { type: 'system', agentName, timestamp }
→ 返回更新后的 room
→ Socket.IO 广播 'room:agent-joined'
```

### Socket Event

```
room:agent-joined
Payload: {
  roomId: string
  agent: AgentEntry       // 新加入的 agent
  systemMessage: Message  // 加入通知消息
  agents: Agent[]         // 更新后的 agent 列表
}
```

## API Design

### POST /api/rooms/:id/agents

**Request**

```json
{ "agentId": "jobs" }
```

**Response 200**

```json
{
  "room": { /* 完整 room 对象，agents 数组已更新 */ },
  "systemMessage": {
    "id": "uuid",
    "type": "system",
    "content": "乔布斯 加入了讨论",
    "agentName": "乔布斯",
    "timestamp": 1744651200000
  }
}
```

**Error Responses**

| Status | Condition | Body |
|--------|-----------|------|
| 400 | `agentId` 已在 room 中 | `{ error: "Agent 已在讨论中" }` |
| 400 | room 已结束 | `{ error: "Room 已结束，无法添加成员" }` |
| 400 | agent 是 MANAGER 角色 | `{ error: "无法追加 MANAGER 角色" }` |
| 400 | agent 未启用 | `{ error: "Agent 未启用，无法加入讨论" }` |
| 404 | room 不存在 | `{ error: "Room not found" }` |
| 404 | agentId 无效 | `{ error: "Agent not found: {id}" }` |

## Data Model

### Room.agents 扩展

`agents` 数组现在支持动态追加，运行时新增的 agent 与创建时加入的 agent 无区别对待。

### System Message Schema

```typescript
interface AgentJoinedMessage extends Message {
  type: 'system'
  agentName: string       // 展示用，如"乔布斯"
  agentRole: 'WORKER'    // 固定为 WORKER
}
```

## Acceptance Criteria

- [x] AC-1: RoomHeader 显示 `[+]` 邀请按钮，点击弹出 AgentInviteDrawer
- [x] AC-2: AgentInviteDrawer 展示所有未在当前 room 的 agent，支持搜索过滤
- [x] AC-3: 点击"邀请"后 agent 加入 room，agent 出现在 AgentPanel 和 RoomHeader
- [x] AC-4: 聊天区显示居中的系统消息："[AgentName] 加入了讨论"
- [x] AC-5: Socket 实时推送，其他在线用户也能看到新 agent 加入
- [x] AC-6: 已在 room 中的 agent 不出现在邀请列表
- [x] AC-7: 已结束的 room（DONE）不允许邀请新 agent
- [x] AC-8: 新加入的 agent 回填当前 room 完整消息历史，可从上下文继续响应
- [x] AC-9: 后端强制校验：追加的 agent 必须为 WORKER 角色，拒绝 MANAGER

## Changelog

- 2026-04-14: 初始实现（AC-1~7, AC-9）
- 2026-04-14: 补充 enabled 校验、消息去重、文档与实现对齐（移除 variant）
- 2026-04-20: 新加入专家首次真正被调用时注入完整 room 历史；已有专家维持最近窗口

## Dependencies

- F004（Manager Router）：room 生命周期管理基础
- F0042（Direct Agent Routing）：`toAgentId` 路由基础
- Socket.IO 基础设施：已在 F004 中集成

## Risk

- **幂等性**：重复邀请同一 agent 返回明确错误而非静默忽略
- **角色限制**：后端强制校验，仅允许追加 WORKER（MANAGER 角色不可追加）
- **历史上下文回填**：新 agent 加入后需注入完整消息历史，agent CLI 启动参数需携带消息上下文

## Open Questions

- [x] 新加入的 agent 是否自动看到历史消息上下文？**是**，加入时回填当前 room 的完整消息历史，agent 从上下文继续
- [x] 加入角色是 MANAGER 还是 WORKER？**WORKER**，新加入的 agent 均为 WORKER 角色（与创建时一致）
- [x] 是否需要审批确认？**不需要**，直接加入
- [x] 是否有邀请上限？**无上限**，可随时拉任意数量 WORKER 入群
