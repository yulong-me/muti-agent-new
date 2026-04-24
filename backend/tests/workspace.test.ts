import { afterEach, describe, expect, it } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';

import {
  captureWorkspaceSnapshot,
  ensureWorkspace,
  getWorkspacePath,
  summarizeWorkspaceChanges,
  validateWorkspacePath,
} from '../src/services/workspace.js';

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

afterEach(async () => {
  await Promise.all(
    createdPaths.splice(0).reverse().map(target =>
      rm(target, { recursive: true, force: true }),
    ),
  );
});

describe('workspace security', () => {
  it('accepts an existing directory inside home', async () => {
    const dir = await makeHomeTemp('workspace-home');

    await expect(validateWorkspacePath(dir)).resolves.toBeUndefined();
  });

  it('accepts an existing directory outside home', async () => {
    const outsideDir = await makeOutsideTemp('workspace-outside');

    await expect(validateWorkspacePath(outsideDir)).resolves.toBeUndefined();
  });

  it('accepts a symlink that resolves to an outside directory', async () => {
    const outsideDir = await makeOutsideTemp('workspace-symlink-target');
    const homeDir = await makeHomeTemp('workspace-symlink-home');
    const symlinkPath = path.join(homeDir, 'escape-link');

    await symlink(outsideDir, symlinkPath);

    await expect(validateWorkspacePath(symlinkPath)).resolves.toBeUndefined();
  });

  it('uses the default workspaces/room-{id} path when custom workspace is omitted', async () => {
    const roomId = `workspace-default-${Date.now()}`;
    const expectedPath = getWorkspacePath(roomId);
    createdPaths.push(expectedPath);

    const result = await ensureWorkspace(roomId);

    expect(result).toBe(expectedPath);
  });

  it('captures and summarizes workspace file changes', async () => {
    const dir = await makeOutsideTemp('workspace-snapshot');
    const indexPath = path.join(dir, 'index.html');

    await writeFile(indexPath, '<h1>v1</h1>');
    const before = await captureWorkspaceSnapshot(dir);

    await writeFile(indexPath, '<h1>v2</h1>');
    await writeFile(path.join(dir, 'style.css'), 'body{}');
    const after = await captureWorkspaceSnapshot(dir);

    expect(summarizeWorkspaceChanges(before, after)).toEqual({
      hasChanges: true,
      created: ['style.css'],
      modified: ['index.html'],
      deleted: [],
    });
  });
});
