import { describe, expect, it } from 'vitest';

import {
  mergeAgentModel,
  normalizeModelValue,
  resolveEffectiveAgentModel,
} from '../../frontend/lib/agentModels.ts';

describe('agent model helpers', () => {
  it('prefers the agent override model over the provider default', () => {
    expect(resolveEffectiveAgentModel(
      'opencode',
      { model: ' google/gemini-2.5-pro ' },
      { opencode: { defaultModel: 'anthropic/claude-sonnet-4-6' } },
    )).toBe('google/gemini-2.5-pro');
  });

  it('falls back to the provider default model when the agent override is empty', () => {
    expect(resolveEffectiveAgentModel(
      'claude-code',
      { model: '   ' },
      { 'claude-code': { defaultModel: 'sonnet' } },
    )).toBe('sonnet');
  });

  it('removes the model override when the input is blank', () => {
    expect(mergeAgentModel({ model: 'sonnet', thinking: true }, '   ')).toEqual({ thinking: true });
  });

  it('normalizes whitespace-only values to null', () => {
    expect(normalizeModelValue('   ')).toBeNull();
    expect(normalizeModelValue(' opus ')).toBe('opus');
  });
});
