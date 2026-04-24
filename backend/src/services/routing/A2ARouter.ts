/**
 * A2A Router — Agent-to-Agent @mention 解析与深度控制
 *
 * 核心职责：
 * 1. 解析消息中的 @mention（行首检测）
 * 2. 追踪 A2A 深度，防止无限递归
 * 3. 计算房间 / 场景的有效最大深度
 */

import { store } from '../../store.js';
import { scenesRepo } from '../../db/index.js';
import type { Agent } from '../../types.js';

/**
 * 获取有效最大 A2A 深度
 * 优先级：room.maxA2ADepth > scene.maxA2ADepth > 5
 * 0 = 无限
 */
export function resolveEffectiveMaxDepth(roomMaxDepth: number | null, sceneId: string): number {
  if (roomMaxDepth !== null) return roomMaxDepth;
  const scene = scenesRepo.get(sceneId);
  return scene?.maxA2ADepth ?? 5;
}

/**
 * 获取某个 room 当前生效的最大 A2A 深度。
 * room 不存在时回退到默认值 5。
 */
export function getEffectiveMaxDepthForRoom(roomId: string): number {
  const room = store.get(roomId);
  if (!room) return 5;
  return resolveEffectiveMaxDepth(room.maxA2ADepth, room.sceneId);
}

/**
 * 解析消息中的 @mention（只匹配行首，排除 code block 内容）
 *
 * @example
 * scanForA2AMentions("好的，我来处理\n@opencode 请帮我 review", ["opencode"])
 * // => ['opencode']
 *
 * scanForA2AMentions("```\n@opencode 请帮我\n```\n@architect 继续", ["architect"])
 * // => ['architect'] （code block 内的被排除）
 *
 * 支持含空格的完整名字：
 * scanForA2AMentions("@Ilya Sutskever 怎么说", ["Ilya Sutskever"])
 * // => ['Ilya Sutskever']
 */
export function scanForA2AMentions(text: string, agentNames: string[] = []): string[] {
  return collectMentions(text, agentNames, true);
}

export function scanForInlineA2AMentions(text: string, agentNames: string[] = []): string[] {
  return collectMentions(text, agentNames, false);
}

export function detectSingleInlineMentionFallback(text: string, agentNames: string[] = []): string | null {
  const lineStartMentions = scanForA2AMentions(text, agentNames);
  if (lineStartMentions.length > 0) return null;

  const inlineMentions = scanForInlineA2AMentions(text, agentNames);
  return inlineMentions.length === 1 ? inlineMentions[0] ?? null : null;
}

export function detectRoundtableHandoff(
  text: string,
  agentNames: string[] = [],
): {
  mention: string;
  source: 'standalone_last_line' | 'inline_last_line_fallback' | 'standalone_with_trailing_text_fallback';
} | null {
  const withoutCodeBlocks = stripCodeBlocks(text);
  const nonEmptyLines = withoutCodeBlocks
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const lastLine = nonEmptyLines.at(-1);

  if (!lastLine) return null;

  const standaloneMentions = nonEmptyLines
    .map(line => matchStandaloneMentionLine(line, agentNames))
    .filter((mention): mention is string => Boolean(mention));

  if (standaloneMentions.length > 1) {
    return null;
  }

  const standalone = matchStandaloneMentionLine(lastLine, agentNames);
  if (standalone) {
    return { mention: standalone, source: 'standalone_last_line' };
  }

  const allMentions = scanForInlineA2AMentions(withoutCodeBlocks, agentNames);

  if (standaloneMentions.length === 1 && allMentions.length === 1 && standaloneMentions[0] === allMentions[0]) {
    return { mention: standaloneMentions[0], source: 'standalone_with_trailing_text_fallback' };
  }

  const lastLineMentions = scanForInlineA2AMentions(lastLine, agentNames);
  if (lastLineMentions.length === 1 && allMentions.length === 1 && lastLineMentions[0] === allMentions[0]) {
    return { mention: lastLineMentions[0]!, source: 'inline_last_line_fallback' };
  }

  return null;
}

function buildCanonicalMentionAliasMap(agents: Agent[]): Map<string, string> {
  const aliasMap = new Map<string, string>();
  for (const agent of agents) {
    for (const alias of [agent.name, agent.domainLabel, agent.configId].map(value => value.trim()).filter(Boolean)) {
      aliasMap.set(alias.toLocaleLowerCase(), agent.name);
    }
  }
  return aliasMap;
}

function buildMentionCandidates(agents: Agent[]): string[] {
  return Array.from(
    new Set(
      agents.flatMap(agent => [agent.name, agent.domainLabel, agent.configId].map(value => value.trim()).filter(Boolean)),
    ),
  );
}

