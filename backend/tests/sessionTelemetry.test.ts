import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/providerConfig.js', () => ({
  getProvider: vi.fn((name: string) => {
    if (name === 'claude-code') {
      return { label: 'Claude Code', defaultModel: 'claude-sonnet-4-6', contextWindow: 200000 };
    }
    if (name === 'opencode') {
      return { label: 'OpenCode', defaultModel: 'MiniMax-M2.7', contextWindow: 200000 };
    }
    return undefined;
  }),
}));

import { buildContextHealth, buildInvocationUsage } from '../src/services/sessionTelemetry.js';

describe('sessionTelemetry helpers', () => {
  it('derives Claude last-turn input from input + cache read + cache write', () => {
    const usage = buildInvocationUsage({
      providerName: 'claude-code',
      configuredModel: 'MiniMax-M2.7-highspeed',
      event: {
        duration_ms: 2400,
        total_cost_usd: 0.01,
        input_tokens: 318,
        output_tokens: 86,
        cache_read_tokens: 37073,
        cache_write_tokens: 5223,
        context_window_tokens: 200000,
      },
    });

    expect(usage.provider).toBe('Claude Code');
    expect(usage.model).toBe('MiniMax-M2.7-highspeed');
    expect(usage.lastTurnInputTokens).toBe(42614);

    const health = buildContextHealth({
      usage,
      hasExplicitContextWindow: true,
    });

    expect(health).toMatchObject({
      usedTokens: 42614,
      windowSize: 200000,
      leftTokens: 157386,
      leftPct: 79,
      source: 'exact',
      state: 'healthy',
    });
  });

  it('derives OpenCode last-turn input from input + cache write + cache read', () => {
    const usage = buildInvocationUsage({
      providerName: 'opencode',
      configuredModel: 'MiniMax-M2.7',
      event: {
        duration_ms: 1800,
        total_cost_usd: 0,
        input_tokens: 119,
        output_tokens: 35,
        total_tokens: 55884,
        cache_read_tokens: 35544,
        cache_write_tokens: 20186,
        reasoning_tokens: 0,
      },
    });

    expect(usage.provider).toBe('OpenCode');
    expect(usage.contextWindowSize).toBe(200000);
    expect(usage.lastTurnInputTokens).toBe(55849);

    const health = buildContextHealth({
      usage,
      hasExplicitContextWindow: false,
    });

    expect(health).toMatchObject({
      usedTokens: 55849,
      windowSize: 200000,
      leftTokens: 144151,
      leftPct: 72,
      source: 'approx',
      state: 'healthy',
    });
  });

  it('can use configured context window even when OpenCode does not report one', () => {
    const usage = buildInvocationUsage({
      providerName: 'opencode',
      event: {
        duration_ms: 1800,
        total_cost_usd: 0,
        input_tokens: 119,
        output_tokens: 35,
        total_tokens: 55884,
        cache_read_tokens: 35544,
        cache_write_tokens: 20186,
        reasoning_tokens: 0,
      },
    });

    expect(usage.provider).toBe('OpenCode');
    expect(usage.model).toBeUndefined();
    expect(usage.contextWindowSize).toBe(200000);

    const health = buildContextHealth({
      usage,
      hasExplicitContextWindow: false,
    });

    expect(health).toMatchObject({
      usedTokens: 55849,
      windowSize: 200000,
      leftTokens: 144151,
      leftPct: 72,
      source: 'approx',
      state: 'healthy',
    });
  });
});
