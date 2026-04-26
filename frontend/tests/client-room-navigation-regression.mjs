import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const roomViewSource = readFileSync(join(__dirname, '../components/RoomView.tsx'), 'utf8')

assert.match(roomViewSource, /window\.history\.pushState/)
assert.doesNotMatch(roomViewSource, /router\.push\(`\/room\/\$\{id\}`/)

console.log('client-room-navigation-regression: ok')
