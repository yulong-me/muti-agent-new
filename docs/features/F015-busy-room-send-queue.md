---
feature_ids: [F015]
related_features: [F013, F0050]
topics: [ux, messaging, queue, concurrency, turn-taking]
doc_kind: spec
created: 2026-04-16
updated: 2026-04-20
---

# F015: 房间忙时消息阻断与出站队列

> Status: done | Owner: codex

## Changelog

- 2026-04-20: 补齐前端出站队列实现，新增 queue helper 自动化测试，完成 RoomComposer/RoomView 联动与队列 UI 收口

## Why

当前输入区只在本次 HTTP 发送过程里使用 `sending` 做短暂禁用，但这并不覆盖 **Agent 真正执行中的整段窗口**。结果是：

1. **用户可以在 Agent 还在回答时继续发消息**，同一房间会出现多条用户消息和同一轮 AI 回复交错，轮次感混乱。
2. **路由预期被打散**：上一条消息还没处理完，下一条又已经发出，用户很难判断“这句话究竟接在哪一轮上下文后面”。
3. **没有缓冲机制**：如果用户想到下一句，只能等、手动复制到别处，或者冒险直接发出去。

因此，这个问题不该用“继续允许发送”来处理，而应该改成：**房间忙时阻断即时发送，改走显式的出站队列（outbox queue）**。

## What

引入一个**房间级的出站消息队列**：

1. **忙时阻断**
   - 当房间内任一 Agent 正在执行时，用户点击发送或回车，不直接调用 `POST /api/rooms/:id/messages`。
   - 先通过现有 F013 规则校验消息必须带有效 `@专家`；校验通过后，将消息加入本地出站队列。

2. **空闲时自动发送**
   - 当房间从 busy 变为 idle 时，自动按 FIFO 发送队首消息。
   - 同一时刻只允许一个出站消息处于 `dispatching`，其余继续等待。

3. **队列可取消**
   - 尚未发出的队列项可以直接取消，取消后从队列移除，不进入消息流，不写入后端。

4. **队列可撤回**
   - 队列尾项支持“撤回到输入框”。
   - 撤回后，该项从队列移除，并将原始文本完整恢复到输入框，供用户修改后重新发送。
   - 为避免顺序语义混乱，仅允许撤回**最后一条未发出消息**。

5. **后端兜底防重入**
   - 即使前端已经阻断，后端仍需增加房间 busy 校验。
   - 当存在执行中的 Agent 时，直接调用消息接口应返回 `409 ROOM_BUSY`，防止多标签页或外部调用绕过前端保护。

## Busy 定义

房间满足任一条件即视为 busy：

- 前端 `streamingAgentIds.size > 0`
- 或后端轮询 / socket 同步的 `agents.status` 中存在 `thinking` / `waiting`

只有当以上条件全部消失时，房间才转为 idle，并触发队列 drain。

## 队列模型

```ts
interface OutgoingQueueItem {
  id: string
  content: string           // 包含显式 @mention 的原始文本
  toAgentId: string
  toAgentName: string
  createdAt: number
  status: 'queued' | 'dispatching'
}
```

## In Scope

- `RoomView_new.tsx` 增加房间 busy 判定
- 忙时发送拦截，不立即调用后端
- 新增本地出站队列状态与 FIFO drain 机制
- 队列 UI：展示目标专家、文本摘要、排队顺序、取消/撤回操作
- 后端 `POST /api/rooms/:id/messages` 增加 busy 保护，返回 409
- 与 F013 显式路由规则兼容：**无有效 `@专家` 仍然不能入队**

## Out of Scope

- 队列跨刷新持久化（本期队列仅保留在当前页面会话中）
- 队列跨设备/多标签页同步
- 队列重排、批量发送、优先级插队
- 已经成功发出的消息撤回

## UX 规则

1. **忙时仍可写输入框**
   - 不锁死输入区；用户可以继续输入和排队。
   - 阻断的是“立即发送”，不是“继续思考”。

2. **发送反馈清晰**
   - 忙时点击发送后，发送按钮切换为“加入队列”，且消息立即出现在“待发队列”中。

3. **队列与发言队列分离**
   - 现有 `MentionQueue` 表示“谁将发言 / 正在发言”。
   - 新队列表示“用户待发出的消息”。
   - 两者必须是两个独立 UI 区块，避免语义混淆。

4. **撤回不覆盖现有草稿**
   - 若输入框已有未发送内容，则“撤回到输入框”按钮禁用，并提示先处理当前草稿。

## Acceptance Criteria

- [x] AC-1: 当任一 Agent 正在执行时，用户发送新消息不会立即进入后端消息流，而是进入出站队列。
- [x] AC-2: 出站队列在输入区附近可见，至少展示目标专家、内容摘要、排队顺序。
- [x] AC-3: 房间恢复 idle 后，队列按 FIFO 自动逐条发送；同一时间最多只发送一条。
- [x] AC-4: 用户可以取消任意一条尚未发出的队列项；取消后该消息不会出现在会话流中。
- [x] AC-5: 用户可以撤回队列尾项到输入框；撤回后该项从队列移除，文本完整恢复。
- [x] AC-6: 若输入框已有草稿，撤回按钮不可用，避免覆盖当前草稿。
- [x] AC-7: 后端在房间 busy 时对直接消息请求返回 `409 ROOM_BUSY`，前端能正确处理该错误并保持队列一致。
- [x] AC-8: 无有效 `@专家` 的消息既不能直接发送，也不能入队；F013 规则保持成立。

## Proposed File Changes

- `frontend/components/RoomView_new.tsx` — 忙时拦截、队列状态、自动 drain、409 处理
- `frontend/components/OutgoingMessageQueue.tsx` — 新增用户出站队列组件
- `frontend/components/RoomComposer.tsx` — 暴露 draft/busy 状态给父层，忙时按钮文案切换为“加入队列”
- `frontend/lib/outgoingQueue.ts` — 队列纯逻辑 helper（busy 判定、FIFO、dispatching、撤回）
- `backend/src/routes/rooms.ts` — `POST /api/rooms/:id/messages` 增加 busy 保护与 `409 ROOM_BUSY`
- `backend/tests/outgoingQueue.test.ts` — 队列 helper 自动化测试

## Dependencies

- F013: 强制显式路由（消息必须先有明确目标）
- F0050: Agent 发言队列（作为并列 UI，需要语义分离）

## Risk

- 若仅做前端阻断、不做后端 409 保护，多标签页仍可能绕过限制并发发消息。
- 若允许任意队列项撤回到输入框，会打乱 FIFO 语义。
- 若 busy 判定只依赖本地 `streamingAgentIds`，在刷新或 socket 短暂丢失时可能误判；需要结合 `agents.status`。

## Open Questions

- 是否需要为队列项提供“失败重试”按钮，还是统一回到队列头自动重试？
- 房间切换时，本地未发出队列是否要给离开确认？本期先不做持久化，但可能需要最小提醒。

## Verification

- `pnpm --dir backend exec vitest run tests/outgoingQueue.test.ts tests/rooms.http.test.ts`
- `pnpm --dir frontend build`
