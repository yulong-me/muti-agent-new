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
