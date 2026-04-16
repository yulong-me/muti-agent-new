---
feature_ids: [F011]
related_features: [F008, F010]
topics: [ux, room-list, sidebar, navigation]
doc_kind: spec
created: 2026-04-16
---

# F011: 会话列表 → 导航列表重构

> Status: spec | Owner: TBD

## Why

当前 `RoomListSidebar` 更像"**会话路由监控面板**"，而非"**会话导航列表**"。

铲屎官实测反馈（参考 Vercel Web Interface Guidelines）：列表把**路由状态**当成了导航信息——展示的是最后一条消息的 `toAgentId`（收件人），而不是会话本身的有效摘要。这在多专家协作、AI 已经接管、甚至会话已完成时，都会给出错误信息。

问题的根因是：前端 `SidebarRoom` 接口只保留了 `id / topic / createdAt / state`，丢弃了后端已返回的 `updatedAt` 和 `workspace`，同时引入了路由层的 `roomsLastToAgentMap` 来驱动导航摘要。

## What

### 问题与修复对照

| # | 当前问题 | 根因 | 修复方向 |
|---|---------|------|----------|
| P0-1 | "正在和 X 对话"展示的是路由收件人，不是会话摘要 | `roomsLastToAgentMap` 暴露了路由层状态 | 改为展示参与专家列表（`agents`），不再用路由收件人驱动摘要 |
| P0-2 | "2 小时前"显示的是 `createdAt`，不是 `updatedAt` | 前端 `SidebarRoom` 接口丢弃了 `updatedAt` 字段 | 恢复 `updatedAt` 并用于时间显示 |
| P0-3 | 删除确认是内联替换整张卡片，列表位置跳动 | 确认态直接替换整条 `RoomItem` DOM | 改为叠加态（overlay/drawer），不改变其他卡片位置 |
| P0-4 | 键盘 Space 逻辑不稳定，语义嵌套混乱 | `div[role=button]` 内嵌 `button[type=button]` | 重构交互语义，键盘操作用 `button` 主元素，删除用独立按钮 |
| P0-5 | 删除按钮只靠 hover 可见，触屏场景不可发现 | `opacity-0 group-hover:opacity-100` 隐式依赖鼠标悬停 | 触屏：移入 mobile overflow menu；桌面：hover 显示 + 始终可键盘访问 |
| P1-1 | 无工作目录信息 | `SidebarRoom` 接口无 `workspace` 字段 | 恢复 `workspace`；桌面：hover tooltip；移动端/键盘：点击展开完整路径 |
| P1-2 | 无最近消息预览 | 列表未展示任何消息内容，且列表不刷新 | API 预计算 preview 字段；列表轮询 30s 刷新 |

## In Scope

- `SidebarRoom` 接口扩展：`updatedAt`、`workspace`、`agents`、`preview`
- `roomsLastToAgentMap` 从 `RoomItem` 移除，不再驱动摘要
- `updatedAt` 用于时间显示（替代 `createdAt`）
- 参与专家列表替代"收件人"文字
- 删除确认改为 overlay 态，不内联替换卡片
- 交互语义重构：键盘逻辑、hover/touch 可发现性
- 工作目录：hover tooltip（桌面）+ 点击展开（移动端/键盘）
- 列表轮询策略：挂载时拉取 + 每 30s 轮询
- 后端预计算 `preview` 字段（前 40 字有效消息）

## Out of Scope

- 消息预览的实时流式更新（RoomView_new 已处理消息同步）
- 批量删除、排序等进阶功能
- 会话归档（已有 archive 入口）

## Data Contract

### 前端接口

```typescript
interface SidebarRoom {
  id: string
  topic: string
  createdAt: number
  updatedAt: number     // 用于时间显示
  state: DiscussionState
  workspace?: string     // 工作目录
  agents: Agent[]        // 参与专家（替代 roomsLastToAgentMap）
  preview?: string       // 最后一条有效消息前 40 字
}
```

### 后端 API 变更

**`GET /api/rooms` 返回值变更**（新增 `preview` 字段）：

```typescript
// roomsRepo.list() 返回的每条记录新增 preview 字段
// 逻辑：从 room.messages 找到最后一条 type='user' 或 type='agent' 的消息，
// 取 content 前 40 字，无消息则 preview = undefined
```

**实现位置**：`backend/src/db/repositories/rooms.ts` 的 `list()` 方法，在 map 前计算 preview。

### 刷新策略

| 时机 | 行为 |
|------|------|
| RoomListSidebar 挂载 | `fetch /api/rooms`，填充列表 |
| 每 30 秒（轮询） | `fetch /api/rooms`，diff 后更新 `updatedAt`、`preview` |
| 用户进入某 Room | 该 Room 的消息通过 RoomView_new 的 polling 更新 |
| 用户发消息后 | RoomView_new polling 会拉取新 state，触发父组件刷新 |

> 注：`updatedAt` 在后端每次消息写入时更新（已有），`preview` 随消息写入同步计算。轮询确保跨 Tab/跨端场景下列表也保持最新。

## Acceptance Criteria

- [ ] AC-1: `SidebarRoom` 接口包含 `updatedAt`、`workspace`、`agents`，不再需要 `roomsLastToAgentMap` 驱动摘要
- [ ] AC-2: 列表时间显示使用 `updatedAt`，不再是 `createdAt`
- [ ] AC-3: 卡片摘要展示参与专家列表（`主持人 + N 位专家`），不再展示"正在和 X 对话"
- [ ] AC-4: 删除确认改为 overlay 叠加态，不内联替换卡片，不造成列表位置跳动
- [ ] AC-5: 键盘操作：`Enter`/`Space` 触发进入；`Delete` 触发删除确认；删除按钮始终键盘可达
- [ ] AC-6: 触屏场景：删除入口在 overflow menu 内可见
- [ ] AC-7: 工作目录：桌面 hover tooltip；移动端/键盘点击展开完整路径
- [ ] AC-8: 列表展示 `preview` 字段（前 40 字有效消息），由后端预计算，前端轮询刷新

## Proposed File Changes

- `frontend/components/RoomListSidebar.tsx` — 重构 `RoomItem`、恢复字段、`agents` 驱动摘要、列表轮询
- `frontend/components/RoomView_new.tsx` — 移除不再需要的 `roomsLastToAgentMap` prop 传递；更新 `SidebarRoom` 类型适配 API
- `backend/src/db/repositories/rooms.ts` — `list()` 方法新增 `preview` 字段计算

## Dependencies

- F008（已验收）：UX 骨架，暂无依赖
- F010（已验收）：CreateRoomModal，与本 feature 正交
- 后端需改动：`roomsRepo.list()` 新增 `preview` 字段计算（`GET /api/rooms` 返回值扩展）