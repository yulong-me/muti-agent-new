/**
 * F006: 目录浏览器路由
 * GET  /api/browse           - 浏览目录结构
 * POST /api/pick-directory  - 打开系统原生文件夹选择器（macOS osascript）
 */

import { Router } from 'express';
import { execFile } from 'node:child_process';
import { mkdir, open, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';
import { debug, info, warn } from '../lib/logger.js';

const execFileAsync = promisify(execFile);

interface BrowseEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface BrowseResult {
  current: string;
  name: string;
  parent: string | null;
  homePath: string;
  entries: BrowseEntry[];
}

interface FilePreviewResult {
  path: string;
  name: string;
  size: number;
  isBinary: boolean;
  truncated: boolean;
  content: string | null;
}

export const browseRouter = Router();
const MAX_FILE_PREVIEW_BYTES = 128 * 1024;

/** 安全校验：解析 symlink 后返回真实路径 */
async function validatePath(targetPath: string): Promise<string | null> {
  try {
    return await realpath(targetPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;    // 路径不存在 → 404
    if (code === 'EACCES' || code === 'EPERM') return null; // 无权访问 → 403
    return null;
  }
}

/**
 * GET /api/browse?path=/some/dir — 列出目录下的子目录
 */
browseRouter.get('/', async (req, res) => {
  const query = req.query as { path?: string; includeHidden?: string };
  const targetPath = query.path || homedir();
  const includeHidden = query.includeHidden === '1' || query.includeHidden === 'true';

  const validatedPath = await validatePath(targetPath);
  if (!validatedPath) {
    warn('browse:list:invalid_path', { targetPath, includeHidden });
    // 区分不存在(404) vs 无权/越界(403)
    try { await stat(targetPath); } catch { /* fall through to 403 below */ }
    try {
      await realpath(targetPath);
      return res.status(403).json({ error: '路径不在允许范围内或无权访问' });
    } catch {
      return res.status(404).json({ error: '目录不存在' });
    }
  }

  try {
    const entries = await readdir(validatedPath, { withFileTypes: true });
    const dirs: BrowseEntry[] = [];

    for (const entry of entries) {
      // 默认跳过隐藏文件；工作区文件浏览可显式打开 includeHidden
      if (!includeHidden && entry.name.startsWith('.')) continue;
      // 永远隐藏 .git 目录，避免误操作仓库内部实现细节
      if (entry.name === '.git') continue;
      if (entry.name === 'node_modules') continue;

      const childPath = resolve(validatedPath, entry.name);

      if (entry.isDirectory()) {
        // 目录：检查 symlink 不逃逸
        try {
          const childReal = await realpath(childPath);
          dirs.push({ name: entry.name, path: childReal, isDirectory: true });
        } catch {
          // 不可访问的子目录跳过
        }
      } else {
        // 文件：直接添加
        dirs.push({ name: entry.name, path: childPath, isDirectory: false });
      }
    }

    dirs.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const parent = resolve(validatedPath, '..');
    const parentReal = parent === validatedPath ? null : await validatePath(parent);

    debug('browse:list', {
      targetPath: validatedPath,
      includeHidden,
      entryCount: dirs.length,
      directoryCount: dirs.filter(entry => entry.isDirectory).length,
    });

    return res.json({
      current: validatedPath,
      name: basename(validatedPath),
      parent: parentReal,
      homePath: homedir(),
      entries: dirs,
    });
  } catch (err) {
    warn('browse:list:failed', { targetPath, error: err });
    return res.status(400).json({ error: `无法读取目录: ${(err as Error).message}` });
  }
});

function looksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  let suspicious = 0;
  for (const byte of buffer) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious++;
  }
  return suspicious / buffer.length > 0.1;
}

/**
 * GET /api/browse/file?path=/some/file — 预览文件内容
 */
