import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

import { browseRouter } from '../src/routes/browse.js';

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
  app.use('/api/browse', browseRouter);
  return app;
}

async function postJson(pathname: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  return await new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: serverPort,
      path: pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(payload.length),
      },
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
    req.write(payload);
    req.end();
  });
}

beforeAll(async () => {
  server = http.createServer(makeApp());
  await new Promise<void>((resolve) => server.listen(0, () => {
    const addr = server.address();
    serverPort = typeof addr === 'object' && addr !== null ? addr.port : 0;
    resolve();
  }));
});

beforeEach(() => {
  execFileMock.mockReset();
  execFileMock.mockImplementation((_cmd: string, _args: string[], _options: object, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
    callback(null, '', '');
  });
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

describe('browse open route', () => {
  it('opens the workspace directory in Finder', async () => {
    const workspace = await makeHomeTemp('browse-open-finder');

    const result = await postJson('/api/browse/open', {
      workspacePath: workspace,
      path: workspace,
      target: 'finder',
    });

    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ ok: true, target: 'finder' });
    expect(execFileMock).toHaveBeenCalledWith('open', [workspace], expect.any(Object), expect.any(Function));
  });

  it('reveals a workspace file in Finder', async () => {
    const workspace = await makeHomeTemp('browse-open-finder-file');
    const filePath = path.join(workspace, 'notes.txt');
    await writeFile(filePath, 'hello', 'utf8');

    const result = await postJson('/api/browse/open', {
      workspacePath: workspace,
      path: filePath,
      target: 'finder',
    });

    expect(result.status).toBe(200);
    expect(execFileMock).toHaveBeenCalledWith('open', ['-R', filePath], expect.any(Object), expect.any(Function));
  });

  it('opens the workspace path in VS Code and falls back to the macOS app when the code CLI is missing', async () => {
    const workspace = await makeHomeTemp('browse-open-vscode');
    execFileMock
      .mockImplementationOnce((_cmd: string, _args: string[], _options: object, callback: (err: NodeJS.ErrnoException) => void) => {
        const error = new Error('code not found') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        callback(error);
      })
      .mockImplementationOnce((_cmd: string, _args: string[], _options: object, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, '', '');
      });

    const result = await postJson('/api/browse/open', {
      workspacePath: workspace,
      path: workspace,
      target: 'vscode',
    });

    expect(result.status).toBe(200);
    expect(execFileMock).toHaveBeenNthCalledWith(1, 'code', ['-r', workspace], expect.any(Object), expect.any(Function));
    expect(execFileMock).toHaveBeenNthCalledWith(2, 'open', ['-a', 'Visual Studio Code', workspace], expect.any(Object), expect.any(Function));
  });

  it('rejects paths outside the selected workspace', async () => {
    const workspace = await makeHomeTemp('browse-open-root');
    const outside = await makeHomeTemp('browse-open-outside');

    const result = await postJson('/api/browse/open', {
      workspacePath: workspace,
      path: outside,
      target: 'vscode',
    });

    expect(result.status).toBe(403);
    expect(result.data.error).toBe('打开路径必须位于当前 workspace 内');
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
