'use client'

import { API_URL } from './api'

export interface BrowseEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface BrowseResult {
  current: string
  name: string
  parent: string | null
  homePath: string
  entries: BrowseEntry[]
}

export interface FilePreviewResult {
  path: string
  name: string
  size: number
  isBinary: boolean
  truncated: boolean
  content: string | null
}

export interface GitChangedFile {
  path: string
  absolutePath: string
  oldPath?: string
  indexStatus: string
  worktreeStatus: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
}

export interface GitStatusResult {
  isRepo: boolean
  workspacePath: string
  repoRoot?: string
  repoLabel?: string
  branch?: string | null
  hasHead?: boolean
  changedFiles: GitChangedFile[]
  stagedCount?: number
  unstagedCount?: number
  untrackedCount?: number
}

export interface GitDiffResult {
  path: string | null
  staged: boolean
  diff: string
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || '请求失败')
  }
  return data as T
}

export function browseWorkspace(path: string, includeHidden = false) {
  const url = new URL(`${API_URL}/api/browse`)
  url.searchParams.set('path', path)
  if (includeHidden) {
    url.searchParams.set('includeHidden', '1')
  }
  return requestJson<BrowseResult>(url.toString())
}

export function previewWorkspaceFile(path: string) {
  const url = new URL(`${API_URL}/api/browse/file`)
  url.searchParams.set('path', path)
  return requestJson<FilePreviewResult>(url.toString())
}

export function fetchGitStatus(workspacePath: string) {
  const url = new URL(`${API_URL}/api/git/status`)
  url.searchParams.set('workspacePath', workspacePath)
  return requestJson<GitStatusResult>(url.toString())
}

export function fetchGitDiff(workspacePath: string, options: { filePath?: string; staged?: boolean } = {}) {
  const url = new URL(`${API_URL}/api/git/diff`)
  url.searchParams.set('workspacePath', workspacePath)
  if (options.filePath) {
    url.searchParams.set('filePath', options.filePath)
  }
  if (options.staged) {
    url.searchParams.set('staged', '1')
  }
  return requestJson<GitDiffResult>(url.toString())
}

export function stageGitPaths(workspacePath: string, paths?: string[]) {
  return requestJson<{ ok: boolean }>(`${API_URL}/api/git/stage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, paths }),
  })
}

export function unstageGitPaths(workspacePath: string, paths?: string[]) {
  return requestJson<{ ok: boolean }>(`${API_URL}/api/git/unstage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, paths }),
  })
}

export function commitGitChanges(workspacePath: string, message: string) {
  return requestJson<{ ok: boolean; commit: { hash: string; shortHash: string; subject: string } }>(`${API_URL}/api/git/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, message }),
  })
}
