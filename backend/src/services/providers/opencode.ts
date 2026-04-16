import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { Readable, Transform } from 'stream';
import { ClaudeEvent } from './index.js';
import { getProvider } from '../../config/providerConfig.js';
import { debug, error } from '../../lib/logger.js';

function shellQuote(arg: string): string {
  if (arg === '') return "''";
  return `'${arg.replace(/'/g, `'\\''`)}'`;
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
  const timeout = ((opts.timeout as number) ?? (providerCfg?.timeout ?? 90)) * 1000;
  // No -m flag: let opencode use its own default model
  const thinking = opts.thinking !== false; // default true
  const sessionId = opts.sessionId as string | undefined;
  const roomId = opts.roomId as string | undefined;
  const agentName = opts.agentName as string | undefined;
  const firstTokenTimeoutMs = Number(opts.firstTokenTimeoutMs ?? 15000);
  const idleTokenTimeoutMs = Number(opts.idleTokenTimeoutMs ?? 15000);
  // Default all permissions: write, exec, network

  // Resolve CLI path (expand ~)
  const cliPath = (providerCfg?.cliPath ?? 'opencode').replace(/^~/, process.env.HOME || '/root');

  // Workspace support — 每个 Room 有独立工作目录
  const workspace = opts.workspace as string | undefined;

  // Build environment: inject API key and base URL if configured
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  if (providerCfg?.apiKey) env.ANTHROPIC_API_KEY = providerCfg.apiKey;
  if (providerCfg?.baseUrl) env.ANTHROPIC_BASE_URL = providerCfg.baseUrl;

  debug('provider:call_start', {
    roomId,
    agentId,
    agentName,
    promptLength: prompt.length,
    timeout,
    thinking,
    sessionId: sessionId ?? 'new',
    cliPath,
    cwd: workspace ?? '/tmp',
    spawnOpts: { cwd: workspace ?? '/tmp', timeout, stdio: ['ignore', 'pipe', 'pipe'] },
  });

  // Build args: opencode run [opts] -- <prompt>
  // Critical: always use --format json (clowder-ai reference implementation)
  const args: string[] = ['run'];
  if (workspace) {
    // opencode does not support --add-dir; use --dir + spawn cwd to ensure room workspace.
    args.push('--dir', workspace);
  }
  if (sessionId) {
    args.push('--session', sessionId);
  }
  if (thinking) {
    args.push('--thinking');
  }
  // Default all permissions
  args.push('--dangerously-skip-permissions');
  args.push('--format', 'json');
  args.push('--', prompt);

  const command = `${shellQuote(cliPath)} ${args.map(a => shellQuote(a)).join(' ')}`;
  debug('provider:command', {
    roomId,
    agentId: agentName ?? agentId,
    command,
    provider: 'opencode',
    workspace,
    cwd: workspace ?? '/tmp',
    sessionId: sessionId ?? null,
    thinking,
    timeout,
    cliPath,
    envKeys: Object.keys(env),
    spawnOpts: { cwd: workspace ?? '/tmp', timeout, stdio: ['ignore', 'pipe', 'pipe'] },
    promptPreview: prompt.slice(0, 100),
  });

  const proc = spawn(cliPath, args, { timeout, env, cwd: workspace ?? '/tmp', stdio: ['ignore', 'pipe', 'pipe'] });

  let stderrBuffer = '';
  proc.stderr?.on('data', (d: Buffer) => { stderrBuffer += d.toString(); });
  let timeoutError: Error | null = null;
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
      const cost = finishPart.cost as number | undefined;
      const reason = finishPart.reason as string | undefined;
      // Only emit 'end' when the agent has finished responding (not after tool calls)
      if (reason === 'stop' || reason === 'nostop') {
        clearTimers();
        yield {
          type: 'end',
          agentId,
          duration_ms: Date.now() - start,
          total_cost_usd: cost ?? 0,
          input_tokens: tokens?.input ?? 0,
          output_tokens: tokens?.output ?? 0,
          sessionId: capturedSessionId,
        };
      }
    } else if (eventType === 'error' || (part?.type === 'error')) {
      yield { type: 'error', agentId, message: (part?.error as string) ?? 'unknown opencode error' };
    }
  }

  await new Promise<void>((resolve, reject) => {
    proc.on('close', (code, signal) => {
      clearTimers();
      if (timeoutError) {
        reject(timeoutError);
        return;
      }
      if (code !== 0) {
        const errMsg = stderrBuffer.trim() || `CLI exited with code ${code}`;
        error('provider:call_error', { roomId, agentId, agentName, stderr: errMsg.slice(0, 500) });
        const err = new Error(signal ? `${errMsg} (signal: ${signal})` : errMsg);
        (err as Error & { code?: string }).code = 'AGENT_PROCESS_EXIT';
        reject(err);
      } else {
        debug('provider:call_end', { roomId, agentId, agentName, duration_ms: Date.now() - start, sessionId: capturedSessionId });
        resolve();
      }
    });
    proc.on('error', (err) => {
      clearTimers();
      error('provider:error', { roomId, agentId, agentName, error: err.message });
      (err as Error & { code?: string }).code = 'AGENT_PROCESS_EXIT';
      reject(err);
    });
  });
}
