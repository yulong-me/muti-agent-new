import { spawn } from 'child_process';
import { createInterface } from 'readline';

function telemetry(event: 'call_start' | 'call_end' | 'call_error', meta: Record<string, unknown>) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [TELEMETRY] agent:${event} ${JSON.stringify(meta)}`);
}

export interface AgentPromptContext {
  domainLabel: string;
  systemPrompt: string;
  userMessage: string;
}

/** Raw NDJSON event from claude -p stream-json */
export type ClaudeEvent =
  | { type: 'start'; agentId: string; timestamp: number; messageId: string }
  | { type: 'delta'; agentId: string; text: string }
  | { type: 'thinking_delta'; agentId: string; thinking: string }
  | { type: 'end'; agentId: string; duration_ms: number; total_cost_usd: number; input_tokens: number; output_tokens: number }
  | { type: 'error'; agentId: string; message: string }
  | { type: 'result_text'; agentId: string; text: string };

/**
 * Spawns claude -p with NDJSON streaming and yields parsed events.
 * This is the core streaming primitive — it yields text deltas as they arrive,
 * plus timing/cost metadata when complete.
 */
export async function* streamClaudeCode(
  prompt: string,
  agentId: string,
  timeout = 90000,
): AsyncGenerator<ClaudeEvent, void, undefined> {
  const start = Date.now();
  telemetry('call_start', { type: 'claude-code-streaming', agentId, promptLength: prompt.length, timeout });

  const proc = spawn('claude', [
    '-p', prompt,
    '--verbose',
    '--output-format=stream-json',
    '--include-partial-messages',
  ], { timeout, stdio: ['ignore', 'pipe', 'pipe'] });

  let stderrBuffer = '';
  proc.stderr?.on('data', (d: Buffer) => { stderrBuffer += d.toString(); });

  const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });

  let messageId: string | null = null;
  let currentText = '';
  let thinkingBuffer = '';
  let inThinkingBlock = false;

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // skip non-JSON lines
    }

    const eventType = parsed.type as string;

    if (eventType === 'stream_event') {
      const event = parsed.event as Record<string, unknown>;
      const subType = event.type as string;

      if (subType === 'message_start') {
        const msg = event.message as Record<string, unknown>;
        messageId = msg.id as string;
        yield { type: 'start', agentId, timestamp: Date.now(), messageId };
      } else if (subType === 'content_block_start') {
        const block = event.content_block as Record<string, unknown>;
        if (block.type === 'thinking') {
          inThinkingBlock = true;
          thinkingBuffer = '';
        }
      } else if (subType === 'content_block_delta') {
        const delta = event.delta as Record<string, unknown>;
        if (delta.type === 'text_delta') {
          const text = delta.text as string;
          currentText += text;
          yield { type: 'delta', agentId, text };
        } else if (delta.type === 'thinking_delta') {
          const thinking = delta.thinking as string;
          thinkingBuffer += thinking;
          yield { type: 'thinking_delta', agentId, thinking };
        }
      } else if (subType === 'content_block_stop') {
        inThinkingBlock = false;
      } else if (subType === 'message_delta') {
        // streaming finished, usage info in delta
      } else if (subType === 'message_stop') {
        // stream done
      }
    } else if (eventType === 'result') {
      const result = parsed as Record<string, unknown>;
      const usage = result.usage as Record<string, number> || {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modelUsage = (result.modelUsage as Record<string, Record<string, any>>) || {};
      const modelEntry = Object.values(modelUsage)[0] as Record<string, unknown> | undefined;

      yield {
        type: 'end',
        agentId,
        duration_ms: (result.duration_ms as number) || (Date.now() - start),
        total_cost_usd: (result.total_cost_usd as number) || (modelEntry?.costUSD as number) || 0,
        input_tokens: (usage.input_tokens as number) || (modelEntry?.inputTokens as number) || 0,
        output_tokens: (usage.output_tokens as number) || (modelEntry?.outputTokens as number) || 0,
      };
    }
  }

  // Wait for process exit
  await new Promise<void>((resolve) => {
    proc.on('close', (code) => {
      const dur = Date.now() - start;
      if (code !== 0 && stderrBuffer.trim()) {
        telemetry('call_error', { type: 'claude-code-streaming', agentId, duration_ms: dur, stderr: stderrBuffer.slice(0, 500) });
      } else {
        telemetry('call_end', { type: 'claude-code-streaming', agentId, duration_ms: dur });
      }
      resolve();
    });
    proc.on('error', (err) => {
      telemetry('call_error', { type: 'claude-code-streaming', agentId, error: err.message });
      resolve();
    });
  });
}

/**
 * Convenience wrapper: collects streaming output and returns final result + stats.
 * Also calls the onDelta callback for each text fragment and onThinking for reasoning traces.
 */
export async function callAgentWithStreaming(
  ctx: AgentPromptContext,
  agentId: string,
  onDelta: (text: string) => void,
  onThinking?: (thinking: string) => void,
): Promise<{ text: string; duration_ms: number; total_cost_usd: number; input_tokens: number; output_tokens: number }> {
  const prompt = `【角色】${ctx.domainLabel}（${ctx.systemPrompt}）

${ctx.userMessage}`;

  let fullText = '';
  let duration_ms = 0;
  let total_cost_usd = 0;
  let input_tokens = 0;
  let output_tokens = 0;

  try {
    for await (const event of streamClaudeCode(prompt, agentId)) {
      if (event.type === 'delta') {
        fullText += event.text;
        onDelta(event.text);
      } else if (event.type === 'end') {
        duration_ms = event.duration_ms;
        total_cost_usd = event.total_cost_usd;
        input_tokens = event.input_tokens;
        output_tokens = event.output_tokens;
      } else if (event.type === 'thinking_delta' && onThinking) {
        onThinking(event.thinking);
      } else if (event.type === 'error') {
        throw new Error(event.message);
      }
    }
  } catch (err) {
    telemetry('call_error', { type: 'agent', domainLabel: ctx.domainLabel, error: String(err) });
    throw err;
  }

  return { text: fullText, duration_ms, total_cost_usd, input_tokens, output_tokens };
}
