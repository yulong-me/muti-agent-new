import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = readFileSync(resolve(root, 'components/CreateRoomModal.tsx'), 'utf8')

assert.match(source, /max-w-4xl/)
assert.match(source, /grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-5 gap-2/)
assert.match(source, /p-3 rounded-xl/)
assert.match(source, /w-9 h-9/)
assert.doesNotMatch(source, /flex flex-col items-center p-4 rounded-2xl border-2/)
assert.doesNotMatch(source, /w-12 h-12/)

console.log('create-room-agent-card-density-regression: ok')
