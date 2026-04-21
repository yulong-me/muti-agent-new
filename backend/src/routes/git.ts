import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { Router } from 'express';

import { debug, info, warn } from '../lib/logger.js';
import { validateWorkspacePath } from '../services/workspace.js';

const execFileAsync = promisify(execFile);
const gitRouter = Router();

const MAX_DIFF_BUFFER = 1024 * 1024;

interface GitScope {
  workspacePath: string;
  repoRoot: string;
  repoLabel: string;
  branch: string | null;
  hasHead: boolean;
  scopePathspec: string[];
}

interface GitChangedFile {
  path: string;
  absolutePath: string;
  oldPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
};

async function runGit(
  args: string[],
  cwd: string,
  options: { allowCode1?: boolean } = {},
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: MAX_DIFF_BUFFER,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const error = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    const code = typeof error.code === 'number' ? error.code : 1;
    const stdout = String(error.stdout ?? '');
    const stderr = String(error.stderr ?? '');
    if (options.allowCode1 && code === 1) {
      return { stdout, stderr, code };
    }
    throw new Error(stderr || stdout || error.message);
  }
}

function isWithin(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent + sep);
}

async function resolveWorkspace(workspacePath: string): Promise<string> {
  await validateWorkspacePath(workspacePath);
  return await realpath(workspacePath);
}

async function resolveGitScope(workspacePath: string): Promise<GitScope | null> {
  const safeWorkspace = await resolveWorkspace(workspacePath);

  let repoRoot = '';
  try {
    const result = await runGit(['rev-parse', '--show-toplevel'], safeWorkspace);
    repoRoot = result.stdout.trim();
  } catch {
    return null;
  }

  const branchResult = await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRoot, { allowCode1: true });
  let hasHead = true;
  try {
    await runGit(['rev-parse', '--verify', 'HEAD'], repoRoot);
  } catch {
    hasHead = false;
  }
  const workspaceRel = relative(repoRoot, safeWorkspace);

  return {
    workspacePath: safeWorkspace,
    repoRoot,
    repoLabel: basename(repoRoot),
    branch: branchResult.code === 0 ? branchResult.stdout.trim() : null,
    hasHead,
    scopePathspec: workspaceRel ? ['--', workspaceRel] : [],
  };
}

function ensureSafeRepoPath(scope: GitScope, repoRelativePath: string): string {
  if (!repoRelativePath || repoRelativePath.includes('\0')) {
    throw new Error('文件路径无效');
  }
  const absolutePath = resolve(scope.repoRoot, repoRelativePath);
  if (!isWithin(scope.repoRoot, absolutePath)) {
    throw new Error('文件路径超出仓库范围');
  }
  if (!isWithin(scope.workspacePath, absolutePath)) {
    throw new Error('文件路径超出当前工作区范围');
  }
  return repoRelativePath;
}

function normalizeRepoPaths(scope: GitScope, paths: unknown): string[] {
  if (!Array.isArray(paths)) return [];
  return paths
    .filter((value): value is string => typeof value === 'string')
    .map(path => ensureSafeRepoPath(scope, path));
}

function parseStatus(stdout: string, repoRoot: string): GitChangedFile[] {
  const files: GitChangedFile[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    const indexStatus = line[0] ?? ' ';
    const worktreeStatus = line[1] ?? ' ';
    if (indexStatus === '!' && worktreeStatus === '!') continue;

    let path = line.slice(3);
    let oldPath: string | undefined;
    const renameArrow = ' -> ';
    if ((indexStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'R' || worktreeStatus === 'C') && path.includes(renameArrow)) {
      const arrowIndex = path.indexOf(renameArrow);
      oldPath = path.slice(0, arrowIndex);
      path = path.slice(arrowIndex + renameArrow.length);
    }

    files.push({
      path,
      absolutePath: resolve(repoRoot, path),
      oldPath,
      indexStatus,
      worktreeStatus,
      staged: indexStatus !== ' ' && indexStatus !== '?',
      unstaged: worktreeStatus !== ' ' && worktreeStatus !== '?',
      untracked: indexStatus === '?' && worktreeStatus === '?',
    });
  }

  return files;
}

