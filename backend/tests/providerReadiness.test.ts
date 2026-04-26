import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildProviderReadiness } from '../src/services/providerReadiness.js';
import type { ProviderConfig } from '../src/config/providerConfig.js';

const tempDirs: string[] = [];

function provider(overrides: Partial<ProviderConfig>): ProviderConfig {
  return {
    name: 'opencode',
    label: 'OpenCode',
    cliPath: 'opencode',
    defaultModel: '',
    contextWindow: 200000,
    apiKey: '',
    baseUrl: '',
    timeout: 1800,
    thinking: true,
    lastTested: null,
    lastTestResult: null,
    ...overrides,
  };
}

function executableFile(name: string): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencouncil-provider-'));
  tempDirs.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(file, 0o755);
  return { dir, file };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('provider CLI readiness', () => {
  it('reports cli_missing without running the provider command', () => {
    const readiness = buildProviderReadiness(provider({
      cliPath: '/definitely/not/an/opencode',
    }));

    expect(readiness).toMatchObject({
      provider: 'opencode',
      status: 'cli_missing',
      cliAvailable: false,
    });
    expect(readiness.message).toContain('CLI 未找到');
  });

  it('reports untested when the CLI exists but no connection test has passed', () => {
    const { file } = executableFile('opencode');
    const readiness = buildProviderReadiness(provider({
      cliPath: file,
      lastTestResult: null,
    }));

    expect(readiness).toMatchObject({
      status: 'untested',
      cliAvailable: true,
      resolvedPath: file,
    });
  });

  it('reports ready only after a successful connection test', () => {
    const { dir } = executableFile('opencode');
    const readiness = buildProviderReadiness(provider({
      cliPath: 'opencode',
      lastTested: 123,
      lastTestResult: { success: true, version: 'ok' },
    }), { PATH: dir, HOME: os.homedir() });

    expect(readiness).toMatchObject({
      status: 'ready',
      cliAvailable: true,
      resolvedPath: path.join(dir, 'opencode'),
      message: 'CLI 可用，连接测试通过',
    });
  });
});
