import { describe, expect, it } from 'vitest';

import {
  buildSettingsTabPath,
  buildSettingsHref,
  resolveSettingsReturnPath,
  resolveSettingsTab,
} from '../../frontend/lib/settingsTabs.ts';

describe('settings tab helpers', () => {
  it('accepts only supported settings tabs', () => {
    expect(resolveSettingsTab('agent')).toBe('agent');
    expect(resolveSettingsTab('agents')).toBe('agent');
    expect(resolveSettingsTab('provider')).toBe('provider');
    expect(resolveSettingsTab('providers')).toBe('provider');
    expect(resolveSettingsTab('scene')).toBe('scene');
    expect(resolveSettingsTab('scenes')).toBe('scene');
    expect(resolveSettingsTab('unknown')).toBe('agent');
    expect(resolveSettingsTab(null)).toBe('agent');
  });

  it('allows only local return paths', () => {
    expect(resolveSettingsReturnPath('/room/abc')).toBe('/room/abc');
    expect(resolveSettingsReturnPath('/settings?tab=scene')).toBe('/settings?tab=scene');
    expect(resolveSettingsReturnPath('https://example.com')).toBe('/');
    expect(resolveSettingsReturnPath('//evil.example')).toBe('/');
    expect(resolveSettingsReturnPath('room/abc')).toBe('/');
  });

  it('builds a scene settings link that preserves the caller path', () => {
    expect(buildSettingsHref('scene', '/room/abc')).toBe('/settings?tab=scene&returnTo=%2Froom%2Fabc');
    expect(buildSettingsHref('scene', 'https://example.com')).toBe('/settings?tab=scene');
  });

  it('builds stable dedicated settings paths for tab routes', () => {
    expect(buildSettingsTabPath('agent')).toBe('/settings/agents');
    expect(buildSettingsTabPath('provider')).toBe('/settings/providers');
    expect(buildSettingsTabPath('scene')).toBe('/settings/scenes');
  });
});
