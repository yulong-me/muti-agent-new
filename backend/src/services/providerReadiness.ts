import fs from 'node:fs';
import path from 'node:path';
import type { ProviderConfig } from '../config/providerConfig.js';

export type ProviderReadinessStatus = 'ready' | 'cli_missing' | 'untested' | 'test_failed';

export interface ProviderReadiness {
  provider: string;
  label: string;
  cliPath: string;
  cliAvailable: boolean;
  status: ProviderReadinessStatus;
  message: string;
  resolvedPath?: string;
  lastTested: number | null;
  lastTestResult: ProviderConfig['lastTestResult'];
}

function expandHome(input: string, env: NodeJS.ProcessEnv): string {
  return input.replace(/^~(?=$|\/|\\)/, env.HOME || '/root');
}

function isPathLike(input: string): boolean {
  return input.includes('/') || input.includes('\\') || path.isAbsolute(input);
}

function executableCandidates(cliPath: string, env: NodeJS.ProcessEnv): string[] {
  if (isPathLike(cliPath)) return [expandHome(cliPath, env)];

  const pathEntries = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];

  return pathEntries.flatMap(dir => extensions.map(ext => path.join(dir, `${cliPath}${ext}`)));
}

function canExecute(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveProviderCliPath(cliPath: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const trimmed = cliPath.trim();
  if (!trimmed) return undefined;
  return executableCandidates(trimmed, env).find(canExecute);
}

export function buildProviderReadiness(
  provider: ProviderConfig,
  env: NodeJS.ProcessEnv = process.env,
): ProviderReadiness {
  const cliPath = provider.cliPath.trim();
  const resolvedPath = resolveProviderCliPath(cliPath, env);

  if (!resolvedPath) {
    return {
      provider: provider.name,
      label: provider.label,
      cliPath,
      cliAvailable: false,
      status: 'cli_missing',
      message: `CLI 未找到：${cliPath || '未配置'}`,
      lastTested: provider.lastTested,
      lastTestResult: provider.lastTestResult,
    };
  }

  if (provider.lastTestResult?.success) {
    return {
      provider: provider.name,
      label: provider.label,
      cliPath,
      cliAvailable: true,
      status: 'ready',
      message: 'CLI 可用，连接测试通过',
      resolvedPath,
      lastTested: provider.lastTested,
      lastTestResult: provider.lastTestResult,
    };
  }

  if (provider.lastTestResult && !provider.lastTestResult.success) {
    return {
      provider: provider.name,
      label: provider.label,
      cliPath,
      cliAvailable: true,
      status: 'test_failed',
      message: provider.lastTestResult.error || 'CLI 可用，但最近连接测试失败',
      resolvedPath,
      lastTested: provider.lastTested,
      lastTestResult: provider.lastTestResult,
    };
  }

  return {
    provider: provider.name,
    label: provider.label,
    cliPath,
    cliAvailable: true,
    status: 'untested',
    message: 'CLI 可用，尚未测试连接',
    resolvedPath,
    lastTested: provider.lastTested,
    lastTestResult: provider.lastTestResult,
  };
}

export function buildProvidersReadiness(
  providers: Record<string, ProviderConfig>,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, ProviderReadiness> {
  return Object.fromEntries(
    Object.entries(providers).map(([name, provider]) => [name, buildProviderReadiness(provider, env)]),
  );
}
