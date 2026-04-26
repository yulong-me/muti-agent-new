import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const settingsModal = readFileSync(resolve(root, 'components/SettingsModal.tsx'), 'utf8')
const createRoomModal = readFileSync(resolve(root, 'components/CreateRoomModal.tsx'), 'utf8')
const quickStart = readFileSync(resolve(root, 'components/room-view/EmptyRoomQuickStart.tsx'), 'utf8')

assert.match(settingsModal, /role="dialog"/)
assert.match(settingsModal, /max-w-6xl/)
assert.match(settingsModal, /calc\(100vh-48px\)/)
assert.doesNotMatch(settingsModal, /justify-end/)
assert.doesNotMatch(settingsModal, /md:w-\[640px\]/)

assert.match(createRoomModal, /\/api\/providers\/readiness/)
assert.match(createRoomModal, /\/api\/rooms\/preflight/)
assert.match(createRoomModal, /Provider CLI/)
assert.match(createRoomModal, /handleManageProviders/)

assert.match(quickStart, /\/api\/providers\/readiness/)
assert.match(quickStart, /getTemplateReadiness/)

console.log('settings-readiness-regression: ok')
