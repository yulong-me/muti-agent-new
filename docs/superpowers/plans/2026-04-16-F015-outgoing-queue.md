# F015: Outgoing Message Queue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a room-level outgoing message queue that intercepts sends during Agent busy state, auto-drains on idle, and lets users cancel/recall queued items.

**Architecture:**
- Frontend: new `OutgoingMessageQueue` component + `RoomView_new` busy-check + queue state + FIFO drain loop
- Backend: `isRoomBusy()` helper + 409 ROOM_BUSY guard on `POST /:id/messages`
- Queue is purely in-memory (session-scoped); backend 409 is the multi-tab safety net

**Tech Stack:** Next.js (frontend), Express/TypeScript (backend), SQLite, Socket.io

---

## File Map

| File | Role |
|------|------|
| `frontend/components/OutgoingMessageQueue.tsx` | **NEW** — user queue component (input area above) |
| `frontend/lib/agents.tsx` | **MODIFY** — add `OutgoingQueueItem` type |
| `frontend/components/RoomView_new.tsx` | **MODIFY** — busy state, queue refs, drain, 409 handling |
| `backend/src/services/stateMachine.ts` | **MODIFY** — add `isRoomBusy(roomId)` helper |
| `backend/src/routes/rooms.ts` | **MODIFY** — 409 ROOM_BUSY guard |
| `backend/tests/rooms.test.ts` | **MODIFY** — add ROOM_BUSY rejection test |
| `docs/features/F015-busy-room-send-queue.md` | **MODIFY** — check off AC items |

---

## Task 1: Backend — `isRoomBusy()` helper + 409 guard

**Files:**
- Modify: `backend/src/services/stateMachine.ts` (add helper)
- Modify: `backend/src/routes/rooms.ts` (add 409 guard)
- Modify: `backend/tests/rooms.test.ts` (add test)

---

- [ ] **Step 1: Add `isRoomBusy()` to stateMachine.ts**

Find the end of the stateMachine.ts file (after `a2aOrchestrate`) and add this helper function:

```typescript
// ─── Room Busy Helper ────────────────────────────────────────────────────────

/**
 * Returns true if any agent in the room is currently executing.
 * Used by the backend 409 guard to prevent concurrent message dispatch.
 */
export function isRoomBusy(roomId: string): boolean {
  const room = store.get(roomId);
  if (!room) return false;
  return room.agents.some(a => a.status === 'thinking' || a.status === 'waiting');
}
```

---

- [ ] **Step 2: Add 409 guard to rooms.ts POST handler**

Read `backend/src/routes/rooms.ts` around line 124. Find the `POST /:id/messages` handler. Add the busy check **after** the `DONE` state check and **before** the content parsing:

```typescript
  // F015: room busy guard — prevents concurrent dispatch (multi-tab safety net)
  const roomBusy = room.agents.some(a => a.status === 'thinking' || a.status === 'waiting');
  if (roomBusy) {
    return res.status(409).json({ code: 'ROOM_BUSY', error: 'Room has an Agent currently executing' });
  }
```

Insert this between line 128 (`Room already done` check) and line 131 (`const { content, toAgentId }`).

---

- [ ] **Step 3: Write failing test for 409 ROOM_BUSY**

Read `backend/tests/rooms.test.ts`. Find the `describe('POST /:id/messages')` block. Add this test case **after** the existing `POST /:id/messages` tests:

```typescript
    it('returns 409 ROOM_BUSY when an agent is currently thinking', async () => {
      const { isRoomBusy } = await import('../src/services/stateMachine.js');
      const { store } = await import('../src/store.js');
      const { agentsRepo } = await import('../src/db/index.js');

      const mockRoom = {
        id: 'room-busy',
        topic: 'Test',
        state: 'RUNNING' as const,
        agents: [
          {
            id: 'worker-1',
            role: 'WORKER' as const,
            name: '测试员',
            domainLabel: '测试',
            configId: 'worker-1',
            status: 'thinking' as const, // ← busy
          },
        ],
        messages: [],
        sessionIds: {},
        a2aDepth: 0,
        a2aCallChain: [],
      };
      vi.mocked(store.get).mockReturnValue(mockRoom);

      const res = await server.inject({
        method: 'POST',
        url: '/api/rooms/room-busy/messages',
        payload: { content: '@测试员 hello', toAgentId: 'worker-1' },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('ROOM_BUSY');
    });
```

