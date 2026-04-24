import type { ProviderName } from '../config/agentConfig.js';
import { getProvider as getProviderConfig } from '../config/providerConfig.js';
import type { ContextHealth, InvocationUsage, SessionTelemetry } from '../types.js';

export interface ProviderEndTelemetry {
  duration_ms: number;
  total_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  sessionId?: string;
  model?: string;
  total_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  reasoning_tokens?: number;
  last_turn_input_tokens?: number;
  context_window_tokens?: number;
}

function asNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function sumNonNegative(...values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  if (present.length === 0) return undefined;
  return present.reduce((total, value) => total + value, 0);
}

function inferContextWindowSize(providerName: ProviderName, model?: string): number | undefined {
  const normalizedModel = (model ?? '').toLowerCase();
  if (normalizedModel.includes('1m')) return 1_000_000;
  if (normalizedModel.includes('minimax-m2.7')) return 200_000;
  if (normalizedModel.includes('claude')) return 200_000;
  return undefined;
}

export function buildInvocationUsage(args: {
  providerName: ProviderName;
  configuredModel?: string;
  event: ProviderEndTelemetry;
}): InvocationUsage {
  const providerConfig = getProviderConfig(args.providerName);
  const defaultModel = args.providerName === 'opencode'
    ? undefined
    : providerConfig?.defaultModel;
  const model = (args.event.model?.trim() || args.configuredModel?.trim() || defaultModel || '').trim() || undefined;
  const inputTokens = asNonNegativeNumber(args.event.input_tokens);
  const outputTokens = asNonNegativeNumber(args.event.output_tokens);
  const cacheReadTokens = asNonNegativeNumber(args.event.cache_read_tokens);
  const cacheWriteTokens = asNonNegativeNumber(args.event.cache_write_tokens);
  const reasoningTokens = asNonNegativeNumber(args.event.reasoning_tokens);
  const totalTokens = asNonNegativeNumber(args.event.total_tokens);
  const lastTurnInputTokens = asNonNegativeNumber(args.event.last_turn_input_tokens)
    ?? sumNonNegative(inputTokens, cacheReadTokens, cacheWriteTokens);
  const contextWindowSize = asNonNegativeNumber(args.event.context_window_tokens)
    ?? asNonNegativeNumber(providerConfig?.contextWindow)
    ?? inferContextWindowSize(args.providerName, model);

  return {
    provider: providerConfig?.label ?? args.providerName,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    lastTurnInputTokens,
    contextWindowSize,
    costUsd: asNonNegativeNumber(args.event.total_cost_usd),
    latencyMs: asNonNegativeNumber(args.event.duration_ms),
  };
}

export function buildContextHealth(args: {
  usage?: InvocationUsage;
  hasExplicitContextWindow: boolean;
}): ContextHealth | undefined {
  const usage = args.usage;
  if (!usage) return undefined;

  const usedTokens = asNonNegativeNumber(usage.lastTurnInputTokens)
    ?? asNonNegativeNumber(usage.inputTokens)
    ?? asNonNegativeNumber(usage.totalTokens);
  const windowSize = asNonNegativeNumber(usage.contextWindowSize);

  if (usedTokens === undefined || windowSize === undefined || windowSize <= 0) {
    return undefined;
  }

  const fillRatio = Math.min(Math.max(usedTokens / windowSize, 0), 1);
  const leftTokens = Math.max(windowSize - usedTokens, 0);
  const leftPct = Math.max(0, Math.round((1 - fillRatio) * 100));
  const state = fillRatio >= 0.8
    ? 'danger'
    : fillRatio >= 0.6
      ? 'warn'
      : 'healthy';

  return {
    usedTokens,
    windowSize,
    leftTokens,
    leftPct,
    fillRatio,
    source: args.hasExplicitContextWindow ? 'exact' : 'approx',
    state,
  };
}

export function buildSessionTelemetry(args: {
  sessionId?: string;
  invocationUsage?: InvocationUsage;
  contextHealth?: ContextHealth;
  measuredAt?: number;
}): SessionTelemetry | undefined {
  if (!args.sessionId) return undefined;
  return {
    sessionId: args.sessionId,
    invocationUsage: args.invocationUsage,
    contextHealth: args.contextHealth,
    measuredAt: args.measuredAt ?? Date.now(),
  };
}
