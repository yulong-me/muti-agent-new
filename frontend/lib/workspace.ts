'use client'

import { API_URL } from './api'
import { debug, warn } from './logger'

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

async function requestJson<T>(
  input: string,
  init: RequestInit | undefined,
  logMeta: { event: string; meta?: Record<string, unknown> },
): Promise<T> {
  const res = await fetch(input, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    warn(`${logMeta.event}:failed`, {
      ...logMeta.meta,
      status: res.status,
      error: (data as { error?: string }).error || '请求失败',
    })
    throw new Error((data as { error?: string }).error || '请求失败')
  }
  debug(logMeta.event, {
    ...logMeta.meta,
    status: res.status,
  })
  return data as T
}

export function browseWorkspace(path: string, includeHidden = false) {
  const url = new URL(`${API_URL}/api/browse`)
  url.searchParams.set('path', path)
  if (includeHidden) {
    url.searchParams.set('includeHidden', '1')
  }
  return requestJson<BrowseResult>(url.toString(), undefined, {
    event: 'workspace:browse',
    meta: { path, includeHidden },
  })
}

export function previewWorkspaceFile(path: string) {
  const url = new URL(`${API_URL}/api/browse/file`)
  url.searchParams.set('path', path)
  return requestJson<FilePreviewResult>(url.toString(), undefined, {
    event: 'workspace:file_preview',
    meta: { path },
  })
}

export function fetchGitStatus(workspacePath: string) {
  const url = new URL(`${API_URL}/api/git/status`)
  url.searchParams.set('workspacePath', workspacePath)
  return requestJson<GitStatusResult>(url.toString(), undefined, {
    event: 'workspace:git_status',
    meta: { workspacePath },
  })
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
  return requestJson<GitDiffResult>(url.toString(), undefined, {
    event: 'workspace:git_diff',
    meta: { workspacePath, filePath: options.filePath ?? null, staged: Boolean(options.staged) },
  })
}

export function stageGitPaths(workspacePath: string, paths?: string[]) {
  return requestJson<{ ok: boolean }>(`${API_URL}/api/git/stage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, paths }),
  }, {
    event: 'workspace:git_stage',
    meta: { workspacePath, pathCount: paths?.length ?? 0 },
  })
}

export function unstageGitPaths(workspacePath: string, paths?: string[]) {
  return requestJson<{ ok: boolean }>(`${API_URL}/api/git/unstage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, paths }),
  }, {
    event: 'workspace:git_unstage',
    meta: { workspacePath, pathCount: paths?.length ?? 0 },
  })
}

export function commitGitChanges(workspacePath: string, message: string) {
  return requestJson<{ ok: boolean; commit: { hash: string; shortHash: string; subject: string } }>(`${API_URL}/api/git/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, message }),
  }, {
    event: 'workspace:git_commit',
    meta: { workspacePath, messageLength: message.trim().length },
  })
}
