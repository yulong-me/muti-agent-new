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
import * as path from 'path';
import { fileURLToPath } from 'url';

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
export async function ensureWorkspace(roomId: string): Promise<string> {
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