browseRouter.get('/file', async (req, res) => {
  const query = req.query as { path?: string };
  const targetPath = query.path;
  if (!targetPath) {
    return res.status(400).json({ error: 'path 为必填' });
  }

  const validatedPath = await validatePath(targetPath);
  if (!validatedPath) {
    warn('browse:file:not_found', { targetPath });
    return res.status(404).json({ error: '文件不存在或无权访问' });
  }

  try {
    const fileStat = await stat(validatedPath);
    if (!fileStat.isFile()) {
      return res.status(400).json({ error: '仅支持预览普通文件' });
    }

    const previewSize = Math.min(fileStat.size, MAX_FILE_PREVIEW_BYTES);
    const handle = await open(validatedPath, 'r');
    try {
      const buffer = Buffer.alloc(previewSize);
      if (previewSize > 0) {
        await handle.read(buffer, 0, previewSize, 0);
      }
      const isBinary = looksBinary(buffer);
      const result: FilePreviewResult = {
        path: validatedPath,
        name: basename(validatedPath),
        size: fileStat.size,
        isBinary,
        truncated: fileStat.size > MAX_FILE_PREVIEW_BYTES,
        content: isBinary ? null : buffer.toString('utf8'),
      };
      debug('browse:file:preview', {
        targetPath: validatedPath,
        size: fileStat.size,
        truncated: result.truncated,
        isBinary,
      });
      return res.json(result);
    } finally {
      await handle.close();
    }
  } catch (err) {
    warn('browse:file:failed', { targetPath, error: err });
    return res.status(400).json({ error: `无法预览文件: ${(err as Error).message}` });
  }
});

/**
 * POST /api/browse/mkdir — 在指定目录下新建子目录
 */
browseRouter.post('/mkdir', async (req, res) => {
  const { parentPath, name } = req.body as { parentPath?: string; name?: string };
  if (!parentPath || !name) {
    return res.status(400).json({ error: 'parentPath 和 name 均为必填' });
  }

  const validatedParent = await validatePath(parentPath);
  if (!validatedParent) {
    warn('browse:mkdir:invalid_parent', { parentPath, name });
    return res.status(403).json({ error: '路径不在允许范围内' });
  }

  // 安全校验：目录名不能包含路径分隔符
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    warn('browse:mkdir:invalid_name', { parentPath: validatedParent, name });
    return res.status(400).json({ error: '目录名无效' });
  }

  const newPath = resolve(validatedParent, name);
  try {
    await mkdir(newPath, { recursive: false });
    info('browse:mkdir', { parentPath: validatedParent, name, createdPath: newPath });
    return res.json({ createdPath: newPath, name });
  } catch (err) {
    warn('browse:mkdir:failed', { parentPath: validatedParent, name, error: err });
    return res.status(400).json({ error: `无法创建目录: ${(err as Error).message}` });
  }
});

/**
 * POST /api/browse/pick-directory — 调用 macOS 原生文件夹选择器
 */
browseRouter.post('/pick-directory', async (_req, res) => {
  if (process.platform !== 'darwin') {
    warn('browse:pick_directory:unsupported', { platform: process.platform });
    return res.status(400).json({ error: '仅支持 macOS' });
  }

  try {
    const { stdout } = await execFileAsync(
      'osascript',
      ['-e', 'POSIX path of (choose folder)'],
      { timeout: 120_000 }
    );
    const picked = stdout.trim().replace(/[\\/]$/, '');
    if (!picked) {
      return res.status(204).send(); // 用户取消
    }

    const validated = await validatePath(picked);
    if (!validated) {
      warn('browse:pick_directory:invalid', { picked });
      return res.status(403).json({ error: '所选目录不在允许范围内' });
    }

    info('browse:pick_directory', { path: validated, name: basename(validated) });
    return res.json({ path: validated, name: basename(validated) });
  } catch (err: unknown) {
    const stderr = String((err as { stderr?: unknown }).stderr ?? '');
    if (stderr.includes('User canceled')) {
      debug('browse:pick_directory:cancelled');
      return res.status(204).send();
    }
    warn('browse:pick_directory:failed', { error: stderr || err });
    return res.status(500).json({ error: stderr || (err as Error).message });
  }
});