export function computeEffectiveMessageMentions(
  text: string,
  sceneId: string,
  agents: Agent[],
): string[] {
  const aliasMap = buildCanonicalMentionAliasMap(agents);
  const mentionCandidates = buildMentionCandidates(agents);
  const normalize = (mention: string) => aliasMap.get(mention.toLocaleLowerCase()) ?? mention;

  if (sceneId === 'roundtable-forum') {
    const handoff = detectRoundtableHandoff(text, mentionCandidates);
    return handoff ? [normalize(handoff.mention)] : [];
  }

  const mentions = scanForA2AMentions(text, mentionCandidates).map(normalize);
  if (mentions.length > 0) {
    if (sceneId === 'software-development') {
      return mentions.slice(0, 1);
    }
    return mentions;
  }

  const inlineFallback = detectSingleInlineMentionFallback(text, mentionCandidates);
  if (inlineFallback) {
    return [normalize(inlineFallback)];
  }

  if (sceneId === 'software-development') {
    return [];
  }

  return [];
}

function collectMentions(text: string, agentNames: string[] = [], requireLineStart: boolean): string[] {
  const withoutCodeBlocks = stripCodeBlocks(text);

  const seen = new Set<string>();
  const names: string[] = [];

  if (agentNames.length === 0) {
    for (let i = 0; i < withoutCodeBlocks.length; i++) {
      if (withoutCodeBlocks[i] !== '@') continue;

      if (requireLineStart) {
        const lineStart = withoutCodeBlocks.lastIndexOf('\n', i - 1) + 1;
        const before = withoutCodeBlocks.slice(lineStart, i);
        if (!/^[ \t]*$/.test(before)) continue;
      }

      const match = /^([^\s@()[\]{}<>，。！？；：,.;!?]+)/u.exec(withoutCodeBlocks.slice(i + 1));
      const matchedName = match?.[1]?.trim();
      if (!matchedName || seen.has(matchedName)) continue;
      seen.add(matchedName);
      names.push(matchedName);
      i += matchedName.length;
    }
    return names;
  }

  // Build patterns per agent name — handles spaces, middle-dots, and partial matches
  // Sort longest-first so "@Ilya Sutskever" is matched before "@Ilya"
  const matchers: Array<{ name: string; pattern: RegExp }> = agentNames
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(name => ({ name, pattern: buildAgentMentionPattern(name) }));

  for (let i = 0; i < withoutCodeBlocks.length; i++) {
    if (withoutCodeBlocks[i] !== '@') continue;

    if (requireLineStart) {
      const lineStart = withoutCodeBlocks.lastIndexOf('\n', i - 1) + 1;
      const before = withoutCodeBlocks.slice(lineStart, i);
      if (!/^[ \t]*$/.test(before)) continue;
    }

    const rest = withoutCodeBlocks.slice(i + 1);
    let matchedName: string | null = null;
    let consumed = 0;

    for (const { name, pattern } of matchers) {
      const result = pattern.exec(rest);
      if (!result) continue;
      const tailIdx = result[0].length;
      const nextChar = rest[tailIdx];
      // Tail boundary: next char must be whitespace, punctuation, or end-of-string
      if (nextChar !== undefined && !/[\s)\]】}>,.!?;:，。！？；：]/.test(nextChar)) continue;
      matchedName = name;
      consumed = result[0].length;
      break;
    }

    if (!matchedName) continue;
    if (!seen.has(matchedName)) {
      seen.add(matchedName);
      names.push(matchedName);
    }
    i += consumed;
  }

  return names;
}

function stripCodeBlocks(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '');
}

const MIDDLE_DOT_PATTERN = /[·・•‧⋅･.．]/;

function buildAgentMentionPattern(agentName: string): RegExp {
  let pattern = '^';
  for (const char of agentName.trim()) {
    if (/\s/.test(char)) {
      pattern += '\\s+';
      continue;
    }
    if (MIDDLE_DOT_PATTERN.test(char)) {
      pattern += '[·・•‧⋅･.．\\s]*';
      continue;
    }
    pattern += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(pattern, 'iu');
}

function matchStandaloneMentionLine(line: string, agentNames: string[]): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('@')) return null;

  if (agentNames.length === 0) {
    const match = /^@([^\s@()[\]{}<>，。！？；：,.;!?]+)\s*$/u.exec(trimmed);
    return match?.[1]?.trim() ?? null;
  }

  const rest = trimmed.slice(1);
  const matchers: Array<{ name: string; pattern: RegExp }> = agentNames
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(name => ({ name, pattern: buildAgentMentionPattern(name) }));

  for (const { name, pattern } of matchers) {
    const result = pattern.exec(rest);
    if (!result) continue;
    if (rest.slice(result[0].length).trim() !== '') continue;
    return name;
  }

  return null;
}

/**
 * 更新 Room 的 A2A 追踪状态
 */
export function updateA2AContext(roomId: string, depth: number, callChain: string[]): void {
  const room = store.get(roomId);
  if (!room) return;

  store.update(roomId, {
    a2aDepth: depth,
    a2aCallChain: callChain,
  });
}

/**
 * Reset room-level A2A tracking when a human manually restarts the thread.
 * This lets the next manual turn consume the full depth budget again.
 */
export function resetA2AContext(roomId: string): void {
  const room = store.get(roomId);
  if (!room) return;

  store.update(roomId, {
    a2aDepth: 0,
    a2aCallChain: [],
  });
}
