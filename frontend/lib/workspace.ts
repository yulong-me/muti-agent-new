'use client'

import { API_URL } from './api'
import { debug, warn } from './logger'

interface BrowseEntry {
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

interface FilePreviewResult {
  path: string
  name: string
  size: number
  isBinary: boolean
  truncated: boolean
  content: string | null
}

export interface UploadWorkspaceFileResult {
  path: string
  name: string
  size: number
  overwritten: boolean
}

export type WorkspaceOpenTarget = 'finder' | 'vscode'

export interface OpenWorkspacePathResult {
  ok: boolean
  path: string
  target: WorkspaceOpenTarget
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

class WorkspaceRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'WorkspaceRequestError'
  }
}

export function isWorkspaceRequestError(error: unknown, status?: number) {
  return error instanceof WorkspaceRequestError && (status === undefined || error.status === status)
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
    throw new WorkspaceRequestError((data as { error?: string }).error || '请求失败', res.status)
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

export function getWorkspaceMediaUrl(path: string) {
  const url = new URL(`${API_URL}/api/browse/media`)
  url.searchParams.set('path', path)
  return url.toString()
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export async function uploadWorkspaceFile(workspacePath: string, parentPath: string, file: File, options: { overwrite?: boolean } = {}) {
  const contentBase64 = arrayBufferToBase64(await file.arrayBuffer())
  return requestJson<UploadWorkspaceFileResult>(`${API_URL}/api/browse/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath,
      parentPath,
      filename: file.name,
      contentBase64,
      overwrite: options.overwrite === true,
    }),
  }, {
    event: 'workspace:file_upload',
    meta: { workspacePath, parentPath, filename: file.name, size: file.size },
  })
}

export function openWorkspacePath(workspacePath: string, path: string, target: WorkspaceOpenTarget) {
  return requestJson<OpenWorkspacePathResult>(`${API_URL}/api/browse/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, path, target }),
  }, {
    event: 'workspace:path_open',
    meta: { workspacePath, path, target },
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
