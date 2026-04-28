import { spawn } from 'child_process';
import path from 'path';
import { createInterface } from 'readline';
import { ClaudeEvent } from './index.js';
import { getProvider } from '../../config/providerConfig.js';
import type { ProviderConfig } from '../../config/providerConfig.js';
import { debug, error } from '../../lib/logger.js';

function shellQuote(arg: string): string {
  if (arg === '') return "''";
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function definedEntries(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

interface ProviderLaunchConfig {
  cliPath: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  timeout: number;
  spawnOptions: {
    timeout: number;
    env: Record<string, string>;
    cwd: string;
    stdio: ['ignore', 'pipe', 'pipe'];
  };
}

export function buildCodexProviderLaunch(
  prompt: string,
  opts: Record<string, unknown> = {},
  providerCfg: ProviderConfig | undefined = getProvider('codex'),
  baseEnv: Record<string, string> = process.env as Record<string, string>,
): ProviderLaunchConfig {
  const timeout = ((opts.timeout as number) ?? (providerCfg?.timeout ?? 90)) * 1000;
  const thinking = providerCfg?.thinking !== false && opts.thinking !== false;
  const sessionId = opts.sessionId as string | undefined;
  const workspace = opts.workspace as string | undefined;
  const providerRuntimeDir = opts.providerRuntimeDir as string | undefined;
  const providerWorkspacePath = providerRuntimeDir ? path.join(providerRuntimeDir, 'workspace') : workspace;
  const model = typeof opts.model === 'string' && opts.model.trim()
    ? opts.model.trim()
    : providerCfg?.defaultModel.trim()
    ? providerCfg.defaultModel.trim()
    : undefined;
  const cliPath = (providerCfg?.cliPath ?? 'codex').replace(/^~/, baseEnv.HOME || '/root');
  const cwd = providerRuntimeDir ?? workspace ?? process.cwd();

  const env: Record<string, string> = { ...(baseEnv as Record<string, string>) };
  if (providerCfg?.apiKey) env.OPENAI_API_KEY = providerCfg.apiKey;
  if (providerCfg?.baseUrl) env.OPENAI_BASE_URL = providerCfg.baseUrl;

  const args = [
    'exec',
    '--json',
    '--color',
    'never',
    '--skip-git-repo-check',
  ];
  if (providerWorkspacePath) args.push('-C', providerWorkspacePath);
  if (model) args.push('-m', model);
  args.push('-c', `model_reasoning_effort=${thinking ? 'high' : 'low'}`);
  if (opts.bypassSandbox !== false) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else if (typeof opts.sandbox === 'string' && opts.sandbox.trim()) {
    args.push('-s', opts.sandbox.trim());
  }

  if (sessionId) {
    args.push('resume', sessionId, prompt);
  } else {
    args.push(prompt);
  }

  return {
    cliPath,
    args,
    env,
    cwd,
    timeout,
    spawnOptions: {
      timeout,
      env,
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  };
}

interface CodexParseState {
  startTime: number;
  now?: () => number;
  sessionId?: string;
  contextWindowTokens?: number;
  started?: boolean;
  completed?: boolean;
}

function emitStart(agentId: string, state: CodexParseState, messageId = ''): ClaudeEvent[] {
  if (state.started) return [];
  state.started = true;
  return [{
    type: 'start',
    agentId,
    timestamp: state.now?.() ?? Date.now(),
    messageId,
  }];
}

function buildEndEvent(agentId: string, usage: Record<string, unknown> | undefined, state: CodexParseState): ClaudeEvent[] {
  if (state.completed) return [];
  state.completed = true;

  const inputTokens = asNumber(usage?.input_tokens) ?? 0;
  const cacheReadTokens = asNumber(usage?.cached_input_tokens) ?? asNumber(usage?.cache_read_input_tokens) ?? 0;
  const cacheWriteTokens = asNumber(usage?.cache_write_input_tokens) ?? asNumber(usage?.cache_creation_input_tokens) ?? 0;
  const outputTokens = asNumber(usage?.output_tokens) ?? 0;
  const reasoningTokens = asNumber(usage?.reasoning_output_tokens) ?? asNumber(usage?.reasoning_tokens) ?? 0;
  const totalTokens = asNumber(usage?.total_tokens) ?? inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens + reasoningTokens;

  const event: ClaudeEvent = {
    type: 'end',
    agentId,
    duration_ms: (state.now?.() ?? Date.now()) - state.startTime,
    total_cost_usd: 0,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    cache_read_tokens: cacheReadTokens,
    cache_write_tokens: cacheWriteTokens,
    reasoning_tokens: reasoningTokens,
    last_turn_input_tokens: inputTokens,
  };
  if (state.sessionId) event.sessionId = state.sessionId;
  if (state.contextWindowTokens) event.context_window_tokens = state.contextWindowTokens;
  return [event];
}

function parseCodexToolItem(item: Record<string, unknown>, agentId: string): ClaudeEvent | null {
  const itemType = asString(item.type);
  const callId = asString(item.id);

  if (itemType === 'command_execution') {
    return {
      type: 'tool_use',
      agentId,
      toolName: 'command_execution',
      toolInput: definedEntries({
        command: asString(item.command),
        status: asString(item.status),
        exit_code: asNumber(item.exit_code),
      }),
      callId,
    };
  }

  if (itemType === 'mcp_tool_call') {
    return {
      type: 'tool_use',
      agentId,
      toolName: asString(item.tool) ?? 'mcp_tool_call',
      toolInput: asRecord(item.arguments) ?? {},
      callId,
    };
  }

  if (itemType === 'collab_tool_call') {
    return {
      type: 'tool_use',
      agentId,
      toolName: asString(item.tool) ?? 'collab_tool_call',
      toolInput: definedEntries({
        prompt: asString(item.prompt),
        status: asString(item.status),
      }),
      callId,
    };
  }

  if (itemType === 'web_search') {
    return {
      type: 'tool_use',
      agentId,
      toolName: 'web_search',
      toolInput: definedEntries({
        query: asString(item.query),
        action: item.action,
      }),
      callId,
    };
  }

  return null;
}

function parseCodexItemEvent(item: Record<string, unknown>, agentId: string): ClaudeEvent[] {
  const itemType = asString(item.type);
  if (itemType === 'agent_message') {
    const text = asString(item.text);
    return text ? [{ type: 'delta', agentId, text }] : [];
  }
  if (itemType === 'reasoning') {
    const thinking = asString(item.text);
    return thinking ? [{ type: 'thinking_delta', agentId, thinking }] : [];
  }
  if (itemType === 'error') {
    const message = asString(item.message);
    return message ? [{ type: 'error', agentId, message }] : [];
  }
  const toolUse = parseCodexToolItem(item, agentId);
  return toolUse ? [toolUse] : [];
}

function parseErrorEvent(current: Record<string, unknown>, agentId: string): ClaudeEvent[] {
  const nestedError = asRecord(current.error);
  const message = asString(current.message) ?? asString(nestedError?.message);
  return message ? [{ type: 'error', agentId, message }] : [];
}

export function parseCodexJsonEvents(
  parsed: Record<string, unknown>,
  agentId: string,
  state: CodexParseState,
): ClaudeEvent[] {
  const msg = asRecord(parsed.msg);
  const current = msg ?? parsed;
  const eventType = asString(current.type);

  if (eventType === 'thread.started') {
    state.sessionId = asString(current.thread_id) ?? state.sessionId;
    return [];
  }

  if (eventType === 'turn.started') {
    return emitStart(agentId, state, state.sessionId ?? '');
  }

  if (eventType === 'task_started') {
    state.contextWindowTokens = asNumber(current.model_context_window) ?? state.contextWindowTokens;
    return emitStart(agentId, state, asString(parsed.id) ?? state.sessionId ?? '');
  }

  if (eventType === 'item.started' || eventType === 'item.updated' || eventType === 'item.completed') {
    const item = asRecord(current.item);
    return item ? parseCodexItemEvent(item, agentId) : [];
  }

  if (eventType === 'agent_message_delta') {
    const text = asString(current.delta) ?? asString(current.text);
    return text ? [{ type: 'delta', agentId, text }] : [];
  }

  if (eventType === 'agent_message') {
    const text = asString(current.text) ?? asString(current.message);
    return text ? [{ type: 'delta', agentId, text }] : [];
  }

  if (eventType === 'reasoning_delta' || eventType === 'reasoning') {
    const thinking = asString(current.delta) ?? asString(current.text);
    return thinking ? [{ type: 'thinking_delta', agentId, thinking }] : [];
  }

  if (eventType === 'turn.completed' || eventType === 'task_complete') {
    return buildEndEvent(agentId, asRecord(current.usage), state);
  }

  if (eventType === 'token_count') {
    const info = asRecord(current.info);
    state.contextWindowTokens = asNumber(info?.model_context_window) ?? state.contextWindowTokens;
    return buildEndEvent(agentId, asRecord(info?.total_token_usage) ?? asRecord(info?.last_token_usage), state);
  }

  if (eventType === 'turn.failed') {
    return parseErrorEvent(asRecord(current.error) ?? current, agentId);
  }

  if (eventType === 'error') {
    return parseErrorEvent(current, agentId);
  }

  return [];
}

export async function* streamCodexProvider(
  prompt: string,
  agentId: string,
  opts: Record<string, unknown> = {},
): AsyncGenerator<ClaudeEvent, void, undefined> {
  const start = Date.now();
  const providerCfg = getProvider('codex');
  const launch = buildCodexProviderLaunch(prompt, opts, providerCfg);
  const timeout = launch.timeout;
  const sessionId = opts.sessionId as string | undefined;
  const roomId = opts.roomId as string | undefined;
  const agentName = opts.agentName as string | undefined;
  const firstTokenTimeoutMs = Number(opts.firstTokenTimeoutMs ?? 180000);
  const idleTokenTimeoutMs = Number(opts.idleTokenTimeoutMs ?? 180000);
  const workspace = opts.workspace as string | undefined;
  const providerRuntimeDir = opts.providerRuntimeDir as string | undefined;
  const signal = opts.signal as AbortSignal | undefined;

  debug('provider:call_start', {
    roomId,
    agentId,
    agentName,
    promptLength: prompt.length,
    timeout,
    sessionId: sessionId ?? 'new',
    cliPath: launch.cliPath,
    cwd: launch.cwd,
    spawnOpts: launch.spawnOptions,
  });

  const command = `${shellQuote(launch.cliPath)} ${launch.args.map(a => shellQuote(a)).join(' ')}`;
  debug('provider:command', {
    roomId,
    agentId: agentName ?? agentId,
    command,
    provider: 'codex',
    workspace,
    providerRuntimeDir,
    cwd: launch.cwd,
    sessionId: sessionId ?? null,
    timeout,
    envKeys: Object.keys(launch.env ?? {}),
    spawnOpts: { cwd: launch.cwd, timeout, stdio: ['ignore', 'pipe', 'pipe'] },
    promptPreview: prompt.slice(0, 100),
  });

  const proc = spawn(launch.cliPath, launch.args, launch.spawnOptions);

  let stderrBuffer = '';
  proc.stderr?.on('data', (d: Buffer) => { stderrBuffer += d.toString(); });
  let timeoutError: Error | null = null;
  let stoppedError: Error | null = null;
  let sawToken = false;
  let firstTokenTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (firstTokenTimer) clearTimeout(firstTokenTimer);
    if (idleTimer) clearTimeout(idleTimer);
    firstTokenTimer = null;
    idleTimer = null;
  };

  const killForTimeout = (phase: 'first_token' | 'idle') => {
    if (timeoutError) return;
    const err = new Error(phase === 'first_token' ? 'Timed out waiting for first token' : 'Timed out waiting for next token');
    (err as Error & { code?: string; phase?: string }).code = 'AGENT_TIMEOUT';
    (err as Error & { code?: string; phase?: string }).phase = phase;
    timeoutError = err;
    try {
      proc.kill('SIGKILL');
    } catch {
      // ignore
    }
  };

  const armFirstTokenTimer = () => {
    if (firstTokenTimeoutMs <= 0) return;
    if (firstTokenTimer) clearTimeout(firstTokenTimer);
    firstTokenTimer = setTimeout(() => killForTimeout('first_token'), firstTokenTimeoutMs);
  };

  const armIdleTimer = () => {
    if (idleTokenTimeoutMs <= 0) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => killForTimeout('idle'), idleTokenTimeoutMs);
  };

  const markTokenReceived = () => {
    if (!sawToken) {
      sawToken = true;
      if (firstTokenTimer) clearTimeout(firstTokenTimer);
      firstTokenTimer = null;
    }
    armIdleTimer();
  };

  const failForParseError = (line: string): never => {
    clearTimers();
    const err = new Error(`Malformed provider JSON line: ${line.slice(0, 200)}`);
    (err as Error & { code?: string }).code = 'AGENT_PARSE_ERROR';
    try {
      proc.kill('SIGKILL');
    } catch {
      // ignore
    }
    throw err;
  };

  const stopProc = () => {
    if (timeoutError || stoppedError) return;
    clearTimers();
    const err = new Error('Agent run stopped by user');
    (err as Error & { code?: string }).code = 'AGENT_STOPPED';
    stoppedError = err;
    try {
      proc.kill('SIGKILL');
    } catch {
      // ignore
    }
  };

  if (signal?.aborted) {
    stopProc();
  } else {
    signal?.addEventListener('abort', stopProc, { once: true });
  }

  armFirstTokenTimer();

  const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });
  const parseState: CodexParseState = { startTime: start, sessionId };

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;

    const parsed = (() => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        if (line.trim()) debug('provider:non_json', { roomId, agentId, agentName, line: line.slice(0, 200) });
        return failForParseError(line);
      }
    })();

    const msg = asRecord(parsed.msg);
    const eventType = asString(msg?.type) ?? asString(parsed.type);
    debug('provider:event', { roomId, agentId, agentName, eventType });

    for (const event of parseCodexJsonEvents(parsed, agentId, parseState)) {
      if (event.type === 'delta' || event.type === 'thinking_delta' || event.type === 'tool_use') {
        markTokenReceived();
      }
      if (event.type === 'end' || event.type === 'error') {
        clearTimers();
      }
      yield event;
    }
  }

  await new Promise<void>((resolve, reject) => {
    proc.on('close', (code, closeSignal) => {
      clearTimers();
      signal?.removeEventListener('abort', stopProc);
      if (timeoutError) {
        reject(timeoutError);
        return;
      }
      if (stoppedError) {
        reject(stoppedError);
        return;
      }
      if (code !== 0) {
        const errMsg = stderrBuffer.trim() || `CLI exited with code ${code}`;
        error('provider:call_error', { roomId, agentId, agentName, stderr: errMsg.slice(0, 500) });
        const err = new Error(closeSignal ? `${errMsg} (signal: ${closeSignal})` : errMsg);
        (err as Error & { code?: string }).code = 'AGENT_PROCESS_EXIT';
        reject(err);
      } else {
        debug('provider:call_end', { roomId, agentId, agentName, duration_ms: Date.now() - start, sessionId: parseState.sessionId });
        resolve();
      }
    });
    proc.on('error', (err) => {
      clearTimers();
      signal?.removeEventListener('abort', stopProc);
      if (stoppedError) {
        reject(stoppedError);
        return;
      }
      error('provider:error', { roomId, agentId, agentName, error: err.message });
      (err as Error & { code?: string }).code = 'AGENT_PROCESS_EXIT';
      reject(err);
    });
  });
}
