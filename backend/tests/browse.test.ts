import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { browseRouter } from '../src/routes/browse.js';

let server: http.Server;
let serverPort = 0;
const createdPaths: string[] = [];

async function makeHomeTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(homedir(), `${prefix}-`));
  createdPaths.push(dir);
  return dir;
}

async function makeOutsideTemp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `${prefix}-`));
  createdPaths.push(dir);
  return dir;
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/browse', browseRouter);
  return app;
}

async function reqJson(pathname: string): Promise<{ status: number; data: Record<string, unknown> }> {
  return await new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: serverPort,
      path: pathname,
      method: 'GET',
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

describe('browse route security', () => {
  it('allows browsing directories inside home', async () => {
    const dir = await makeHomeTemp('browse-home');

    const result = await reqJson(`/api/browse?path=${encodeURIComponent(dir)}`);

    expect(result.status).toBe(200);
    expect(result.data).toHaveProperty('current', dir);
  });

  it('rejects browsing directories outside home with 403', async () => {
    const dir = await makeOutsideTemp('browse-outside');

    const result = await reqJson(`/api/browse?path=${encodeURIComponent(dir)}`);

    expect(result.status).toBe(403);
    expect(result.data).toHaveProperty('error');
  });

  it('previews text files inside home', async () => {
    const dir = await makeHomeTemp('browse-preview');
    const filePath = path.join(dir, 'notes.txt');
    await writeFile(filePath, 'hello preview\nline 2', 'utf8');

    const result = await reqJson(`/api/browse/file?path=${encodeURIComponent(filePath)}`);

    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({
      path: filePath,
      isBinary: false,
      truncated: false,
      content: 'hello preview\nline 2',
    });
  });

  it('marks binary files as non-previewable', async () => {
    const dir = await makeHomeTemp('browse-binary');
    const filePath = path.join(dir, 'image.bin');
    await writeFile(filePath, Buffer.from([0, 159, 146, 150]));

    const result = await reqJson(`/api/browse/file?path=${encodeURIComponent(filePath)}`);

    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({
      path: filePath,
      isBinary: true,
      content: null,
    });
  });
});