---

- [ ] **Step 4: Run test to verify it fails**

```bash
pnpm --dir backend exec vitest run rooms.test.ts -v
```
Expected: FAIL — 409 guard not yet in POST handler.

---

- [ ] **Step 5: Run backend build to check TS**

```bash
pnpm --dir backend build
```
Expected: PASS (no TS errors).

---

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/stateMachine.ts backend/src/routes/rooms.ts backend/tests/rooms.test.ts
git commit -m "feat(F015): backend 409 ROOM_BUSY guard + isRoomBusy helper"
```

---

## Task 2: Frontend — `OutgoingQueueItem` type

**Files:**
- Modify: `frontend/lib/agents.tsx` (add type + export)

---

- [ ] **Step 1: Add `OutgoingQueueItem` interface to agents.tsx**

Read `frontend/lib/agents.tsx`. Find where `AgentRunErrorEvent` is defined (around line 100). Add the new interface right before or after it:

```typescript
export interface OutgoingQueueItem {
  id: string
  content: string
  toAgentId: string
  toAgentName: string
  createdAt: number
  status: 'queued' | 'dispatching'
}
```

Also export it from the file (it should already be exported if you add it at module level).

---

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/agents.tsx
git commit -m "feat(F015): add OutgoingQueueItem type"
```

---

## Task 3: Frontend — `OutgoingMessageQueue` component

**Files:**
- Create: `frontend/components/OutgoingMessageQueue.tsx` (new)
- Modify: `frontend/components/RoomView_new.tsx` (integrate)

---

- [ ] **Step 1: Create `OutgoingMessageQueue.tsx`**

Read `frontend/components/MentionQueue.tsx` for style reference. Create a **new file** `frontend/components/OutgoingMessageQueue.tsx`:

```tsx
'use client'

import { useMemo } from 'react'
import { X, CornerDownLeft, Clock } from 'lucide-react'
import type { OutgoingQueueItem } from '../lib/agents'

interface OutgoingMessageQueueProps {
  items: OutgoingQueueItem[]
  /** currently dispatching item id */
  dispatchingId: string | null
  onCancel: (itemId: string) => void
  onRecall: (itemId: string) => void
  /** true when input box has non-empty draft — recall should be disabled */
  inputHasDraft: boolean
  agents: { id: string; name: string }[]
}

export function OutgoingMessageQueue({
  items,
  dispatchingId,
  onCancel,
  onRecall,
  inputHasDraft,
  agents,
}: OutgoingMessageQueueProps) {
  if (items.length === 0) return null

  return (
    <div className="px-4 md:px-8 py-2 bg-surface/80 backdrop-blur-sm rounded-xl border border-line shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <CornerDownLeft className="h-3 w-3 text-ink-soft shrink-0" />
        <span className="text-[10px] font-semibold text-ink-soft uppercase tracking-wider shrink-0">
          待发队列
        </span>
        <span className="text-[10px] text-ink-soft/60">{items.length} 条</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          const isDispatching = item.status === 'dispatching'
          const agentName = item.toAgentName

          return (
            <div key={item.id} className="flex items-start gap-2 group">
              {/* Queue position */}
              <span className="mt-0.5 text-[10px] text-ink-soft/50 w-4 shrink-0 text-right">
                {index + 1}
              </span>

              {/* Agent tag */}
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-line bg-surface-muted text-[11px] text-ink shrink-0 max-w-[80px]">
                <span className="truncate">@{agentName}</span>
              </div>

              {/* Content preview */}
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-ink line-clamp-1 break-all">
                  {item.content.length > 60 ? item.content.slice(0, 60) + '…' : item.content}
                </p>
                {isDispatching && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <Clock className="h-2.5 w-2.5 text-amber-500 animate-pulse" />
                    <span className="text-[10px] text-amber-600 font-medium">发送中…</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              {!isDispatching && (
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {/* Cancel */}
                  <button
                    type="button"
                    onClick={() => onCancel(item.id)}
                    className="p-1 rounded hover:bg-red-50 text-ink-soft hover:text-red-500 transition-colors"
                    title="取消"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  {/* Recall (last item only, no draft conflict) */}
                  {isLast && (
                    <button
                      type="button"
                      onClick={() => onRecall(item.id)}
                      disabled={inputHasDraft}
                      title={inputHasDraft ? '输入框有草稿，先处理当前内容' : '撤回到输入框'}
                      className="p-1 rounded hover:bg-blue-50 text-ink-soft hover:text-blue-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <CornerDownLeft className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

---

- [ ] **Step 2: Commit**

```bash
git add frontend/components/OutgoingMessageQueue.tsx
git commit -m "feat(F015): add OutgoingMessageQueue component"
```

---

## Task 4: Frontend — RoomView integration

**Files:**
- Modify: `frontend/components/RoomView_new.tsx` (main integration)

---

- [ ] **Step 1: Add queue state + refs**

Read `frontend/components/RoomView_new.tsx` around line 50–70 (state declarations). Add these after the existing state declarations:

```tsx
  // F015: outgoing message queue state
  const [outgoingQueue, setOutgoingQueue] = useState<OutgoingQueueItem[]>([])
  const outgoingQueueRef = useRef<OutgoingQueueItem[]>([])
  const dispatchingRef = useRef<string | null>(null)
  const isDrainingRef = useRef(false)
