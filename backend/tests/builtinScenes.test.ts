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
  it('roundtable-forum scene enforces crossfire instead of disconnected monologues', () => {
    const scene = BUILTIN_SCENES.find(s => s.id === 'roundtable-forum');

    expect(scene?.prompt).toContain('圆桌推进协议');
    expect(scene?.prompt).toContain('优先回应上一位');
    expect(scene?.prompt).toContain('反驳链');
    expect(scene?.prompt).toContain('最后一行单独成行，只写 @ 一位最关键的专家');
    expect(scene?.prompt).toContain('不要在正文开头用 @名字');
    expect(scene?.prompt).toContain('每轮控制在 2-4 段');
    expect(scene?.prompt).toContain('不要把所有人的话温和拼盘成“大家都对”');
    expect(scene?.prompt).toContain('显示名或括号内简称');
    expect(scene?.prompt).toContain('写完交棒行就结束输出');
    expect(scene?.prompt).toContain('@芒格 你怎么看？');
    expect(scene?.prompt).toContain('（张一鸣收）');
    expect(scene?.prompt).toContain('你刚才说得对，但我再补一句');
    expect(scene?.prompt).toContain('哪怕还想补一句，也必须删掉并挪到交棒行之前');
  });

  it('roundtable-forum scene stops handoff when user explicitly asks one expert to conclude', () => {
    const scene = BUILTIN_SCENES.find(s => s.id === 'roundtable-forum');

    expect(scene?.prompt).toContain('如果用户已经明确点名你来“裁决 / 总结 / 收束 / 给结论”');
    expect(scene?.prompt).toContain('这类收束回答默认不要再点名下一位');
    expect(scene?.prompt).toContain('用户已经要求“不要再扩散讨论”，你还继续点名下一位把讨论传下去');
  });

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
