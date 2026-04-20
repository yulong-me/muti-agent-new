import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { gitRouter } from '../src/routes/git.js';

const execFileAsync = promisify(execFile);

let server: http.Server;
let serverPort = 0;
const createdPaths: string[] = [];

async function makeHomeTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(homedir(), `${prefix}-`));
  createdPaths.push(dir);
  return dir;
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/git', gitRouter);
  return app;
}

async function reqJson(
  pathname: string,
  options: { method?: 'GET' | 'POST'; body?: Record<string, unknown> } = {},
): Promise<{ status: number; data: Record<string, unknown> }> {
  return await new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: serverPort,
      path: pathname,
      method: options.method ?? 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let data: Record<string, unknown> = {};
        try { data = JSON.parse(raw); } catch { /* ignore */ }
        resolve({ status: res.statusCode ?? 0, data });
      });
    });
    req.on('error', (error) => resolve({ status: 0, data: { error: String(error) } }));
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

async function git(cwd: string, args: string[], allowCode1 = false): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout;
  } catch (err) {
    const error = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    if (allowCode1 && error.code === 1) {
      return String(error.stdout ?? '');
    }
    throw err;
  }
}

async function initRepo(repoPath: string): Promise<void> {
  await git(repoPath, ['init']);
  await git(repoPath, ['config', 'user.name', 'Codex Test']);
  await git(repoPath, ['config', 'user.email', 'codex@example.com']);
}

beforeAll(async () => {
  server = http.createServer(makeApp());
  await new Promise<void>((resolve) => server.listen(0, () => {
    const addr = server.address();
    serverPort = typeof addr === 'object' && addr !== null ? addr.port : 0;
    resolve();
  }));
});

afterEach(async () => {
  await Promise.all(
    createdPaths.splice(0).reverse().map(target =>
      rm(target, { recursive: true, force: true }),
    ),
  );
});

afterAll(() => {
  server.close();
});

