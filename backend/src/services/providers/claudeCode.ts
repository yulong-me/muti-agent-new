import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { ClaudeEvent } from './index.js';
import { getProvider } from '../../config/providerConfig.js';

function telemetry(event: 'call_start' | 'call_end' | 'call_error', meta: Record<string, unknown>) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [PROVIDER:claude-code] ${event} ${JSON.stringify(meta)}`);
}

export async function* streamClaudeCodeProvider(
  prompt: string,
  agentId: string,
  opts: Record<string, unknown> = {},
): AsyncGenerator<ClaudeEvent, void, undefined> {
  const start = Date.now();
  const providerCfg = getProvider('claude-code');
  const timeout = ((opts.timeout as number) ?? (providerCfg?.timeout ?? 90)) * 1000;
  const sessionId = opts.sessionId as string | undefined;

  // Resolve CLI path (expand ~)
  const cliPath = (providerCfg?.cliPath ?? 'claude').replace(/^~/, process.env.HOME || '/root');

  // Build environment: inject API key and base URL if configured
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  if (providerCfg?.apiKey) env.ANTHROPIC_API_KEY = providerCfg.apiKey;
  if (providerCfg?.baseUrl) env.ANTHROPIC_BASE_URL = providerCfg.baseUrl;

  telemetry('call_start', { agentId, promptLength: prompt.length, timeout, sessionId: sessionId ?? 'new', cliPath });

  const args = ['-p', prompt, '--verbose', '--output-format=stream-json', '--include-partial-messages'];
  if (sessionId) args.splice(1, 0, '--resume', sessionId);

  // Workspace support — 每个 Room 有独立工作目录
  const workspace = opts.workspace as string | undefined;
  if (workspace) {
    args.push('--add-dir', workspace);
  }

  const proc = spawn(cliPath, args, { timeout, env, stdio: ['ignore', 'pipe', 'pipe'] });

  let stderrBuffer = '';
  proc.stderr?.on('data', (d: Buffer) => { stderrBuffer += d.toString(); });

  const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });
  let inThinkingBlock = false;
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
      } else if (subType === 'content_block_start') {
        const block = event.content_block as Record<string, unknown>;
        if (block.type === 'thinking') inThinkingBlock = true;
      } else if (subType === 'content_block_delta') {
        const delta = event.delta as Record<string, unknown>;
        if (delta.type === 'text_delta') {
          yield { type: 'delta', agentId, text: delta.text as string };
        } else if (delta.type === 'thinking_delta') {
          yield { type: 'thinking_delta', agentId, thinking: delta.thinking as string };
        }
      } else if (subType === 'content_block_stop') {
        inThinkingBlock = false;
      }
    } else if (eventType === 'result') {
      const result = parsed as Record<string, unknown>;
      const usage = (result.usage as Record<string, number>) || {};
      const modelUsage = ((result.modelUsage as Record<string, Record<string, unknown>>) || {});
      const modelEntry = Object.values(modelUsage)[0] as Record<string, unknown> | undefined;
      yield {
        type: 'end',
        agentId,
        duration_ms: (result.duration_ms as number) || (Date.now() - start),
        total_cost_usd: (result.total_cost_usd as number) || (modelEntry?.costUSD as number) || 0,
        input_tokens: (usage.input_tokens as number) || (modelEntry?.inputTokens as number) || 0,
        output_tokens: (usage.output_tokens as number) || (modelEntry?.outputTokens as number) || 0,
        sessionId: capturedSessionId,
      };
    }
  }

  await new Promise<void>((resolve, reject) => {
    proc.on('close', (code) => {
      if (code !== 0) {
        const errMsg = stderrBuffer.trim() || `CLI exited with code ${code}`;
        telemetry('call_error', { agentId, stderr: errMsg.slice(0, 500) });
        reject(new Error(errMsg));
      } else {
        telemetry('call_end', { agentId, duration_ms: Date.now() - start, sessionId: capturedSessionId });
        resolve();
      }
    });
    proc.on('error', (err) => {
      telemetry('call_error', { agentId, error: err.message });
      reject(err);
    });
  });
}
