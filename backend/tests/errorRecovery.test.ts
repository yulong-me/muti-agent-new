import { describe, expect, it } from 'vitest';

import { rewriteMessageForDifferentAgent } from '../../frontend/lib/errorRecovery.ts';

describe('error recovery helpers', () => {
  it('rewrites the failed recipient mention to the new agent name', () => {
    expect(
      rewriteMessageForDifferentAgent(
        '@架构师 帮我看看这个方案',
        '架构师',
        'Reviewer',
      ),
    ).toBe('@Reviewer 帮我看看这个方案');
  });

  it('prepends a recipient mention when the original content does not mention the failed agent', () => {
    expect(
      rewriteMessageForDifferentAgent(
        '帮我看看这个方案',
        '架构师',
        'Reviewer',
      ),
    ).toBe('@Reviewer 帮我看看这个方案');
  });
});
