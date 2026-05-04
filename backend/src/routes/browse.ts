/**
 * F006: 目录浏览器路由
 * GET  /api/browse           - 浏览目录结构
 * POST /api/pick-directory  - 打开系统原生文件夹选择器（macOS osascript）
 */

import { Router } from 'express';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { debug, info, warn } from '../lib/logger.js';
import { validateWorkspacePath } from '../services/workspace.js';

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

type OpenTarget = 'finder' | 'vscode';

export const browseRouter = Router();
const MAX_FILE_PREVIEW_BYTES = 128 * 1024;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const BLOCKED_UPLOAD_SEGMENTS = new Set(['.git', 'node_modules']);
const MEDIA_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
};

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

function isWithinPath(rootPath: string, targetPath: string): boolean {
  const rel = relative(rootPath, targetPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function hasBlockedWorkspaceSegment(rootPath: string, targetPath: string): boolean {
  const rel = relative(rootPath, targetPath);
  if (!rel) return false;
  return rel
    .split(/[\\/]+/)
    .filter(Boolean)
    .some(segment => BLOCKED_UPLOAD_SEGMENTS.has(segment));
}

function normalizeUploadFileName(filename: string): string | null {
  const name = filename.trim();
  if (!name || name === '.' || name === '..') return null;
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return null;
  if (basename(name) !== name) return null;
  return name;
}

function decodeUploadContent(contentBase64: string): Buffer | null {
  const normalized = contentBase64.trim();
  if (!normalized) return Buffer.alloc(0);
  if (normalized.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 4) return null;
  if (normalized.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return null;

  const buffer = Buffer.from(normalized, 'base64');
  if (buffer.length > MAX_UPLOAD_BYTES) return null;
  return buffer;
}

async function openPathInFinder(targetPath: string, isDirectory: boolean): Promise<void> {
  const args = isDirectory ? [targetPath] : ['-R', targetPath];
  await execFileAsync('open', args, { timeout: 10_000 });
}

async function openPathInVSCode(targetPath: string): Promise<void> {
  try {
    await execFileAsync('code', ['-r', targetPath], { timeout: 10_000 });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
    await execFileAsync('open', ['-a', 'Visual Studio Code', targetPath], { timeout: 10_000 });
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

function parseRangeHeader(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return null;

  if (!startRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    const start = Math.max(fileSize - suffixLength, 0);
    return { start, end: fileSize - 1 };
  }

  const start = Number(startRaw);
  const end = endRaw ? Number(endRaw) : fileSize - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  if (start < 0 || end < start || start >= fileSize) return null;
  return { start, end: Math.min(end, fileSize - 1) };
}

/**
 * GET /api/browse/media?path=/some/file.mp4 — 流式播放本地音视频文件
 */
browseRouter.get('/media', async (req, res) => {
  const query = req.query as { path?: string };
  const targetPath = query.path;
  if (!targetPath) {
    return res.status(400).json({ error: 'path 为必填' });
  }

  const validatedPath = await validatePath(targetPath);
  if (!validatedPath) {
    warn('browse:media:not_found', { targetPath });
    return res.status(404).json({ error: '文件不存在或无权访问' });
  }

  const contentType = MEDIA_TYPES[extname(validatedPath).toLowerCase()];
  if (!contentType) {
    warn('browse:media:unsupported_type', { targetPath: validatedPath });
    return res.status(415).json({ error: '仅支持音频或视频文件' });
  }

  try {
    const fileStat = await stat(validatedPath);
    if (!fileStat.isFile()) {
      return res.status(400).json({ error: '仅支持普通文件' });
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(basename(validatedPath))}"`);

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const range = parseRangeHeader(rangeHeader, fileStat.size);
      if (!range) {
        res.setHeader('Content-Range', `bytes */${fileStat.size}`);
        return res.status(416).end();
      }

      const chunkSize = range.end - range.start + 1;
      res.status(206);
      res.setHeader('Content-Length', String(chunkSize));
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${fileStat.size}`);
      debug('browse:media:range', {
        targetPath: validatedPath,
        contentType,
        start: range.start,
        end: range.end,
        size: fileStat.size,
      });
      return createReadStream(validatedPath, { start: range.start, end: range.end }).pipe(res);
    }

    res.setHeader('Content-Length', String(fileStat.size));
    debug('browse:media:stream', {
      targetPath: validatedPath,
      contentType,
      size: fileStat.size,
    });
    return createReadStream(validatedPath).pipe(res);
  } catch (err) {
    warn('browse:media:failed', { targetPath, error: err });
    return res.status(400).json({ error: `无法读取媒体文件: ${(err as Error).message}` });
  }
});

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
 * POST /api/browse/upload — 上传文件到当前 workspace 内的指定目录
 */
browseRouter.post('/upload', async (req, res) => {
  const {
    workspacePath,
    parentPath,
    filename,
    contentBase64,
    overwrite = false,
  } = req.body as {
    workspacePath?: string;
    parentPath?: string;
    filename?: string;
    contentBase64?: string;
    overwrite?: boolean;
  };

  if (!workspacePath || !parentPath || !filename || typeof contentBase64 !== 'string') {
    return res.status(400).json({ error: 'workspacePath、parentPath、filename 和 contentBase64 均为必填' });
  }

  try {
    await validateWorkspacePath(workspacePath);
  } catch (err) {
    warn('browse:upload:invalid_workspace', { workspacePath, error: err });
    return res.status(403).json({ error: 'workspace 不存在或无权访问' });
  }

  const workspaceReal = await validatePath(workspacePath);
  const parentReal = await validatePath(parentPath);
  if (!workspaceReal || !parentReal) {
    warn('browse:upload:invalid_path', { workspacePath, parentPath, filename });
    return res.status(404).json({ error: 'workspace 或上传目录不存在' });
  }

  if (!isWithinPath(workspaceReal, parentReal)) {
    warn('browse:upload:outside_workspace', { workspacePath: workspaceReal, parentPath: parentReal, filename });
    return res.status(403).json({ error: '上传目录必须位于当前 workspace 内' });
  }

  if (hasBlockedWorkspaceSegment(workspaceReal, parentReal)) {
    warn('browse:upload:blocked_parent', { workspacePath: workspaceReal, parentPath: parentReal, filename });
    return res.status(403).json({ error: '不能上传到受保护目录' });
  }

  const safeName = normalizeUploadFileName(filename);
  if (!safeName) {
    warn('browse:upload:invalid_name', { workspacePath: workspaceReal, parentPath: parentReal, filename });
    return res.status(400).json({ error: '文件名无效' });
  }

  const buffer = decodeUploadContent(contentBase64);
  if (!buffer) {
    warn('browse:upload:invalid_content', { workspacePath: workspaceReal, parentPath: parentReal, filename: safeName });
    return res.status(400).json({ error: `文件内容无效或超过 ${MAX_UPLOAD_BYTES} 字节` });
  }

  try {
    const parentStat = await stat(parentReal);
    if (!parentStat.isDirectory()) {
      return res.status(400).json({ error: '上传目录必须是目录' });
    }

    const targetPath = resolve(parentReal, safeName);
    if (!isWithinPath(workspaceReal, targetPath) || hasBlockedWorkspaceSegment(workspaceReal, targetPath)) {
      warn('browse:upload:invalid_target', { workspacePath: workspaceReal, parentPath: parentReal, targetPath });
      return res.status(403).json({ error: '上传目标必须位于当前 workspace 内' });
    }

    const existingLink = await lstat(targetPath).catch(() => null);
    if (existingLink?.isSymbolicLink()) {
      warn('browse:upload:symlink_target', { workspacePath: workspaceReal, parentPath: parentReal, targetPath });
      return res.status(403).json({ error: '不能覆盖符号链接' });
    }

    const existing = existingLink ? await stat(targetPath) : null;
    if (existing && !existing.isFile()) {
      return res.status(400).json({ error: '同名路径不是普通文件' });
    }

    if (existing && !overwrite) {
      return res.status(409).json({ error: '文件已存在' });
    }

    await writeFile(targetPath, buffer);
    info('browse:upload', {
      workspacePath: workspaceReal,
      parentPath: parentReal,
      targetPath,
      size: buffer.length,
      overwritten: Boolean(existing),
    });

    return res.json({
      path: targetPath,
      name: safeName,
      size: buffer.length,
      overwritten: Boolean(existing),
    });
  } catch (err) {
    warn('browse:upload:failed', { workspacePath: workspaceReal, parentPath: parentReal, filename: safeName, error: err });
    return res.status(400).json({ error: `无法上传文件: ${(err as Error).message}` });
  }
});

/**
 * POST /api/browse/open — 在本机 Finder 或 VS Code 中打开 workspace 内路径
 */
browseRouter.post('/open', async (req, res) => {
  const {
    workspacePath,
    path: targetPath,
    target,
  } = req.body as { workspacePath?: string; path?: string; target?: OpenTarget };

  if (!workspacePath || !targetPath || (target !== 'finder' && target !== 'vscode')) {
    return res.status(400).json({ error: 'workspacePath、path 和 target 均为必填' });
  }

  const workspaceReal = await validatePath(workspacePath);
  const targetReal = await validatePath(targetPath);
  if (!workspaceReal || !targetReal) {
    warn('browse:open:invalid_path', { workspacePath, targetPath, target });
    return res.status(404).json({ error: 'workspace 或打开路径不存在' });
  }

  if (!isWithinPath(workspaceReal, targetReal)) {
    warn('browse:open:outside_workspace', { workspacePath: workspaceReal, targetPath: targetReal, target });
    return res.status(403).json({ error: '打开路径必须位于当前 workspace 内' });
  }

  try {
    const targetStat = await stat(targetReal);
    if (target === 'finder') {
      await openPathInFinder(targetReal, targetStat.isDirectory());
    } else {
      await openPathInVSCode(targetReal);
    }

    info('browse:open', { workspacePath: workspaceReal, targetPath: targetReal, target });
    return res.json({ ok: true, path: targetReal, target });
  } catch (err) {
    warn('browse:open:failed', { workspacePath: workspaceReal, targetPath: targetReal, target, error: err });
    return res.status(400).json({ error: `无法打开路径: ${(err as Error).message}` });
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