gitRouter.get('/status', async (req, res) => {
  const workspacePath = typeof req.query.workspacePath === 'string' ? req.query.workspacePath : '';
  if (!workspacePath) {
    warn('git:status:invalid', { reason: 'missing_workspace_path' });
    return res.status(400).json({ error: 'workspacePath 为必填' });
  }

  try {
    const scope = await resolveGitScope(workspacePath);
    if (!scope) {
      const safeWorkspace = await resolveWorkspace(workspacePath);
      debug('git:status:not_repo', { workspacePath: safeWorkspace });
      return res.json({
        isRepo: false,
        workspacePath: safeWorkspace,
        changedFiles: [],
      });
    }

    const args = ['-c', 'core.quotePath=false', 'status', '--porcelain=v1', '--untracked-files=all'];
    if (scope.scopePathspec.length) args.push(...scope.scopePathspec);
    const statusResult = await runGit(args, scope.repoRoot);
    const changedFiles = parseStatus(statusResult.stdout, scope.repoRoot);
    debug('git:status', {
      workspacePath: scope.workspacePath,
      repoRoot: scope.repoRoot,
      branch: scope.branch,
      changedCount: changedFiles.length,
      stagedCount: changedFiles.filter(file => file.staged).length,
      unstagedCount: changedFiles.filter(file => file.unstaged).length,
      untrackedCount: changedFiles.filter(file => file.untracked).length,
    });

    return res.json({
      isRepo: true,
      workspacePath: scope.workspacePath,
      repoRoot: scope.repoRoot,
      repoLabel: scope.repoLabel,
      branch: scope.branch,
      hasHead: scope.hasHead,
      changedFiles,
      stagedCount: changedFiles.filter(file => file.staged).length,
      unstagedCount: changedFiles.filter(file => file.unstaged).length,
      untrackedCount: changedFiles.filter(file => file.untracked).length,
    });
  } catch (err) {
    warn('git:status:failed', { workspacePath, error: err });
    return res.status(400).json({ error: `无法读取 Git 状态: ${(err as Error).message}` });
  }
});

gitRouter.get('/diff', async (req, res) => {
  const workspacePath = typeof req.query.workspacePath === 'string' ? req.query.workspacePath : '';
  const filePath = typeof req.query.filePath === 'string' ? req.query.filePath : '';
  const staged = req.query.staged === '1' || req.query.staged === 'true';
  if (!workspacePath) {
    warn('git:diff:invalid', { reason: 'missing_workspace_path', filePath, staged });
    return res.status(400).json({ error: 'workspacePath 为必填' });
  }

  try {
    const scope = await resolveGitScope(workspacePath);
    if (!scope) {
      warn('git:diff:not_repo', { workspacePath });
      return res.status(400).json({ error: '当前工作区不是 Git 仓库' });
    }

    let diffArgs = ['-c', 'core.quotePath=false', 'diff', '--no-ext-diff'];
    if (staged) diffArgs.push('--cached');

    let targetPath = '';
    if (filePath) {
      targetPath = ensureSafeRepoPath(scope, filePath);
    }

    if (!staged && targetPath) {
      const untrackedCheck = await runGit(
        ['ls-files', '--others', '--exclude-standard', '--', targetPath],
        scope.repoRoot,
      );
      if (untrackedCheck.stdout.trim()) {
        const noIndex = await runGit(
          ['diff', '--no-index', '--no-ext-diff', '--', '/dev/null', resolve(scope.repoRoot, targetPath)],
          scope.repoRoot,
          { allowCode1: true },
        );
        return res.json({
          path: targetPath,
          staged,
          diff: noIndex.stdout,
        });
      }
    }

    if (targetPath) {
      diffArgs.push('--', targetPath);
    } else if (scope.scopePathspec.length) {
      diffArgs.push(...scope.scopePathspec);
    }

    const diffResult = await runGit(diffArgs, scope.repoRoot);
    debug('git:diff', {
      workspacePath: scope.workspacePath,
      repoRoot: scope.repoRoot,
      filePath: targetPath || null,
      staged,
      diffLength: diffResult.stdout.length,
    });
    return res.json({
      path: targetPath || null,
      staged,
      diff: diffResult.stdout,
    });
  } catch (err) {
    warn('git:diff:failed', { workspacePath, filePath, staged, error: err });
    return res.status(400).json({ error: `无法读取 Git diff: ${(err as Error).message}` });
  }
});

