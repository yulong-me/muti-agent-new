import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceLib = readFileSync(resolve(root, 'lib/workspace.ts'), 'utf8')
const workspaceSidebar = readFileSync(resolve(root, 'components/WorkspaceSidebar.tsx'), 'utf8')
const workspaceFilesPanel = readFileSync(resolve(root, 'components/WorkspaceFilesPanel.tsx'), 'utf8')
const workspaceGitPanel = readFileSync(resolve(root, 'components/WorkspaceGitPanel.tsx'), 'utf8')

assert.match(workspaceLib, /export type WorkspaceOpenTarget = 'finder' \| 'vscode'/)
assert.match(workspaceLib, /export function openWorkspacePath/)
assert.match(workspaceLib, /\/api\/browse\/open/)
assert.match(workspaceLib, /workspacePath/)
assert.match(workspaceLib, /target/)

assert.match(workspaceSidebar, /FolderOpen/)
assert.match(workspaceSidebar, /Code2/)
assert.match(workspaceSidebar, /openWorkspacePath\(workspacePath,\s*absolutePath,\s*target\)/)
assert.match(workspaceSidebar, /openExternal\(workspacePath,\s*'finder'\)/)
assert.match(workspaceSidebar, /openExternal\(workspacePath,\s*'vscode'\)/)
assert.match(workspaceSidebar, /onOpenExternal=\{openExternal\}/)

assert.match(workspaceFilesPanel, /onOpenExternal/)
assert.match(workspaceFilesPanel, /onOpenExternal\(currentPath,\s*'finder'\)/)
assert.match(workspaceFilesPanel, /onOpenExternal\(currentPath,\s*'vscode'\)/)
assert.match(workspaceFilesPanel, /onOpenExternal\(entry\.path,\s*'finder'\)/)
assert.match(workspaceFilesPanel, /onOpenExternal\(entry\.path,\s*'vscode'\)/)
assert.match(workspaceFilesPanel, /在 Finder 中打开/)
assert.match(workspaceFilesPanel, /在 VS Code 中打开/)

assert.match(workspaceGitPanel, /Source Control/)
assert.match(workspaceGitPanel, /Staged Changes/)
assert.match(workspaceGitPanel, /Changes/)
assert.match(workspaceGitPanel, /Stage All Changes/)
assert.match(workspaceGitPanel, /Unstage All Changes/)
assert.match(workspaceGitPanel, /Plus/)
assert.match(workspaceGitPanel, /Minus/)
assert.match(workspaceGitPanel, /FileDiff/)
assert.doesNotMatch(workspaceGitPanel, /title="Modified"/)
assert.doesNotMatch(workspaceGitPanel, /title="Untracked"/)

console.log('workspace-open-git-regression: ok')
