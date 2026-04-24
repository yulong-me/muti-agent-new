import { spawn } from 'child_process';
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

export function buildClaudeProviderLaunch(
  prompt: string,
  opts: Record<string, unknown> = {},
  providerCfg: ProviderConfig | undefined = getProvider('claude-code'),
  baseEnv: Record<string, string> = process.env as Record<string, string>,
): ProviderLaunchConfig {
  const timeout = ((opts.timeout as number) ?? (providerCfg?.timeout ?? 90)) * 1000;
  const sessionId = opts.sessionId as string | undefined;
  const workspace = opts.workspace as string | undefined;
  const providerRuntimeDir = opts.providerRuntimeDir as string | undefined;
  const model = typeof opts.model === 'string' && opts.model.trim()
    ? opts.model.trim()
    : providerCfg?.defaultModel.trim()
    ? providerCfg.defaultModel.trim()
    : undefined;
  const cliPath = (providerCfg?.cliPath ?? 'claude').replace(/^~/, baseEnv.HOME || '/root');
  const cwd = providerRuntimeDir ?? workspace ?? process.cwd();

  const env: Record<string, string> = { ...(baseEnv as Record<string, string>) };
  if (providerCfg?.apiKey) env.ANTHROPIC_API_KEY = providerCfg.apiKey;
  if (providerCfg?.baseUrl) env.ANTHROPIC_BASE_URL = providerCfg.baseUrl;

  const args = ['-p', prompt, '--verbose', '--output-format=stream-json', '--include-partial-messages'];
  args.push('--dangerously-skip-permissions');
  if (model) args.push('--model', model);
  if (sessionId) args.splice(1, 0, '--resume', sessionId);
  if (workspace) args.push('--add-dir', workspace);

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

export function parseClaudeAssistantToolUseEvents(parsed: Record<string, unknown>, agentId: string): ClaudeEvent[] {
  const message = asRecord(parsed.message);
  const content = Array.isArray(message?.content)
    ? message.content as Record<string, unknown>[]
    : [];

  return content
    .filter(block => block.type === 'tool_use')
    .map(block => ({
      type: 'tool_use' as const,
      agentId,
      toolName: typeof block.name === 'string' ? block.name : 'unknown',
      toolInput: asRecord(block.input) ?? {},
      callId: typeof block.id === 'string' ? block.id : undefined,
    }));
}

export async function* streamClaudeCodeProvider(
  prompt: string,
  agentId: string,
  opts: Record<string, unknown> = {},
): AsyncGenerator<ClaudeEvent, void, undefined> {
  const start = Date.now();
  const providerCfg = getProvider('claude-code');
  const launch = buildClaudeProviderLaunch(prompt, opts, providerCfg);
  const timeout = launch.timeout;
  const sessionId = opts.sessionId as string | undefined;
  const roomId = opts.roomId as string | undefined;
  const agentName = opts.agentName as string | undefined;
  const firstTokenTimeoutMs = Number(opts.firstTokenTimeoutMs ?? 180000); // 3 min
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
    provider: 'claude-code',
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
  let capturedSessionId = sessionId ?? '';

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;

    const parsed = (() => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return failForParseError(line);
      }
    })();

    const eventType = parsed.type as string;

    // Capture session_id from system/init event (only on first call without resume)
    if (eventType === 'system' && (parsed.subtype as string) === 'init' && !capturedSessionId) {
      capturedSessionId = (parsed.session_id as string) || '';
    }

    if (eventType === 'stream_event') {
      const event = parsed.event as Record<string, unknown>;
      const subType = event.type as string;

      if (subType === 'message_start') {
        const msg = event.message as Record<string, unknown>;
        yield { type: 'start', agentId, timestamp: Date.now(), messageId: msg.id as string };
      } else if (subType === 'content_block_delta') {
        const delta = event.delta as Record<string, unknown>;
        if (delta.type === 'text_delta') {
          markTokenReceived();
          yield { type: 'delta', agentId, text: delta.text as string };
        } else if (delta.type === 'thinking_delta') {
          markTokenReceived();
          yield { type: 'thinking_delta', agentId, thinking: delta.thinking as string };
        }
      }
    } else if (eventType === 'assistant') {
      for (const toolUseEvent of parseClaudeAssistantToolUseEvents(parsed, agentId)) {
        markTokenReceived();
        yield toolUseEvent;
      }
    } else if (eventType === 'result') {
      clearTimers();
      const result = parsed as Record<string, unknown>;
      const usage = (result.usage as Record<string, number>) || {};
      const modelUsage = ((result.modelUsage as Record<string, Record<string, unknown>>) || {});
      const modelName = Object.keys(modelUsage)[0];
      const modelEntry = Object.values(modelUsage)[0] as Record<string, unknown> | undefined;
      const cacheReadTokens = (usage.cache_read_input_tokens as number) || (modelEntry?.cacheReadInputTokens as number) || 0;
      const cacheWriteTokens = (usage.cache_creation_input_tokens as number) || (modelEntry?.cacheCreationInputTokens as number) || 0;
      const inputTokens = (usage.input_tokens as number) || (modelEntry?.inputTokens as number) || 0;
      const outputTokens = (usage.output_tokens as number) || (modelEntry?.outputTokens as number) || 0;
      yield {
        type: 'end',
        agentId,
        duration_ms: (result.duration_ms as number) || (Date.now() - start),
        total_cost_usd: (result.total_cost_usd as number) || (modelEntry?.costUSD as number) || 0,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        sessionId: capturedSessionId,
        model: modelName || undefined,
        total_tokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
        cache_read_tokens: cacheReadTokens,
        cache_write_tokens: cacheWriteTokens,
        last_turn_input_tokens: inputTokens + cacheReadTokens + cacheWriteTokens,
        context_window_tokens: (modelEntry?.contextWindow as number) || 0,
      };
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
        debug('provider:call_end', { roomId, agentId, agentName, duration_ms: Date.now() - start, sessionId: capturedSessionId });
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
