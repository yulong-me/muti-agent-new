import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const quickStart = readFileSync(resolve(root, 'components/room-view/EmptyRoomQuickStart.tsx'), 'utf8')
const roomView = readFileSync(resolve(root, 'components/RoomView.tsx'), 'utf8')
const composer = readFileSync(resolve(root, 'components/RoomComposer.tsx'), 'utf8')
const actionArea = readFileSync(resolve(root, 'components/room-view/RoomActionArea.tsx'), 'utf8')
const roomList = readFileSync(resolve(root, 'components/room-view/useRoomList.ts'), 'utf8')
const roomRealtime = readFileSync(resolve(root, 'components/room-view/useRoomRealtime.ts'), 'utf8')
const sidebar = readFileSync(resolve(root, 'components/RoomListSidebar.tsx'), 'utf8')
const messageList = readFileSync(resolve(root, 'components/MessageList.tsx'), 'utf8')

assert.match(quickStart, /AgentAvatar/)
assert.match(quickStart, /ReadinessDot/)
assert.match(quickStart, /状态待检查/)
assert.match(quickStart, /template\.agentIds\.slice\(0,\s*4\)/)
assert.match(quickStart, /template\.agentIds\.length\}\s*位专家/)
assert.match(quickStart, /继续上次的协作/)

assert.match(roomList, /teamId:\s*room\.teamId/)
assert.match(roomList, /teamVersionId:\s*room\.teamVersionId/)
assert.match(roomList, /loading/)
assert.match(roomRealtime, /loading/)
assert.match(sidebar, /border-accent\/45 bg-accent\/\[0\.10\]/)
assert.match(sidebar, /hover:border-accent\/55 hover:bg-accent\/\[0\.06\] hover:text-accent/)
assert.match(sidebar, /SidebarLoadingRows/)
assert.match(sidebar, /data-task-meta="always-visible"/)
assert.doesNotMatch(sidebar, /\$\{isActive \? 'flex' : 'hidden'\}/)
assert.match(sidebar, /desktopWidth/)
assert.match(sidebar, /desktopCollapsed/)
assert.match(sidebar, /onDesktopWidthChange/)
assert.match(sidebar, /onDesktopToggleCollapsed/)
assert.match(sidebar, /调整任务记录面板宽度/)
assert.match(roomView, /TASK_PANEL_WIDTH_KEY/)
assert.match(roomView, /TASK_PANEL_COLLAPSED_KEY/)
assert.match(roomView, /clampTaskPanelWidth/)
assert.match(roomView, /loading: roomListLoading/)
assert.match(roomView, /loading: roomLoading/)
assert.match(roomView, /loading=\{roomListLoading\}/)
assert.match(roomView, /loading=\{roomLoading\}/)

assert.match(roomView, /createRoomFromTemplate/)
assert.match(roomView, /\/api\/rooms\/preflight/)
assert.match(roomView, /\/api\/rooms['"`]/)
assert.doesNotMatch(
  roomView,
  /const handleStartTemplate[\s\S]{0,180}openCreateRoom\(template\)/,
  'Template cards should create a Team room directly instead of opening CreateRoomModal.',
)

assert.match(composer, /data-recipient-ghost="true"/)
assert.match(composer, /先 @ 选一位 Team 成员/)
assert.match(composer, /focus-within:ring-accent\/\[0\.22\]/)
assert.match(composer, /border border-line bg-surface-muted text-ink-soft/)
assert.doesNotMatch(composer, />To:</)
assert.doesNotMatch(composer, /clearRecipient/)
assert.match(messageList, /tone-focus-dot inline-block h-1\.5 w-1\.5 rounded-full animate-focus-pulse/)
assert.doesNotMatch(messageList, /● 回答中/)
assert.match(messageList, /loading\?: boolean/)
assert.match(messageList, /ChatLoadingSkeleton/)
assert.match(messageList, /加载聊天记录/)
assert.doesNotMatch(messageList, /messages\.length === 0 && roomId && \(/)

assert.doesNotMatch(actionArea, /if \(state === 'DONE'\) return null/)
assert.match(actionArea, /任务已结束/)
assert.match(actionArea, /共 \{messageCount\} 条消息/)
assert.match(actionArea, /让 Team 总结一份结论/)
assert.match(actionArea, /提一条改进意见/)
assert.match(actionArea, /以这次为起点，开新任务/)
assert.match(actionArea, /onCreateEvolutionProposal/)
assert.match(actionArea, /onStartNewRoom/)

console.log('main-flow-p0-regression: ok')