gitRouter.post('/stage', async (req, res) => {
  const { workspacePath, paths } = req.body as { workspacePath?: string; paths?: unknown };
  if (!workspacePath) {
    warn('git:stage:invalid', { reason: 'missing_workspace_path' });
    return res.status(400).json({ error: 'workspacePath 为必填' });
  }

  try {
    const scope = await resolveGitScope(workspacePath);
    if (!scope) {
      warn('git:stage:not_repo', { workspacePath });
      return res.status(400).json({ error: '当前工作区不是 Git 仓库' });
    }

    const targetPaths = normalizeRepoPaths(scope, paths);
    const args = ['add', '--all'];
    if (targetPaths.length > 0) {
      args.push('--', ...targetPaths);
    } else if (scope.scopePathspec.length) {
      args.push(...scope.scopePathspec);
    }
    await runGit(args, scope.repoRoot);
    info('git:stage', {
      workspacePath: scope.workspacePath,
      repoRoot: scope.repoRoot,
      pathCount: targetPaths.length,
      scope: targetPaths.length > 0 ? 'selected' : 'workspace',
    });
    return res.json({ ok: true });
  } catch (err) {
    warn('git:stage:failed', { workspacePath, error: err });
    return res.status(400).json({ error: `无法暂存文件: ${(err as Error).message}` });
  }
});

gitRouter.post('/unstage', async (req, res) => {
  const { workspacePath, paths } = req.body as { workspacePath?: string; paths?: unknown };
  if (!workspacePath) {
    warn('git:unstage:invalid', { reason: 'missing_workspace_path' });
    return res.status(400).json({ error: 'workspacePath 为必填' });
  }

  try {
    const scope = await resolveGitScope(workspacePath);
    if (!scope) {
      warn('git:unstage:not_repo', { workspacePath });
      return res.status(400).json({ error: '当前工作区不是 Git 仓库' });
    }

    const targetPaths = normalizeRepoPaths(scope, paths);
    if (scope.hasHead) {
      const args = ['restore', '--staged'];
      if (targetPaths.length > 0) {
        args.push('--', ...targetPaths);
      } else if (scope.scopePathspec.length) {
        args.push(...scope.scopePathspec);
      }
      await runGit(args, scope.repoRoot);
    } else {
      const args = ['rm', '--cached', '-r', '--ignore-unmatch'];
      if (targetPaths.length > 0) {
        args.push('--', ...targetPaths);
      } else if (scope.scopePathspec.length) {
        args.push(...scope.scopePathspec);
      } else {
        args.push('--', '.');
      }
      await runGit(args, scope.repoRoot);
    }
    info('git:unstage', {
      workspacePath: scope.workspacePath,
      repoRoot: scope.repoRoot,
      pathCount: targetPaths.length,
      scope: targetPaths.length > 0 ? 'selected' : 'workspace',
      hasHead: scope.hasHead,
    });
    return res.json({ ok: true });
  } catch (err) {
    warn('git:unstage:failed', { workspacePath, error: err });
    return res.status(400).json({ error: `无法取消暂存: ${(err as Error).message}` });
  }
});

gitRouter.post('/commit', async (req, res) => {
  const { workspacePath, message } = req.body as { workspacePath?: string; message?: string };
  if (!workspacePath) {
    warn('git:commit:invalid', { reason: 'missing_workspace_path' });
    return res.status(400).json({ error: 'workspacePath 为必填' });
  }
  if (!message?.trim()) {
    warn('git:commit:invalid', { reason: 'empty_message', workspacePath });
    return res.status(400).json({ error: '提交信息不能为空' });
  }

  try {
    const scope = await resolveGitScope(workspacePath);
    if (!scope) {
      warn('git:commit:not_repo', { workspacePath });
      return res.status(400).json({ error: '当前工作区不是 Git 仓库' });
    }

    const stagedCheck = await runGit(['diff', '--cached', '--quiet'], scope.repoRoot, { allowCode1: true });
    if (stagedCheck.code === 0) {
      warn('git:commit:empty_index', { workspacePath: scope.workspacePath, repoRoot: scope.repoRoot });
      return res.status(400).json({ error: '暂存区为空，无法提交' });
    }

    await runGit(['-c', 'commit.gpgsign=false', 'commit', '-m', message.trim()], scope.repoRoot);
    const summary = await runGit(['log', '-1', '--pretty=%H%n%h%n%s'], scope.repoRoot);
    const [hash = '', shortHash = '', subject = ''] = summary.stdout.trim().split('\n');
    info('git:commit', {
      workspacePath: scope.workspacePath,
      repoRoot: scope.repoRoot,
      shortHash,
      subject,
    });

    return res.json({
      ok: true,
      commit: {
        hash,
        shortHash,
        subject,
      },
    });
  } catch (err) {
    warn('git:commit:failed', { workspacePath, error: err });
    return res.status(400).json({ error: `无法提交变更: ${(err as Error).message}` });
  }
});

export { gitRouter };
