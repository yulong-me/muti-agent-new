import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const roomView = readFileSync(resolve(root, 'components/RoomView.tsx'), 'utf8')
const roomActionArea = readFileSync(resolve(root, 'components/room-view/RoomActionArea.tsx'), 'utf8')

assert.match(
  roomView,
  /import\s+\{\s*MessageList\s*\}\s+from\s+['"]\.\/MessageList['"]/,
  'RoomView must delegate history rendering to MessageList so composer input does not re-render every message.',
)

assert.match(
  roomActionArea,
  /import\s+\{\s*RoomComposer,\s*type\s+RoomComposerHandle\s*\}\s+from\s+['"]\.\.\/RoomComposer['"]/,
  'RoomActionArea must delegate draft input state to RoomComposer.',
)

assert.doesNotMatch(
  roomView,
  /sortedMessages\.map\(\s*msg\s*=>/,
  'RoomView must not inline map over all messages in its own render path.',
)

const messageList = readFileSync(resolve(root, 'components/MessageList.tsx'), 'utf8')
assert.match(
  messageList,
  /export\s+const\s+MessageList\s*=\s*memo\(/,
  'MessageList must be memoized.',
)
assert.match(
  messageList,
  /const\s+MessageBubble\s*=\s*memo\(/,
  'Individual message bubbles must be memoized.',
)

const composer = readFileSync(resolve(root, 'components/RoomComposer.tsx'), 'utf8')
assert.match(
  composer,
  /export\s+const\s+RoomComposer\s*=\s*memo\(/,
  'RoomComposer must be memoized and own high-frequency draft state.',
)
assert.match(
  composer,
  /const\s+\[userInput,\s*setUserInput\]\s*=\s*useState\(/,
  'RoomComposer must keep draft input state local.',
)
assert.doesNotMatch(
  roomView,
  /const\s+\[userInput,\s*setUserInput\]\s*=\s*useState\(/,
  'RoomView must not subscribe to draft input state.',
)
