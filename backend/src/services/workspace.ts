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

import * as fs from 'fs/promises';
import { homedir } from 'node:os';
import * as path from 'path';
import { fileURLToPath } from 'url';

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

const HOME_DIR = path.resolve(homedir());

function isWithinHome(targetPath: string): boolean {
  return targetPath === HOME_DIR || targetPath.startsWith(HOME_DIR + path.sep);
}

/**
 * Validate a user-provided workspace path.
 * - Must be an absolute path
 * - Must exist and be a directory
 * - Must resolve inside homedir() after realpath()
 */
export async function validateWorkspacePath(workspacePath: string): Promise<void> {
  const normalized = path.normalize(workspacePath);
  if (!path.isAbsolute(normalized)) {
    throw new WorkspaceSecurityError('Workspace path must be absolute', 'TRAVERSAL');
  }
  if (workspacePath.split(path.sep).includes('..')) {
    throw new WorkspaceSecurityError('Workspace path cannot contain parent directory references', 'TRAVERSAL');
  }

  let realWorkspacePath = normalized;
  try {
    realWorkspacePath = await fs.realpath(normalized);
    if (!isWithinHome(realWorkspacePath)) {
      throw new WorkspaceSecurityError('Workspace path must stay within home directory', 'TRAVERSAL');
    }
    const stat = await fs.stat(realWorkspacePath);
    if (!stat.isDirectory()) {
      throw new WorkspaceSecurityError('Workspace path is not a directory', 'NOT_DIRECTORY');
    }
  } catch (err) {
    if (err instanceof WorkspaceSecurityError) throw err;
    throw new WorkspaceSecurityError(`Workspace path does not exist: ${workspacePath}`, 'NOT_FOUND');
  }
}

// 使用项目根目录下的 workspaces/，避免 /workspace 需要 root 权限
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_BASE = path.resolve(__dirname, '../../workspaces');
const WORKSPACE_ARCHIVE = path.resolve(__dirname, '../../workspaces-archive');

export function getWorkspacePath(roomId: string): string {
  return path.join(WORKSPACE_BASE, `room-${roomId}`);
}

/**
 * 确保 Room 的 workspace 目录存在
 */
export async function ensureWorkspace(roomId: string, customWorkspace?: string): Promise<string> {
  if (customWorkspace) {
    await validateWorkspacePath(customWorkspace);
    return customWorkspace;
  }
  const workspacePath = getWorkspacePath(roomId);
  await fs.mkdir(workspacePath, { recursive: true });
  return workspacePath;
}

/**
 * 获取 Agent CLI 调用的 workspace 参数
 */
export function getWorkspaceArgs(roomId: string): string[] {
  return ['--add-dir', getWorkspacePath(roomId)];
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
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; // 目录本来就不存在，无所谓
    throw err;
  }
}