```

Also import the new component at the top of the file:
```tsx
import { OutgoingMessageQueue } from './OutgoingMessageQueue'
```

---

- [ ] **Step 2: Add `isRoomBusy` computed value**

Find the `streamingAgentIds` state declaration. After it, add:

```tsx
  // F015: room is busy when any agent is streaming or has thinking/waiting status
  const isRoomBusy = streamingAgentIds.size > 0 || agents.some(a => a.status === 'thinking' || a.status === 'waiting')
```

---

- [ ] **Step 3: Add drain function**

Find the `useCallback` block for `sendPreparedContent` (around line 561). Add this new `useCallback` block **after** `copyFailedPrompt`:

```tsx
  // F015: drain the outgoing queue when room becomes idle
  const drainQueue = useCallback(async () => {
    if (isDrainingRef.current) return
    if (outgoingQueueRef.current.length === 0) return
    if (dispatchingRef.current !== null) return // already dispatching one

    isDrainingRef.current = true
    try {
      while (outgoingQueueRef.current.length > 0) {
        const item = outgoingQueueRef.current[0]
        dispatchingRef.current = item.id

        // Mark as dispatching in UI
        setOutgoingQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: 'dispatching' } : i))

        try {
          const res = await fetch(`${API}/api/rooms/${roomId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: item.content, toAgentId: item.toAgentId }),
          })
          if (res.status === 409) {
            // Room still busy — stop draining, item stays queued
            dispatchingRef.current = null
            setOutgoingQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: 'queued' } : i))
            break
          }
          if (!res.ok) {
            // Non-409 failure — remove failed item, continue with next
            const next = outgoingQueueRef.current.filter(i => i.id !== item.id)
            outgoingQueueRef.current = next
            dispatchingRef.current = null
            setOutgoingQueue(next)
            continue
          }
          // Success — remove from queue and continue
          const remaining = outgoingQueueRef.current.filter(i => i.id !== item.id)
          outgoingQueueRef.current = remaining
          dispatchingRef.current = null
          setOutgoingQueue(remaining)
        } catch {
          // Network error — leave item queued, stop draining
          dispatchingRef.current = null
          setOutgoingQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: 'queued' } : i))
          break
        }
      }
    } finally {
      isDrainingRef.current = false
    }
  }, [roomId])
```

---

- [ ] **Step 4: Add queue manipulation functions**

After `copyFailedPrompt` useCallback (around line 634), add:

```tsx
  // F015: enqueue a message when room is busy
  const enqueueMessage = useCallback((content: string, toAgentId: string, toAgentName: string) => {
    const item: OutgoingQueueItem = {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `q-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      content,
      toAgentId,
      toAgentName,
      createdAt: Date.now(),
      status: 'queued',
    }
    outgoingQueueRef.current = [...outgoingQueueRef.current, item]
    setOutgoingQueue([...outgoingQueueRef.current])
  }, [])

  // F015: cancel a queued item (remove without sending)
  const cancelQueuedItem = useCallback((itemId: string) => {
    const next = outgoingQueueRef.current.filter(i => i.id !== itemId)
    outgoingQueueRef.current = next
    setOutgoingQueue(next)
  }, [])

  // F015: recall last queued item back to input box
  const recallQueuedItem = useCallback((itemId: string) => {
    if (userInput.trim()) return // draft conflict — handled by UI disabled state
    const item = outgoingQueueRef.current.find(i => i.id === itemId)
    if (!item) return
    const next = outgoingQueueRef.current.filter(i => i.id !== itemId)
    outgoingQueueRef.current = next
    setOutgoingQueue(next)
    setUserInput(item.content)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [userInput])
```

---

- [ ] **Step 5: Modify `sendPreparedContent` — intercept busy state**

Read `sendPreparedContent` around line 561. Find the beginning:

```tsx
  const sendPreparedContent = useCallback(async (rawContent: string) => {
    if (!roomId || sending) return
    ...
```

Change the first guard to also check `isRoomBusy`:

```tsx
  const sendPreparedContent = useCallback(async (rawContent: string) => {
    if (!roomId || sending) return
```

After the F013 mention check and before `setSending(true)`, replace the `setSending(true)` block. Read the current code starting from `setMentionPickerOpen(false)` (line 574). Replace the entire block from `setMentionPickerOpen(false)` through the fetch call with this logic:

```tsx
    setMentionPickerOpen(false)

    // F015: if room is busy, enqueue instead of sending immediately
    if (isRoomBusy) {
      enqueueMessage(content, recipientId!, targetName!)
      return
    }

    setSending(true)
    // ... rest of the existing code from setSending(true) to end of try/catch
```

**Important:** The existing code after `setSending(true)` already handles the error case (restores `userInput` on failure). Keep all of it. Only add the `if (isRoomBusy)` block before `setSending(true)`.

---

- [ ] **Step 6: Wire drain trigger to `stream_end`**

Read the `socket.on('stream_end', ...)` handler (around line 227). Inside it, after `streamingMessagesRef.current.delete(data.agentId)` and after all existing logic, add:

```tsx
      // F015: trigger queue drain when last streaming agent finishes
      const stillStreaming = streamingAgentIdsRef.current.size
      if (stillStreaming === 0) {
        setTimeout(() => drainQueue(), 100)
      }
```

Also in the `socket.on('room_error_event', ...)` handler (around line 217), after `streamingMessagesRef.current.delete(roomError.agentId)`, add the same drain trigger:

```tsx
      const stillStreaming = streamingAgentIdsRef.current.size
      if (stillStreaming === 0) {
        setTimeout(() => drainQueue(), 100)
      }
```

---

- [ ] **Step 7: Handle 409 ROOM_BUSY in `sendPreparedContent` fetch response**

Read the fetch error handling inside `sendPreparedContent` (around line 595-606). Currently it only handles `400`. Add `409` handling:

```tsx
      if (!res.ok) {
        const err = await res.text()
        logError('msg:send_error', { roomId, status: res.status, error: err })
        // F015: 409 means room became busy concurrently — enqueue the message
        if (res.status === 409) {
          setSending(false)
          enqueueMessage(content, recipientId!, targetName!)
          return
        }
        setUserInput(content)
        if (res.status === 400) {
          setSendError('未找到指定专家，请检查 @ 后的名字')
        } else {
          setSendError('发送失败，请重试')
        }
        setTimeout(() => setSendError(null), 4000)
        return
      }
```

---

- [ ] **Step 8: Render `OutgoingMessageQueue` above input area**

Read the JSX around line 950-985 (input area). Find where the `MentionQueue` component is rendered (line ~954). Add `OutgoingMessageQueue` right **above** it:

```tsx
                {/*
                 * F015: User outgoing queue — displayed above MentionQueue.
                 * MentionQueue shows "who will speak" (Agent speaking queue).
                 * OutgoingMessageQueue shows "what the user wants to send" (user sending queue).
                 * These are two separate UI blocks with distinct semantics.
                 */}
                <OutgoingMessageQueue
                  items={outgoingQueue}
                  dispatchingId={dispatchingRef.current}
                  onCancel={cancelQueuedItem}
                  onRecall={recallQueuedItem}
                  inputHasDraft={userInput.trim().length > 0}
                  agents={agents}
                />

                <MentionQueue
                  queue={mentionQueue}
                  agents={agents}
                  streamingAgentIds={streamingAgentIds}
                />
```

Also update the send button's disabled state to also check `isRoomBusy` (so the send button is disabled when room is busy, guiding users to queue):

```tsx
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={sending || !userInput.trim()}
                  ...
```

Wait — keeping the button enabled when busy is actually correct UX (it gives users the feedback "已加入队列" via `enqueueMessage` returning silently). But add a visual indicator. Read the send button JSX and add a tooltip-style note below it or inside it. A simpler approach: leave the button enabled (so users can still click to trigger the queue), but the `enqueueMessage` call already handles the UX. No change needed to button disabled state.

---

- [ ] **Step 9: Run frontend build**

```bash
pnpm --dir frontend build
```
Expected: PASS. Fix any TypeScript errors.

---

- [ ] **Step 10: Commit**

```bash
git add frontend/components/RoomView_new.tsx
git commit -m "feat(F015): integrate outgoing queue into RoomView"
```

---

## Task 5: Post-Implementation

**Files:**
- Modify: `docs/features/F015-busy-room-send-queue.md` (check off AC items)

---

- [ ] **Step 1: Check off AC items in the spec**

Open `docs/features/F015-busy-room-send-queue.md`. Find the Acceptance Criteria section (lines 103-112). Update the checkboxes:

```markdown
## Acceptance Criteria

- [x] AC-1: 当任一 Agent 正在执行时，用户发送新消息不会立即进入后端消息流，而是进入出站队列。
- [x] AC-2: 出站队列在输入区附近可见，至少展示目标专家、内容摘要、排队顺序。
- [x] AC-3: 房间恢复 idle 后，队列按 FIFO 自动逐条发送；同一时间最多只发送一条。
- [x] AC-4: 用户可以取消任意一条尚未发出的队列项；取消后该消息不会出现在会话流中。
- [x] AC-5: 用户可以撤回队列尾项到输入框；撤回后该项从队列移除，文本完整恢复。
- [x] AC-6: 若输入框已有草稿，撤回按钮不可用，避免覆盖当前草稿。
- [x] AC-7: 后端在房间 busy 时对直接消息请求返回 `409 ROOM_BUSY`，前端能正确处理该错误并保持队列一致。
- [x] AC-8: 无有效 `@专家` 的消息既不能直接发送，也不能入队；F013 规则保持成立。
```

---

- [ ] **Step 2: Final build + test**

```bash
pnpm --dir backend build && pnpm --dir backend exec vitest run && pnpm --dir frontend build
```

---

- [ ] **Step 3: Commit**

```bash
git add docs/features/F015-busy-room-send-queue.md
git commit -m "docs(F015): check off all AC items as implemented"
```

---

## Spec Coverage Check

| AC | Task | Confirmed by |
|----|------|-------------|
| AC-1 busy intercept | Task 4 Step 5 | `isRoomBusy` guard in `sendPreparedContent` |
| AC-2 queue UI | Task 3 | `OutgoingMessageQueue` renders above input |
| AC-3 FIFO drain | Task 4 Step 3 | `drainQueue` loop with `dispatching` guard |
| AC-4 cancel | Task 4 Step 4 | `cancelQueuedItem` |
| AC-5 recall | Task 4 Step 4 | `recallQueuedItem` |
| AC-6 draft conflict | Task 3 Step 1 | `inputHasDraft` disables recall button |
| AC-7 409 backend | Task 1 | 409 + `enqueueMessage` in fetch handler |
| AC-8 F013 | Task 4 Step 5 | F013 check runs before `enqueueMessage` call |
