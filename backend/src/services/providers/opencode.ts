import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { ClaudeEvent } from './index.js';

function telemetry(event: 'call_start' | 'call_end' | 'call_error', meta: Record<string, unknown>) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [PROVIDER:opencode] ${event} ${JSON.stringify(meta)}`);
}

export async function* streamOpenCodeProvider(
  prompt: string,
  agentId: string,
  opts: Record<string, unknown> = {},
): AsyncGenerator<ClaudeEvent, void, undefined> {
  const start = Date.now();
  const timeout = (opts.timeout as number) ?? 90000;
  const model = opts.model as string | undefined;
  const thinking = opts.thinking !== false; // default true
  const sessionId = opts.sessionId as string | undefined;

  telemetry('call_start', { agentId, promptLength: prompt.length, timeout, model, thinking, sessionId: sessionId ?? 'new' });

  // Build args: opencode run [opts] [--] <prompt>
  const args: string[] = ['run'];
  if (sessionId) {
    args.push('--session', sessionId);
  }
  if (thinking) {
    args.push('--thinking');
  }
  if (model) {
    args.push('--model', model);
  }
  args.push('--', prompt);

  const proc = spawn('opencode', args, { timeout, stdio: ['ignore', 'pipe', 'pipe'] });

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
      continue;
    }

    const eventType = parsed.type as string;
    const part = parsed.part as Record<string, unknown> | undefined;

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
      const tokens = part?.tokens as Record<string, number> | undefined;
      const cost = part?.cost as number | undefined;
      yield {
        type: 'end',
        agentId,
        duration_ms: Date.now() - start,
        total_cost_usd: cost ?? 0,
        input_tokens: tokens?.input ?? 0,
        output_tokens: tokens?.output ?? 0,
        sessionId: capturedSessionId,
      };
    } else if (eventType === 'error' || (part?.type === 'error')) {
      yield { type: 'error', agentId, message: (part?.error as string) ?? 'unknown opencode error' };
    }
  }

  await new Promise<void>((resolve) => {
    proc.on('close', (code) => {
      if (code !== 0 && stderrBuffer.trim()) {
        telemetry('call_error', { agentId, stderr: stderrBuffer.slice(0, 500) });
      } else {
        telemetry('call_end', { agentId, duration_ms: Date.now() - start, sessionId: capturedSessionId });
      }
      resolve();
    });
    proc.on('error', (err) => {
      telemetry('call_error', { agentId, error: err.message });
      resolve();
    });
  });
}
