/**
 * Workspace Manager — 共享工作目录管理
 *
 * 每个 Room 有独立的 workspace 目录，Agent 在同一目录下工作，
 * 实现文件级共享（不是消息级共享）。
 *
 * 目录结构：
 * {project_root}/workspaces/room-{roomId}/
 * ├── src/
 * │   └── App.tsx          ← Agent A 写的
 * ├── tests/
 * │   └── App.test.tsx     ← Agent B 写的
 * ├── .done-A.md           ← Agent A 交接文档
 * └── .done-B.md           ← Agent B 交接文档
 */

import type { Dirent } from 'node:fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { runtimePaths } from '../config/runtimePaths.js';
import { debug, info, warn } from '../lib/logger.js';

// F006: Workspace path validation error
export class WorkspaceSecurityError extends Error {
  constructor(
    message: string,
    public readonly code: 'TRAVERSAL' | 'NOT_FOUND' | 'NOT_DIRECTORY',
  ) {
    super(message);
    this.name = 'WorkspaceSecurityError';
  }
}

/**
 * Validate a user-provided workspace path.
 * - Must be an absolute path
 * - Must exist and be a directory
 * - Must resolve successfully after realpath()
 */
export async function validateWorkspacePath(workspacePath: string): Promise<void> {
  const normalized = path.normalize(workspacePath);
  if (!path.isAbsolute(normalized)) {
    warn('workspace:validate:invalid', { workspacePath, reason: 'not_absolute' });
    throw new WorkspaceSecurityError('Workspace path must be absolute', 'TRAVERSAL');
  }
  if (normalized.split(path.sep).includes('..')) {
    warn('workspace:validate:invalid', { workspacePath, reason: 'contains_parent_ref' });
    throw new WorkspaceSecurityError('Workspace path cannot contain parent directory references', 'TRAVERSAL');
  }

  try {
    const realWorkspacePath = await fs.realpath(normalized);
    const stat = await fs.stat(realWorkspacePath);
    if (!stat.isDirectory()) {
      warn('workspace:validate:invalid', { workspacePath: realWorkspacePath, reason: 'not_directory' });
      throw new WorkspaceSecurityError('Workspace path is not a directory', 'NOT_DIRECTORY');
    }
  } catch (err) {
    if (err instanceof WorkspaceSecurityError) throw err;
    warn('workspace:validate:invalid', { workspacePath, reason: 'not_found', error: err });
    throw new WorkspaceSecurityError(`Workspace path does not exist: ${workspacePath}`, 'NOT_FOUND');
  }
}

const WORKSPACE_BASE = runtimePaths.workspaceBaseDir;
const WORKSPACE_ARCHIVE = runtimePaths.workspaceArchiveDir;
const WORKSPACE_SNAPSHOT_IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.cache',
]);

export interface WorkspaceSnapshot {
  files: Record<string, { size: number; mtimeMs: number }>;
}

export interface WorkspaceChangeSummary {
  hasChanges: boolean;
  created: string[];
  modified: string[];
  deleted: string[];
}

export function getWorkspacePath(roomId: string): string {
  return path.join(WORKSPACE_BASE, `room-${roomId}`);
}

/**
 * 确保 Room 的 workspace 目录存在
 */
export async function ensureWorkspace(roomId: string, customWorkspace?: string): Promise<string> {
  if (customWorkspace) {
    await validateWorkspacePath(customWorkspace);
    debug('workspace:use_external', { roomId, workspacePath: customWorkspace });
    return customWorkspace;
  }
  const workspacePath = getWorkspacePath(roomId);
  const existed = await fs.stat(workspacePath).then(() => true).catch(() => false);
  await fs.mkdir(workspacePath, { recursive: true });
  debug(existed ? 'workspace:reuse' : 'workspace:create', { roomId, workspacePath });
  return workspacePath;
}

export async function captureWorkspaceSnapshot(workspacePath: string): Promise<WorkspaceSnapshot> {
  const files: WorkspaceSnapshot['files'] = {};

  async function walk(dir: string, relativeDir = ''): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && WORKSPACE_SNAPSHOT_IGNORED_DIRS.has(entry.name)) continue;

      const relativePath = relativeDir
        ? path.posix.join(relativeDir, entry.name)
        : entry.name;
      const absolutePath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }

      if (!entry.isFile()) continue;

      const stat = await fs.stat(absolutePath);
      files[relativePath] = {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
    }
  }

  await walk(workspacePath);
  return { files };
}

export function summarizeWorkspaceChanges(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): WorkspaceChangeSummary {
  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const [relativePath, nextMeta] of Object.entries(after.files)) {
    const previousMeta = before.files[relativePath];
    if (!previousMeta) {
      created.push(relativePath);
      continue;
    }

    if (previousMeta.size !== nextMeta.size || previousMeta.mtimeMs !== nextMeta.mtimeMs) {
      modified.push(relativePath);
    }
  }

  for (const relativePath of Object.keys(before.files)) {
    if (!(relativePath in after.files)) {
      deleted.push(relativePath);
    }
  }

  return {
    hasChanges: created.length > 0 || modified.length > 0 || deleted.length > 0,
    created: created.sort(),
    modified: modified.sort(),
    deleted: deleted.sort(),
  };
}

/**
 * 将 workspace 移动到归档目录（软删除时调用）
 */
export async function archiveWorkspace(roomId: string): Promise<void> {
  const src = getWorkspacePath(roomId);
  const dest = path.join(WORKSPACE_ARCHIVE, `room-${roomId}`);
  try {
    await fs.mkdir(WORKSPACE_ARCHIVE, { recursive: true });
    await fs.rename(src, dest);
    info('workspace:archive', { roomId, src, dest });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      debug('workspace:archive:skip_missing', { roomId, src });
      return; // 目录本来就不存在，无所谓
    }
    warn('workspace:archive:failed', { roomId, src, dest, error: err });
    throw err;
  }
}
