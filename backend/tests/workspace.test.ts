import { afterEach, describe, expect, it } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, symlink } from 'node:fs/promises';

import {
  WorkspaceSecurityError,
  ensureWorkspace,
  getWorkspacePath,
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

  it('rejects an existing directory outside home', async () => {
    const outsideDir = await makeOutsideTemp('workspace-outside');

    await expect(validateWorkspacePath(outsideDir)).rejects.toMatchObject({
      name: 'WorkspaceSecurityError',
      code: 'TRAVERSAL',
    } satisfies Partial<WorkspaceSecurityError>);
  });

  it('rejects a symlink inside home that escapes to an outside directory', async () => {
    const outsideDir = await makeOutsideTemp('workspace-symlink-target');
    const homeDir = await makeHomeTemp('workspace-symlink-home');
    const symlinkPath = path.join(homeDir, 'escape-link');

    await symlink(outsideDir, symlinkPath);

    await expect(validateWorkspacePath(symlinkPath)).rejects.toMatchObject({
      name: 'WorkspaceSecurityError',
      code: 'TRAVERSAL',
    } satisfies Partial<WorkspaceSecurityError>);
  });

  it('uses the default workspaces/room-{id} path when custom workspace is omitted', async () => {
    const roomId = `workspace-default-${Date.now()}`;
    const expectedPath = getWorkspacePath(roomId);
    createdPaths.push(expectedPath);

    const result = await ensureWorkspace(roomId);

    expect(result).toBe(expectedPath);
  });
});
