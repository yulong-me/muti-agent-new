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
import { shouldRunBuiltinAgentCatalogV5Migrations } from '../src/db/builtinAgentCatalog.js';

function extractQuickStartAgentIds(): string[] {
  const source = fs.readFileSync(
    new URL('../../frontend/components/room-view/EmptyRoomQuickStart.tsx', import.meta.url),
    'utf-8',
  );

  return Array.from(source.matchAll(/agentIds:\s*\[([\s\S]*?)\]/g))
    .flatMap(match => Array.from(match[1].matchAll(/'([^']+)'/g)).map(idMatch => idMatch[1]));
}

describe('builtin scene prompts', () => {
  it('ships the quick-start scene catalog used by the empty home screen', () => {
    expect(BUILTIN_SCENES.map(scene => scene.id)).toEqual([
      'roundtable-forum',
      'software-development',
      'litigation-strategy',
      'competitor-analysis',
      'paper-revision',
    ]);

    const sceneNames = BUILTIN_SCENES.map(scene => scene.name);
    expect(sceneNames).toContain('诉讼策略');
    expect(sceneNames).toContain('竞品分析');
    expect(sceneNames).toContain('论文返修');
  });

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
    expect(scene?.prompt).toContain('主架构师 → 挑战架构师 → 实现工程师 → Reviewer');
    expect(scene?.prompt).toContain('架构结论：通过');
    expect(scene?.prompt).toContain('待用户确认');
    expect(scene?.prompt).toContain('每次最多 @ 1 位专家');
    expect(scene?.prompt).toContain('最后另起一行行首写 @对方');
    expect(scene?.prompt).not.toContain('句末加 @对方');
    expect(scene?.prompt).toContain('实施计划');
    expect(scene?.prompt).toContain('TDD');
    expect(scene?.prompt).toContain('review');
    expect(scene?.prompt).toContain('测试');
  });

  it('quick-start scenes carry domain-specific operating rules', () => {
    const litigation = BUILTIN_SCENES.find(s => s.id === 'litigation-strategy');
    const competitor = BUILTIN_SCENES.find(s => s.id === 'competitor-analysis');
    const paperRevision = BUILTIN_SCENES.find(s => s.id === 'paper-revision');

    expect(litigation?.prompt).toContain('不构成法律意见');
    expect(litigation?.prompt).toContain('事实、证据、法律问题');
    expect(litigation?.prompt).toContain('对方律师会怎么打');

    expect(competitor?.prompt).toContain('不要编造');
    expect(competitor?.prompt).toContain('未知项');
    expect(competitor?.prompt).toContain('定位');

    expect(paperRevision?.prompt).toContain('逐条回复审稿人');
    expect(paperRevision?.prompt).toContain('同意 / 部分同意 / 不同意');
    expect(paperRevision?.prompt).toContain('rebuttal');
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
    expect(softwareAgentNames).toEqual(['主架构师', '挑战架构师', '实现工程师', 'Reviewer']);
    expect(SOFTWARE_DEVELOPMENT_AGENT_DEFINITIONS.every(agent => agent.tags.includes('软件开发'))).toBe(true);
  });

  it('gives every builtin quick-start scene a dedicated agent team', () => {
    for (const scene of BUILTIN_SCENES) {
      const sceneAgents = BUILTIN_AGENT_DEFINITIONS.filter(agent => agent.tags.includes(scene.name));

      expect(
        sceneAgents.length,
        `${scene.name} should have at least four dedicated builtin agents`,
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it('quick-start templates only reference seeded builtin agents', () => {
    const builtinAgentIds = new Set(BUILTIN_AGENT_DEFINITIONS.map(agent => agent.id));
    const quickStartAgentIds = extractQuickStartAgentIds();

    expect(quickStartAgentIds.length).toBeGreaterThan(0);
    expect(quickStartAgentIds.filter(agentId => !builtinAgentIds.has(agentId))).toEqual([]);
  });

  it('does not rerun provider migration when applying the v6 builtin agent catalog', () => {
    expect(shouldRunBuiltinAgentCatalogV5Migrations(0)).toBe(true);
    expect(shouldRunBuiltinAgentCatalogV5Migrations(4)).toBe(true);
    expect(shouldRunBuiltinAgentCatalogV5Migrations(5)).toBe(false);
    expect(shouldRunBuiltinAgentCatalogV5Migrations(6)).toBe(false);
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
