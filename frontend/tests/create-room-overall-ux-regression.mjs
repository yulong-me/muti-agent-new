import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const createRoom = readFileSync(resolve(root, 'components/CreateRoomModal.tsx'), 'utf8')
const quickStart = readFileSync(resolve(root, 'components/room-view/EmptyRoomQuickStart.tsx'), 'utf8')
const sidebar = readFileSync(resolve(root, 'components/RoomListSidebar.tsx'), 'utf8')
const header = readFileSync(resolve(root, 'components/room-view/RoomHeader.tsx'), 'utf8')
const roomView = readFileSync(resolve(root, 'components/RoomView.tsx'), 'utf8')
const evolutionModal = readFileSync(resolve(root, 'components/room-view/EvolutionReviewModal.tsx'), 'utf8')
const agentPanel = readFileSync(resolve(root, 'components/AgentPanel.tsx'), 'utf8')
const legacyChineseTerm = '\u573a\u666f'

assert.match(quickStart, /发起一个任务，交给 Team 协作/)
assert.match(quickStart, /发起任务/)
assert.doesNotMatch(quickStart, new RegExp(`专家会议|${legacyChineseTerm}`))

assert.match(createRoom, /发起任务/)
assert.match(createRoom, /选择一支 Team，进入协作现场后再输入这次要做的事/)
assert.match(createRoom, /进入协作现场/)
assert.match(createRoom, /想让这支 Team 擅长哪类事/)
assert.match(createRoom, /Team 方案/)
assert.match(createRoom, /创建 Team 并进入协作现场/)
assert.match(createRoom, /topic\.trim\(\) \|\| '新任务记录'/)
assert.match(createRoom, /CustomSelect/)
assert.match(createRoom, /Loader2/)
assert.match(createRoom, /加载 Team 中/)
assert.doesNotMatch(createRoom, /<select/)
assert.doesNotMatch(createRoom, /<option/)
assert.doesNotMatch(createRoom, /<h2[^>]*>选择已有 Team<\/h2>/)
assert.doesNotMatch(createRoom, /从已保存的 Team 中选择一支/)
assert.doesNotMatch(createRoom, /<h2[^>]*>生成新 Team<\/h2>/)
assert.doesNotMatch(createRoom, new RegExp(`这次讨论要解决什么|创建讨论|Team 草案|目标|${legacyChineseTerm}的默认|默认专家组`))
assert.match(createRoom, /label: team\.name/)
assert.match(createRoom, /v\$\{team\.activeVersion\.versionNumber\} · \$\{team\.members\.length\} 位成员/)
assert.doesNotMatch(createRoom, /label: `\$\{team\.name\} · v/)
assert.doesNotMatch(createRoom, /\{selectedTeam\.name\}<\/p>/)
assert.match(createRoom, /执行工具未准备好/)
assert.doesNotMatch(createRoom, /Provider CLI|去设置 Provider|检查 Provider 中/)

assert.match(sidebar, /任务记录/)
assert.match(sidebar, /新任务记录/)
assert.match(sidebar, /协作中/)
assert.match(sidebar, /已归档/)
assert.match(
  sidebar,
  /const \[archivedOpen, setArchivedOpen\] = useState\(true\)/,
  'Completed task records should remain visible by default instead of disappearing behind a collapsed archived section.',
)
assert.match(sidebar, /进行中/)
assert.doesNotMatch(sidebar, /新讨论|讨论室|进行中的讨论|归档讨论/)
assert.doesNotMatch(sidebar, /\{activeCount\} active · \{archivedCount\} archived/)

assert.match(header, /提个改进/)
assert.match(header, /查看改进建议/)
assert.match(header, /任务记录/)
assert.doesNotMatch(header, /EVO PR|让 Team 复盘|进化提案|开始新讨论|讨论标题|讨论成员|参与讨论/)

assert.match(roomView, /改进这支 Team/)
assert.match(roomView, /这支 Team 下次怎么做会更好/)
assert.match(roomView, /生成改进建议/)
assert.match(roomView, /evolutionOutput/)
assert.match(roomView, /\/api\/rooms\/\$\{activeRoomId\}\/evolution-proposals\/stream/)
assert.match(roomView, /type: 'delta'/)
assert.match(roomView, /Team Architect/)
assert.doesNotMatch(roomView, /生成 Team 改进提案|创建 EVO PR|合并 EVO PR/)

assert.match(evolutionModal, /改进建议/)
assert.match(evolutionModal, /确认升级 Team/)
assert.doesNotMatch(evolutionModal, /团队升级确认/)

assert.doesNotMatch(agentPanel, /📋/)

console.log('create-room-overall-ux-regression: ok')
