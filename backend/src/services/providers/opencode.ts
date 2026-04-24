import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { Readable, Transform } from 'stream';
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

export function buildOpenCodeProviderLaunch(
  prompt: string,
  opts: Record<string, unknown> = {},
  providerCfg: ProviderConfig | undefined = getProvider('opencode'),
  baseEnv: Record<string, string> = process.env as Record<string, string>,
): ProviderLaunchConfig {
  const timeout = ((opts.timeout as number) ?? (providerCfg?.timeout ?? 90)) * 1000;
  const thinking = opts.thinking !== false;
  const sessionId = opts.sessionId as string | undefined;
  const workspace = opts.workspace as string | undefined;
  const providerRuntimeDir = opts.providerRuntimeDir as string | undefined;
  // Let opencode pick its configured default model unless the caller explicitly overrides it.
  const model = typeof opts.model === 'string' && opts.model.trim()
    ? opts.model.trim()
    : undefined;
  const cliPath = (providerCfg?.cliPath ?? 'opencode').replace(/^~/, baseEnv.HOME || '/root');
  const cwd = providerRuntimeDir ?? workspace ?? '/tmp';

  const env: Record<string, string> = { ...(baseEnv as Record<string, string>) };
  if (providerCfg?.apiKey) env.ANTHROPIC_API_KEY = providerCfg.apiKey;
  if (providerCfg?.baseUrl) env.ANTHROPIC_BASE_URL = providerCfg.baseUrl;

  const args: string[] = ['run'];
  if (workspace) args.push('--dir', workspace);
  if (sessionId) args.push('--session', sessionId);
  if (model) args.push('-m', model);
  if (thinking) args.push('--thinking');
  args.push('--dangerously-skip-permissions');
  args.push('--format', 'json');
  args.push('--', prompt);

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

export function parseOpenCodeToolUseEvent(parsed: Record<string, unknown>, agentId: string): ClaudeEvent | null {
  if (parsed.type !== 'tool_use') return null;

  const toolPart = asRecord(parsed.part) ?? parsed;
  const toolType = toolPart.type;
  if (toolType !== 'tool' && toolType !== 'tool_use') return null;

  const state = asRecord(toolPart.state);
  const toolName = typeof toolPart.tool === 'string'
    ? toolPart.tool
    : typeof toolPart.name === 'string'
    ? toolPart.name
    : 'unknown';
  const callId = typeof toolPart.callID === 'string'
    ? toolPart.callID
    : typeof toolPart.callId === 'string'
    ? toolPart.callId
    : typeof toolPart.id === 'string'
    ? toolPart.id
    : undefined;

  return {
    type: 'tool_use',
    agentId,
    toolName,
    toolInput: asRecord(state?.input) ?? asRecord(toolPart.input) ?? {},
    callId,
  };
}

export function extractOpenCodeErrorMessage(parsed: Record<string, unknown>): string {
  const part = asRecord(parsed.part);
  const rootError = asRecord(parsed.error);
  const partError = asRecord(part?.error);

  const directMessage =
    (typeof part?.error === 'string' ? part.error : undefined)
    ?? (typeof part?.message === 'string' ? part.message : undefined)
    ?? (typeof parsed.error === 'string' ? parsed.error : undefined)
    ?? (typeof parsed.message === 'string' ? parsed.message : undefined)
    ?? (typeof partError?.message === 'string' ? partError.message : undefined)
    ?? (typeof rootError?.message === 'string' ? rootError.message : undefined);

  if (directMessage) return directMessage;

  const fallback = part ?? parsed;
  try {
    return `opencode error event: ${JSON.stringify(fallback).slice(0, 300)}`;
  } catch {
    return 'unknown opencode error';
  }
}

/**
 * Normalize subprocess stdout to UTF-8 text stream.
 * Uses TextDecoder with auto-detection to handle:
 * - UTF-16LE BOM from Windows CLI tools (opencode)
 * - UTF-8 from Unix CLI tools
 * The decoder is created with fatal:false so partial/invalid sequences are replaced
 * with the replacement character rather than throwing.
 */
function toUtf8(input: Readable): Readable {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return input.pipe(new Transform({
    transform(chunk, _encoding, callback) {
      const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk);
      // TextDecoder auto-detects UTF-16LE BOM (FF FE) and handles it transparently
      const utf8 = decoder.decode(buf, { stream: true });
      callback(null, utf8);
    },
  }));
}

