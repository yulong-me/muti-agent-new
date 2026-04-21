/**
 * Provider abstraction — unified streaming interface for all agent backends.
 * Callers use getProvider() to get the right implementation based on agent config.
 */
import { streamClaudeCodeProvider } from './claudeCode.js';
import { streamOpenCodeProvider } from './opencode.js';
import type { ProviderName } from '../../config/agentConfig.js';

// Re-export the unified event type
export type ClaudeEvent =
  | { type: 'start'; agentId: string; timestamp: number; messageId: string }
  | { type: 'delta'; agentId: string; text: string }
  | { type: 'thinking_delta'; agentId: string; thinking: string }
  | { type: 'tool_use'; agentId: string; toolName: string; toolInput: Record<string, unknown>; callId?: string }
  | { type: 'end'; agentId: string; duration_ms: number; total_cost_usd: number; input_tokens: number; output_tokens: number; sessionId?: string }
  | { type: 'error'; agentId: string; message: string };

export type StreamFn = (
  prompt: string,
  agentId: string,
  opts?: Record<string, unknown>,
) => AsyncGenerator<ClaudeEvent, void, undefined>;

const PROVIDERS: Record<ProviderName, StreamFn> = {
  'claude-code': streamClaudeCodeProvider,
  'opencode': streamOpenCodeProvider,
};

export function getProvider(name: ProviderName): StreamFn {
  const fn = PROVIDERS[name];
  if (!fn) throw new Error(`Unknown provider: ${name}`);
  return fn;
}
