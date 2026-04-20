import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import { BUILTIN_SCENES } from '../src/prompts/builtinScenes.js';
import {
  BUILTIN_AGENT_DEFINITIONS,
  ROUNDTABLE_AGENT_DEFINITIONS,
  SOFTWARE_DEVELOPMENT_AGENT_DEFINITIONS,
  buildBuiltinProviderOptsForMigration,
} from '../src/prompts/builtinAgents.js';

describe('builtin scene prompts', () => {
  it('software-development scene carries development workflow guardrails', () => {
    const scene = BUILTIN_SCENES.find(s => s.id === 'software-development');

    expect(scene?.prompt).toContain('先理解需求');
    expect(scene?.prompt).toContain('实施计划');
    expect(scene?.prompt).toContain('TDD');
    expect(scene?.prompt).toContain('review');
    expect(scene?.prompt).toContain('测试');
  });

  it('fresh schema includes F017 A2A depth columns before builtin scene seed', () => {
    const schema = fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf-8');
    const db = new Database(':memory:');

    db.exec(schema);

    const sceneColumns = db.prepare('PRAGMA table_info(scenes)').all() as Array<{ name: string }>;
    const roomColumns = db.prepare('PRAGMA table_info(rooms)').all() as Array<{ name: string }>;
    const messageColumns = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>;

    expect(sceneColumns.map(c => c.name)).toContain('max_a2a_depth');
    expect(roomColumns.map(c => c.name)).toContain('max_a2a_depth');
    expect(messageColumns.map(c => c.name)).toContain('tool_calls_json');

    db.close();
  });

  it('ships related agents for roundtable and software-development scenes', () => {
    expect(ROUNDTABLE_AGENT_DEFINITIONS.length).toBeGreaterThanOrEqual(10);
    expect(ROUNDTABLE_AGENT_DEFINITIONS.every(agent => agent.tags.includes('圆桌论坛'))).toBe(true);
    expect(BUILTIN_AGENT_DEFINITIONS.every(agent => agent.provider === 'opencode')).toBe(true);

    const softwareAgentNames = SOFTWARE_DEVELOPMENT_AGENT_DEFINITIONS.map(agent => agent.name);
    expect(softwareAgentNames).toEqual(expect.arrayContaining([
      '需求分析师',
      '架构师',
      '实现工程师',
      'Reviewer',
      '测试工程师',
    ]));
    expect(SOFTWARE_DEVELOPMENT_AGENT_DEFINITIONS.every(agent => agent.tags.includes('软件开发'))).toBe(true);
  });

  it('migrates builtin provider opts to opencode-safe defaults while preserving thinking', () => {
    expect(buildBuiltinProviderOptsForMigration(
      { thinking: true },
      { thinking: false, model: 'claude-sonnet-4-6' },
    )).toEqual({ thinking: false });

    expect(buildBuiltinProviderOptsForMigration(
      { thinking: true },
      undefined,
    )).toEqual({ thinking: true });
  });
});
