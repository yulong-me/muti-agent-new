import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const globalsCss = readFileSync(resolve(root, 'app/globals.css'), 'utf8')
const sidebar = readFileSync(resolve(root, 'components/RoomListSidebar.tsx'), 'utf8')
const composer = readFileSync(resolve(root, 'components/RoomComposer.tsx'), 'utf8')
const messageList = readFileSync(resolve(root, 'components/MessageList.tsx'), 'utf8')
const actionArea = readFileSync(resolve(root, 'components/room-view/RoomActionArea.tsx'), 'utf8')
const roomHeader = readFileSync(resolve(root, 'components/room-view/RoomHeader.tsx'), 'utf8')
const agentPanel = readFileSync(resolve(root, 'components/AgentPanel.tsx'), 'utf8')

assert.match(globalsCss, /family=Inter/)
assert.match(globalsCss, /family=JetBrains\+Mono/)
assert.doesNotMatch(globalsCss, /Bricolage Grotesque/)
assert.doesNotMatch(globalsCss, /ambient-glow-float/)
assert.doesNotMatch(globalsCss, /ambient-ring-drift/)
assert.match(globalsCss, /--provider-opencode:\s*#7C3AED/i)
assert.match(globalsCss, /--provider-codex:\s*#0E8345/i)

assert.match(sidebar, /讨论室/)
assert.match(sidebar, /已归档/)
assert.match(sidebar, /新讨论/)
assert.match(sidebar, /⌘K/)
assert.match(sidebar, /data-command-palette="true"/)
assert.match(sidebar, /搜索讨论室、最近消息或操作/)

assert.match(composer, /写消息给/)
assert.match(composer, /消息要发给谁？按 @ 选一位专家/)
assert.match(composer, /Cmd\+Enter 发送/)
assert.match(composer, /↵ 发送/)
assert.match(composer, /↵ 选择/)

assert.match(messageList, /A2AHandoffInfo/)
assert.match(messageList, /由 @\{handoffInfo\.fromAgentName\} 召唤/)
assert.match(messageList, /getStreamingStatusLabel/)

assert.match(roomHeader, /renaming && roomId && suggestionsOpen/)
assert.doesNotMatch(roomHeader, /roomId && \(\s*<button\s+type="button"\s+onClick=\{\(\) => \{ void handleGenerateTitleSuggestions\(\) \}\}/)

assert.match(actionArea, /导出报告 \(.md\)/)
assert.match(agentPanel, /本房成员/)

console.log('design-refresh-regression: ok')