export async function* streamOpenCodeProvider(
  prompt: string,
  agentId: string,
  opts: Record<string, unknown> = {},
): AsyncGenerator<ClaudeEvent, void, undefined> {
  const start = Date.now();
  const providerCfg = getProvider('opencode');
  const launch = buildOpenCodeProviderLaunch(prompt, opts, providerCfg);
  const timeout = launch.timeout;
  // No -m flag: let opencode use its own default model
  const thinking = opts.thinking !== false; // default true
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
    thinking,
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
    provider: 'opencode',
    workspace,
    providerRuntimeDir,
    cwd: launch.cwd,
    sessionId: sessionId ?? null,
    thinking,
    timeout,
    cliPath: launch.cliPath,
    envKeys: Object.keys(launch.env),
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

  // Windows opencode outputs UTF-16LE; normalize to UTF-8 via TextDecoder
  const stdoutStream = toUtf8(proc.stdout!);
  const rl = createInterface({ input: stdoutStream, crlfDelay: Infinity });
  let capturedSessionId = sessionId ?? '';

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

    const eventType = parsed.type as string;
    const part = parsed.part as Record<string, unknown> | undefined;
    debug('provider:event', { roomId, agentId, agentName, eventType, partType: part?.type });

    // Capture session ID from step_start
    if (eventType === 'step_start' && !capturedSessionId) {
      capturedSessionId = (parsed.sessionID as string) || '';
    }

    if (eventType === 'step_start') {
      yield { type: 'start', agentId, timestamp: Date.now(), messageId: (part?.messageID as string) ?? '' };
    } else if (eventType === 'tool_use') {
      const toolUseEvent = parseOpenCodeToolUseEvent(parsed, agentId);
      if (toolUseEvent) {
        markTokenReceived();
        yield toolUseEvent;
      }
    } else if (eventType === 'reasoning') {
      markTokenReceived();
      yield { type: 'thinking_delta', agentId, thinking: (part?.text as string) ?? '' };
    } else if (eventType === 'text') {
      markTokenReceived();
      yield { type: 'delta', agentId, text: (part?.text as string) ?? '' };
    } else if (eventType === 'step_finish') {
      // Read metadata from the 'part' sub-object (which contains reason/cost/tokens)
      const finishPart = (part ?? parsed) as Record<string, unknown>;
      const tokens = finishPart.tokens as Record<string, number> | undefined;
      const tokenCache = asRecord(tokens?.cache);
      const cost = finishPart.cost as number | undefined;
      const reason = finishPart.reason as string | undefined;
      const inputTokens = tokens?.input ?? 0;
      const outputTokens = tokens?.output ?? 0;
      const totalTokens = tokens?.total ?? 0;
      const reasoningTokens = tokens?.reasoning ?? 0;
      const cacheReadTokens = (tokenCache?.read as number) ?? 0;
      const cacheWriteTokens = (tokenCache?.write as number) ?? 0;
      // Only emit 'end' when the agent has finished responding (not after tool calls)
      if (reason === 'stop' || reason === 'nostop') {
        clearTimers();
        yield {
          type: 'end',
          agentId,
          duration_ms: Date.now() - start,
          total_cost_usd: cost ?? 0,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          sessionId: capturedSessionId,
          total_tokens: totalTokens,
          reasoning_tokens: reasoningTokens,
          cache_read_tokens: cacheReadTokens,
          cache_write_tokens: cacheWriteTokens,
          last_turn_input_tokens: inputTokens + cacheReadTokens + cacheWriteTokens,
        };
      }
    } else if (eventType === 'error' || (part?.type === 'error')) {
      yield { type: 'error', agentId, message: extractOpenCodeErrorMessage(parsed) };
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
