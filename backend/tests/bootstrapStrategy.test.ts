import { describe, expect, it } from 'vitest';
import { resolveBootstrapAction } from '../src/db/bootstrapStrategy.js';

describe('resolveBootstrapAction', () => {
  it('seeds all builtins for a fresh empty database', () => {
    expect(resolveBootstrapAction({
      metaPresent: false,
      agentsCount: 0,
      providersCount: 0,
      scenesCount: 0,
      roomsCount: 0,
    })).toBe('fresh_seed_all');
  });

  it('backfills builtin agents for legacy databases whose agents catalog is empty', () => {
    expect(resolveBootstrapAction({
      metaPresent: false,
      agentsCount: 0,
      providersCount: 2,
      scenesCount: 2,
      roomsCount: 46,
    })).toBe('legacy_backfill_agents');
  });

  it('keeps legacy databases with existing agents untouched', () => {
    expect(resolveBootstrapAction({
      metaPresent: false,
      agentsCount: 3,
      providersCount: 2,
      scenesCount: 2,
      roomsCount: 10,
    })).toBe('legacy_mark_only');
  });

  it('repairs partial bootstraps when marker exists but user-facing catalogs are empty', () => {
    expect(resolveBootstrapAction({
      metaPresent: true,
      agentsCount: 0,
      providersCount: 2,
      scenesCount: 0,
      roomsCount: 0,
    })).toBe('repair_partial');
  });

  it('skips reseeding once bootstrap marker exists and catalogs are present', () => {
    expect(resolveBootstrapAction({
      metaPresent: true,
      agentsCount: 21,
      providersCount: 2,
      scenesCount: 2,
      roomsCount: 49,
    })).toBe('skip');
  });
});
