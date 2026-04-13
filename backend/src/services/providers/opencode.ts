import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { ClaudeEvent } from './index.js';
import { getProvider } from '../../config/providerConfig.js';
import { debug, error } from '../../lib/logger.js';

function shellQuote(arg: string): string {
  if (arg === '') return "''";
  return `'${arg.replace(/'/g, `'\\''`)}'`;
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
    workspace,
    provider: 'opencode',
    cwd: workspace ?? '/tmp',
    spawnOpts: { cwd: workspace ?? '/tmp', timeout, stdio: ['ignore', 'pipe', 'pipe'] },
  });

  const proc = spawn(cliPath, args, { timeout, env, cwd: workspace ?? '/tmp', stdio: ['ignore', 'pipe', 'pipe'] });

  let stderrBuffer = '';
  proc.stderr?.on('data', (d: Buffer) => { stderrBuffer += d.toString(); });

  const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });
  let capturedSessionId = sessionId ?? '';

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      if (line.trim()) debug('provider:non_json', { roomId, agentId, agentName, line: line.slice(0, 200) });
      continue;
    }

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
      yield { type: 'thinking_delta', agentId, thinking: (part?.text as string) ?? '' };
    } else if (eventType === 'text') {
      yield { type: 'delta', agentId, text: (part?.text as string) ?? '' };
    } else if (eventType === 'step_finish') {
      // Read metadata from the 'part' sub-object (which contains reason/cost/tokens)
      const finishPart = (part ?? parsed) as Record<string, unknown>;
      const tokens = finishPart.tokens as Record<string, number> | undefined;
      const cost = finishPart.cost as number | undefined;
      const reason = finishPart.reason as string | undefined;
      // Only emit 'end' when the agent has finished responding (not after tool calls)
      if (reason === 'stop' || reason === 'nostop') {
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
    proc.on('close', (code) => {
      if (code !== 0) {
        const errMsg = stderrBuffer.trim() || `CLI exited with code ${code}`;
        error('provider:call_error', { roomId, agentId, agentName, stderr: errMsg.slice(0, 500) });
        reject(new Error(errMsg));
      } else {
        debug('provider:call_end', { roomId, agentId, agentName, duration_ms: Date.now() - start, sessionId: capturedSessionId });
        resolve();
      }
    });
    proc.on('error', (err) => {
      error('provider:error', { roomId, agentId, agentName, error: err.message });
      reject(err);
    });
  });
}
