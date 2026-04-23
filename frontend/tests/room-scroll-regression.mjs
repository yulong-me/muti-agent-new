import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const roomView = readFileSync(resolve(root, 'components/RoomView.tsx'), 'utf8')
assert.match(
  roomView,
  /router\.push\(`\/room\/\$\{id\}`,\s*\{\s*scroll:\s*false\s*\}\)/,
  'Room switching must opt out of Next.js window auto-scroll to avoid viewport jumps.',
)
assert.doesNotMatch(
  roomView,
  /scrollIntoView\(/,
  'RoomView must not use scrollIntoView for message auto-follow because it can scroll the whole page.',
)
assert.match(
  roomView,
  /scrollTo\(\{\s*top:\s*el\.scrollHeight,\s*behavior\s*\}\)/,
  'RoomView must scroll the message container directly when following the latest message.',
)

const createRoomModal = readFileSync(resolve(root, 'components/CreateRoomModal.tsx'), 'utf8')
assert.match(
  createRoomModal,
  /router\.push\(`\/room\/\$\{room\.id\}`,\s*\{\s*scroll:\s*false\s*\}\)/,
  'Creating a room must also keep the viewport stable when navigating into the new room.',
)

const messageList = readFileSync(resolve(root, 'components/MessageList.tsx'), 'utf8')
assert.doesNotMatch(
  messageList,
  /scroll-smooth/,
  'MessageList must not force smooth scrolling on the whole message container.',
)

console.log('room-scroll-regression: ok')
