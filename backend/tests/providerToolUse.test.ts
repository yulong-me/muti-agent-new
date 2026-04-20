import { describe, expect, it } from 'vitest';

import type { ProviderConfig } from '../src/config/providerConfig.js';
import { parseClaudeAssistantToolUseEvents } from '../src/services/providers/claudeCode.js';
import { parseOpenCodeToolUseEvent } from '../src/services/providers/opencode.js';
import { buildClaudeProviderLaunch } from '../src/services/providers/claudeCode.js';
import { buildOpenCodeProviderLaunch } from '../src/services/providers/opencode.js';

const baseProviderConfig: ProviderConfig = {
  name: 'test-provider',
  label: 'Test Provider',
  cliPath: '~/bin/test-cli',
  defaultModel: 'test-model',
  apiKey: 'test-key',
  baseUrl: 'https://provider.example.com',
  timeout: 90,
  thinking: true,
  lastTested: null,
  lastTestResult: null,
};

describe('provider tool_use parsing', () => {
  it('parses Claude Code assistant tool_use content blocks', () => {
    const events = parseClaudeAssistantToolUseEvents({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: '我先看文件' },
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'README.md' } },
        ],
      },
    }, 'agent-1');

    expect(events).toEqual([
      {
        type: 'tool_use',
        agentId: 'agent-1',
        toolName: 'Read',
        toolInput: { file_path: 'README.md' },
        callId: 'toolu_1',
      },
    ]);
  });

  it('parses OpenCode documented tool_use part format', () => {
    expect(parseOpenCodeToolUseEvent({
      type: 'tool_use',
      part: {
        id: 'part-1',
        type: 'tool_use',
        tool: 'bash',
        state: { input: { command: 'pwd' } },
      },
    }, 'agent-1')).toEqual({
      type: 'tool_use',
      agentId: 'agent-1',
      toolName: 'bash',
      toolInput: { command: 'pwd' },
      callId: 'part-1',
    });
  });

  it('parses OpenCode runtime tool part format', () => {
    expect(parseOpenCodeToolUseEvent({
      type: 'tool_use',
      part: {
        type: 'tool',
        tool: 'read',
        callID: 'call-1',
        input: { path: 'package.json' },
      },
    }, 'agent-1')).toEqual({
      type: 'tool_use',
      agentId: 'agent-1',
      toolName: 'read',
      toolInput: { path: 'package.json' },
      callId: 'call-1',
    });
  });

  it('builds Claude launch config with room workspace as cwd and --add-dir', () => {
    const workspace = '/Users/yulong/work/sample-project';
    const launch = buildClaudeProviderLaunch(
      'hello from claude',
      { workspace },
      { ...baseProviderConfig, name: 'claude-code', cliPath: '~/bin/claude' },
      { HOME: '/Users/tester', PATH: '/usr/bin' },
    );

    expect(launch.cliPath).toBe('/Users/tester/bin/claude');
    expect(launch.args).toEqual(expect.arrayContaining(['--model', 'test-model']));
    expect(launch.args).toEqual(expect.arrayContaining(['--add-dir', workspace]));
    expect(launch.cwd).toBe(workspace);
    expect(launch.spawnOptions).toMatchObject({
      cwd: workspace,
      timeout: 90000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(launch.env).toMatchObject({
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'test-key',
      ANTHROPIC_BASE_URL: 'https://provider.example.com',
    });
  });

  it('builds OpenCode launch config with room workspace as cwd and --dir', () => {
    const workspace = '/Users/yulong/work/sample-project';
    const launch = buildOpenCodeProviderLaunch(
      'hello from opencode',
      { workspace, thinking: false, model: 'google/gemini-2.5-pro' },
      { ...baseProviderConfig, name: 'opencode', cliPath: '~/bin/opencode' },
      { HOME: '/Users/tester', PATH: '/usr/bin' },
    );

    expect(launch.cliPath).toBe('/Users/tester/bin/opencode');
    expect(launch.args).toEqual(expect.arrayContaining(['run', '--dir', workspace, '--format', 'json', '--', 'hello from opencode']));
    expect(launch.args).toEqual(expect.arrayContaining(['-m', 'google/gemini-2.5-pro']));
    expect(launch.args).not.toContain('--thinking');
    expect(launch.cwd).toBe(workspace);
    expect(launch.spawnOptions).toMatchObject({
      cwd: workspace,
      timeout: 90000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  it('falls back to the default cwd when room workspace is absent', () => {
    const claudeLaunch = buildClaudeProviderLaunch(
      'no workspace',
      {},
      { ...baseProviderConfig, name: 'claude-code', cliPath: 'claude' },
      { PATH: '/usr/bin' },
    );
    const opencodeLaunch = buildOpenCodeProviderLaunch(
      'no workspace',
      {},
      { ...baseProviderConfig, name: 'opencode', cliPath: 'opencode' },
      { PATH: '/usr/bin' },
    );

    expect(claudeLaunch.cwd).toBe(process.cwd());
    expect(claudeLaunch.args).not.toContain('--add-dir');
    expect(opencodeLaunch.cwd).toBe('/tmp');
    expect(opencodeLaunch.args).not.toContain('--dir');
  });
});
