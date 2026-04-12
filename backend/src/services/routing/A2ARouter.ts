/**
 * A2A Router — Agent-to-Agent @mention 解析与路由
 *
 * 核心职责：
 * 1. 解析消息中的 @mention（行首检测）
 * 2. 追踪 A2A 深度，防止无限递归
 * 3. 达到深度上限时，协作链自动截断，等待用户指令
 */

import type { A2AContext, A2ARouteResult } from '../../types.js';
import { store } from '../../store.js';
import { getAgent } from '../../config/agentConfig.js';

// A2A 最大深度 — 达到后交回 Manager 决策
export const MAX_A2A_DEPTH = 4;

/**
 * 解析消息中的 @mention（只匹配行首，排除 code block 内容）
 *
 * @example
 * scanForA2AMentions("好的，我来处理\n@opencode 请帮我 review")
 * // => ['opencode']
 *
 * scanForA2AMentions("```\n@opencode 请帮我\n```\n@architect 继续")
 * // => ['architect'] （code block 内的被排除）
 */
export function scanForA2AMentions(text: string): string[] {
  // 排除 code block 内容（```...``` 或 `...` 包裹的内容）
  const withoutCodeBlocks = text
    // 匹配 ``` 开头的 code block
    .replace(/```[\s\S]*?```/g, '')
    // 匹配行内 `code` 片段
    .replace(/`[^`]+`/g, '');

  // 匹配行首的 @agentId（支持中文、英文、数字、连字符、下划线）
  const matches = withoutCodeBlocks.match(/^@([\w\u4e00-\u9fff-]+)/gm);
  if (!matches) return [];

  // 去重
  const unique = [...new Set(matches.map(m => m.slice(1)))];
  return unique;
}

/**
 * 验证 @mention 的目标 Agent 是否存在
 */
export function resolveAgent(targetId: string): { exists: boolean; agentName: string } {
  try {
    const agent = getAgent(targetId);
    if (agent) {
      return { exists: true, agentName: agent.name };
    }
  } catch {
    // ignore
  }
  return { exists: false, agentName: targetId };
}

/**
 * A2A 路由决策
 *
 * @param params A2A 上下文
 * @returns 路由结果：继续路由到 Agent，或交回 Manager
 */
export function a2aRoute(params: A2AContext): A2ARouteResult {
  if (params.depth >= MAX_A2A_DEPTH) {
    // 达到深度上限，交回 Manager
    return {
      type: 'manager_handoff',
      depth: params.depth,
      callChain: params.callChain,
      taskSummary: params.taskSummary,
    };
  }

  return {
    type: 'agent_route',
    depth: params.depth,
    callChain: params.callChain,
  };
}

/**
 * 从消息内容中解析 A2A mentions 并路由
 */
export function routeFromMessage(
  message: string,
  roomId: string,
  depth: number,
  callChain: string[]
): { routes: string[]; handoff: boolean } {
  const mentions = scanForA2AMentions(message);

  if (mentions.length === 0) {
    return { routes: [], handoff: false };
  }

  // 验证每个 mention 的目标是否存在
  const validRoutes = mentions
    .map(id => resolveAgent(id))
    .filter(r => r.exists)
    .map(r => r.agentName);

  if (validRoutes.length === 0) {
    return { routes: [], handoff: false };
  }

  // 检查是否达到深度上限
  if (depth >= MAX_A2A_DEPTH) {
    return { routes: validRoutes, handoff: true };
  }

  return { routes: validRoutes, handoff: false };
}

/**
 * 构建 Manager 兜底 prompt（当达到深度上限时）
 *
 * @deprecated F004: 此函数已弃用。达到深度上限时，现在直接截断协作链，
 * 不再调用 Manager 接管决策。
 */
export function buildManagerFallbackPrompt(
  _callChain: string[],
  _taskSummary: string
): string {
  return `【A2A 调用链已达上限】请等待用户下一步指令。`;
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
 * 重置 A2A 计数（Manager 决定继续时）
 */
export function resetA2ADepth(roomId: string): void {
  updateA2AContext(roomId, 0, []);
}