describe('git route', () => {
  it('returns isRepo=false for a non-git workspace', async () => {
    const dir = await makeHomeTemp('git-non-repo');

    const result = await reqJson(`/api/git/status?workspacePath=${encodeURIComponent(dir)}`);

    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({
      isRepo: false,
      workspacePath: dir,
    });
  });

  it('supports status, diff, stage and commit for a workspace repo', async () => {
    const repo = await makeHomeTemp('git-workspace');
    await initRepo(repo);

    await writeFile(path.join(repo, 'tracked.txt'), 'line one\n', 'utf8');
    await git(repo, ['add', 'tracked.txt']);
    await git(repo, ['commit', '-m', 'initial']);

    await writeFile(path.join(repo, 'tracked.txt'), 'line one\nline two\n', 'utf8');
    await writeFile(path.join(repo, 'new.txt'), 'brand new\n', 'utf8');

    const status1 = await reqJson(`/api/git/status?workspacePath=${encodeURIComponent(repo)}`);
    expect(status1.status).toBe(200);
    const changed1 = status1.data.changedFiles as Array<Record<string, unknown>>;
    expect(changed1).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'tracked.txt', unstaged: true }),
      expect.objectContaining({ path: 'new.txt', untracked: true }),
    ]));

    const untrackedDiff = await reqJson(
      `/api/git/diff?workspacePath=${encodeURIComponent(repo)}&filePath=${encodeURIComponent('new.txt')}`,
    );
    expect(untrackedDiff.status).toBe(200);
    expect(String(untrackedDiff.data.diff)).toContain('+++');
    expect(String(untrackedDiff.data.diff)).toContain('brand new');

    const stage = await reqJson('/api/git/stage', {
      method: 'POST',
      body: { workspacePath: repo, paths: ['tracked.txt', 'new.txt'] },
    });
    expect(stage.status).toBe(200);

    const stagedDiff = await reqJson(
      `/api/git/diff?workspacePath=${encodeURIComponent(repo)}&filePath=${encodeURIComponent('tracked.txt')}&staged=1`,
    );
    expect(stagedDiff.status).toBe(200);
    expect(String(stagedDiff.data.diff)).toContain('+line two');

    const commit = await reqJson('/api/git/commit', {
      method: 'POST',
      body: { workspacePath: repo, message: 'feat: workspace git panel' },
    });
    expect(commit.status).toBe(200);
    expect(commit.data).toMatchObject({
      ok: true,
      commit: expect.objectContaining({ subject: 'feat: workspace git panel' }),
    });

    const status2 = await reqJson(`/api/git/status?workspacePath=${encodeURIComponent(repo)}`);
    expect(status2.status).toBe(200);
    expect(status2.data).toMatchObject({
      isRepo: true,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
    });
    expect(status2.data.changedFiles).toEqual([]);
  });

  it('supports unstage in a fresh repo without HEAD', async () => {
    const repo = await makeHomeTemp('git-no-head');
    await initRepo(repo);
    await writeFile(path.join(repo, 'draft.txt'), 'draft\n', 'utf8');

    const stage = await reqJson('/api/git/stage', {
      method: 'POST',
      body: { workspacePath: repo, paths: ['draft.txt'] },
    });
    expect(stage.status).toBe(200);

    const status1 = await reqJson(`/api/git/status?workspacePath=${encodeURIComponent(repo)}`);
    expect(status1.status).toBe(200);
    expect(status1.data).toMatchObject({
      isRepo: true,
      hasHead: false,
      stagedCount: 1,
    });

    const unstage = await reqJson('/api/git/unstage', {
      method: 'POST',
      body: { workspacePath: repo, paths: ['draft.txt'] },
    });
    expect(unstage.status).toBe(200);

    const status2 = await reqJson(`/api/git/status?workspacePath=${encodeURIComponent(repo)}`);
    expect(status2.status).toBe(200);
    expect(status2.data).toMatchObject({
      isRepo: true,
      hasHead: false,
      stagedCount: 0,
      untrackedCount: 1,
    });
    expect(status2.data.changedFiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'draft.txt', untracked: true }),
    ]));
  });

  it('scopes stage-all and status to the selected workspace subtree', async () => {
    const repo = await makeHomeTemp('git-subtree');
    await initRepo(repo);
    await mkdir(path.join(repo, 'packages', 'app'), { recursive: true });
    await writeFile(path.join(repo, 'README.md'), 'root readme\n', 'utf8');
    await writeFile(path.join(repo, 'packages', 'app', 'index.ts'), 'export const app = true\n', 'utf8');

    const workspacePath = path.join(repo, 'packages', 'app');
    const stage = await reqJson('/api/git/stage', {
      method: 'POST',
      body: { workspacePath },
    });
    expect(stage.status).toBe(200);

    const scopedStatus = await reqJson(`/api/git/status?workspacePath=${encodeURIComponent(workspacePath)}`);
    expect(scopedStatus.status).toBe(200);
    expect(scopedStatus.data).toMatchObject({
      isRepo: true,
      stagedCount: 1,
      unstagedCount: 0,
      untrackedCount: 0,
    });
    expect(scopedStatus.data.changedFiles).toEqual([
      expect.objectContaining({ path: 'packages/app/index.ts', staged: true }),
    ]);

    const repoStatus = await git(repo, ['status', '--porcelain=v1']);
    expect(repoStatus).toContain('A  packages/app/index.ts');
    expect(repoStatus).toContain('?? README.md');
  });

  it('parses staged rename metadata for the UI', async () => {
    const repo = await makeHomeTemp('git-rename');
    await initRepo(repo);
    await writeFile(path.join(repo, 'before.txt'), 'hello\n', 'utf8');
    await git(repo, ['add', 'before.txt']);
    await git(repo, ['commit', '-m', 'initial']);

    await rename(path.join(repo, 'before.txt'), path.join(repo, 'after.txt'));
    await git(repo, ['add', '--all']);

    const status = await reqJson(`/api/git/status?workspacePath=${encodeURIComponent(repo)}`);
    expect(status.status).toBe(200);
    expect(status.data.changedFiles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'after.txt',
        oldPath: 'before.txt',
        staged: true,
      }),
    ]));
  });

  it('rejects empty commit messages and commits with an empty staged area', async () => {
    const repo = await makeHomeTemp('git-commit-guard');
    await initRepo(repo);
    await writeFile(path.join(repo, 'tracked.txt'), 'hello\n', 'utf8');
    await git(repo, ['add', 'tracked.txt']);
    await git(repo, ['commit', '-m', 'initial']);

    const emptyMessage = await reqJson('/api/git/commit', {
      method: 'POST',
      body: { workspacePath: repo, message: '   ' },
    });
    expect(emptyMessage.status).toBe(400);
    expect(String(emptyMessage.data.error)).toContain('提交信息不能为空');

    const emptyStage = await reqJson('/api/git/commit', {
      method: 'POST',
      body: { workspacePath: repo, message: 'feat: no-op commit' },
    });
    expect(emptyStage.status).toBe(400);
    expect(String(emptyStage.data.error)).toContain('暂存区为空');
  });

  it('rejects diff requests for workspaces that are not git repositories', async () => {
    const dir = await makeHomeTemp('git-diff-non-repo');
    await writeFile(path.join(dir, 'notes.txt'), 'not a repo\n', 'utf8');

    const result = await reqJson(
      `/api/git/diff?workspacePath=${encodeURIComponent(dir)}&filePath=${encodeURIComponent('notes.txt')}`,
    );

    expect(result.status).toBe(400);
    expect(String(result.data.error)).toContain('不是 Git 仓库');
  });

  it('rejects git operations on files outside the selected workspace subtree', async () => {
    const repo = await makeHomeTemp('git-scope');
    await initRepo(repo);
    await mkdir(path.join(repo, 'packages', 'app'), { recursive: true });
    await writeFile(path.join(repo, 'README.md'), 'root readme\n', 'utf8');
    await writeFile(path.join(repo, 'packages', 'app', 'index.ts'), 'export const answer = 42\n', 'utf8');

    const result = await reqJson('/api/git/stage', {
      method: 'POST',
      body: {
        workspacePath: path.join(repo, 'packages', 'app'),
        paths: ['README.md'],
      },
    });

    expect(result.status).toBe(400);
    expect(String(result.data.error)).toContain('工作区范围');
  });
});
