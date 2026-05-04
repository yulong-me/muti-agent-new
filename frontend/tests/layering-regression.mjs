import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const globals = readFileSync(resolve(root, 'app/globals.css'), 'utf8')

const requiredLayerTokens = [
  '--z-app-panel',
  '--z-sticky-header',
  '--z-local-float',
  '--z-dropdown',
  '--z-tooltip',
  '--z-popover',
  '--z-modal-scrim',
  '--z-modal',
  '--z-nested-modal',
  '--z-drawer',
  '--z-fullscreen-preview',
]

const requiredLayerClasses = [
  '.layer-app-panel',
  '.layer-sticky-header',
  '.layer-local-float',
  '.layer-dropdown',
  '.layer-tooltip',
  '.layer-popover',
  '.layer-modal-scrim',
  '.layer-modal',
  '.layer-nested-modal',
  '.layer-drawer',
  '.layer-fullscreen-preview',
  '.layer-overlay-content',
]

for (const token of requiredLayerTokens) {
  assert.ok(globals.includes(token), `Missing layer token ${token}`)
}

for (const className of requiredLayerClasses) {
  assert.ok(globals.includes(className), `Missing layer class ${className}`)
}

assert.match(
  globals,
  /:where\(\s*\.app-islands-panel > \*,\s*\.settings-panel > \*,\s*\.app-window-shell > \*\s*\)\s*\{[\s\S]*?z-index: 1;/,
  'Default island child stacking must use :where() so named layer-* classes can override it.',
)

const rootTokenOrder = requiredLayerTokens.map(token => globals.indexOf(token))
assert.deepEqual(
  [...rootTokenOrder].sort((a, b) => a - b),
  rootTokenOrder,
  'Layer tokens should be defined from low to high so the stack is reviewable.',
)

function collectSourceFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries.flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(path)
    if (!entry.name.endsWith('.tsx') && !entry.name.endsWith('.ts')) return []
    return [path]
  })
}

const layerManagedFiles = [
  ...collectSourceFiles(resolve(root, 'components')),
  ...collectSourceFiles(resolve(root, 'app')),
]

const rawLayerFindings = []
for (const file of layerManagedFiles) {
  const source = readFileSync(file, 'utf8')
  const lines = source.split('\n')
  lines.forEach((line, index) => {
    if (/\bz-(?:\[\d+\]|\d+)\b/.test(line) || /\bzIndex\b/.test(line)) {
      rawLayerFindings.push(`${relative(root, file)}:${index + 1}: ${line.trim()}`)
    }
  })
}

assert.deepEqual(
  rawLayerFindings,
  [],
  `Use named layer-* classes instead of raw Tailwind z-index utilities or inline zIndex:\n${rawLayerFindings.join('\n')}`,
)

const overlayContracts = [
  ['components/SettingsModal.tsx', 'layer-modal-scrim', 'layer-modal'],
  ['components/CreateRoomModal.tsx', 'layer-modal-scrim', 'layer-modal'],
  ['components/AgentInviteDrawer.tsx', 'layer-drawer', 'layer-overlay-content'],
  ['components/DirectoryBrowser.tsx', 'layer-drawer', 'layer-overlay-content'],
  ['components/WorkspacePreviewDialog.tsx', 'layer-fullscreen-preview', 'layer-overlay-content'],
  ['components/AgentPanel.tsx', 'layer-app-panel', 'layer-popover', 'layer-drawer'],
  ['components/RoomListSidebar.tsx', 'layer-app-panel', 'layer-modal', 'layer-drawer', 'layer-local-float'],
  ['components/MentionPicker.tsx', 'layer-dropdown'],
  ['components/room-view/RoomHeader.tsx', 'layer-sticky-header', 'layer-popover'],
  ['components/room-view/EvolutionReviewModal.tsx', 'layer-modal'],
  ['components/settings-modal/TeamSettingsTab.tsx', 'layer-nested-modal', 'layer-tooltip', 'layer-dropdown'],
]

for (const [filePath, ...expectedClasses] of overlayContracts) {
  const source = readFileSync(resolve(root, filePath), 'utf8')
  for (const className of expectedClasses) {
    assert.ok(source.includes(className), `${filePath} should use ${className}`)
  }
}

const roomListSidebar = readFileSync(resolve(root, 'components/RoomListSidebar.tsx'), 'utf8')
assert.ok(
  roomListSidebar.includes("import { createPortal } from 'react-dom'"),
  'CommandPalette must be portaled out of the sidebar stacking context.',
)
assert.match(
  roomListSidebar,
  /return createPortal\(\([\s\S]*data-command-palette="true"[\s\S]*document\.body[\s\S]*\)/,
  'CommandPalette must render into document.body so it covers the full app shell.',
)

console.log('layering-regression: ok')
