/**
 * F016: Scene Prompt Builder
 *
 * Assembles the effective system prompt for every agent execution:
 *   Scene Prompt + basePrompt (Agent/Action) + Runtime Context
 *
 * All execution paths MUST go through this builder so that Scene constraints
 * are always applied, even to hardcoded action prompts like generateReportInline.
 */

import { store } from '../store.js';
import { scenesRepo } from '../db/index.js';
import { getEffectiveMaxDepthForRoom } from './routing/A2ARouter.js';
import { debug, warn } from '../lib/logger.js';

export interface RuntimeContext {
  /** Current user input / task text */
  userMessage: string;
  /** A2A task text (separate from userMessage for A2A orchestration) */
  taskText?: string;
  /** Recent conversation transcript (last N messages) */
  recentTranscript?: string;
  /** Target agent name for A2A routing context */
  toAgentName?: string;
  /** A2A call chain */
  a2aCallChain?: string[];
  /** Room topic */
  roomTopic?: string;
  /** Current A2A depth */
  a2aDepth?: number;
  /** Effective max A2A depth, 0 = unlimited */
  a2aMaxDepth?: number;
  /** Current room participants shown to the recipient for collaboration routing */
  participants?: Array<{
    name: string;
    domainLabel: string;
    role?: string;
  }>;
  /** Workspace path (shown as 【工作目录】) */
  workspace?: string;
  /** Human-readable effective skill summary; provider-native discovery remains primary path */
  skillsSummary?: string;
}

/**
 * Build the room-scoped system prompt.
 * Returns null if the room or its scene is not found.
 */
export function buildRoomScopedSystemPrompt(
  roomId: string,
  basePrompt: string,
  runtime: RuntimeContext,
): string | null {
  const room = store.get(roomId);
  if (!room) {
    warn('scene:prompt:room_missing', { roomId });
    return null;
  }

  const scene = scenesRepo.get(room.sceneId);
  if (!scene) {
    warn('scene:prompt:scene_missing', { roomId, sceneId: room.sceneId });
    throw new Error(`Scene not found: ${room.sceneId}`);
  }

  const parts: string[] = [];

  // 1. Scene Prompt
  parts.push(scene.prompt);

  // 2. Base prompt (Agent persona prompt or system action prompt)
  parts.push(basePrompt);

  // 3. Runtime Context
  const roomRuntime: RuntimeContext = {
    ...runtime,
    roomTopic: runtime.roomTopic ?? room.topic,
    a2aDepth: runtime.a2aDepth ?? room.a2aDepth ?? 0,
    a2aMaxDepth: runtime.a2aMaxDepth ?? getEffectiveMaxDepthForRoom(roomId),
    participants: runtime.participants ?? room.agents.map(a => ({
      name: a.name,
      domainLabel: a.domainLabel,
      role: a.role,
    })),
  };
  parts.push(buildRuntimeContextString(roomRuntime));

  const prompt = parts.join('\n\n');
  debug('scene:prompt:built', {
    roomId,
    sceneId: scene.id,
    basePromptLength: basePrompt.length,
    promptLength: prompt.length,
    participantCount: roomRuntime.participants?.length ?? 0,
    hasWorkspace: Boolean(roomRuntime.workspace),
    hasSkillsSummary: Boolean(roomRuntime.skillsSummary),
  });

  return prompt;
}

function buildRuntimeContextString(runtime: RuntimeContext): string {
  const lines: string[] = ['【运行时上下文】'];

  if (runtime.workspace) {
    lines.push(`【工作目录】${runtime.workspace}`);
  }

  if (runtime.skillsSummary) {
    lines.push(`【生效 Skills】\n${runtime.skillsSummary}`);
  }

  if (runtime.roomTopic) {
    lines.push(`【议题】${runtime.roomTopic}`);
  }

  if (runtime.a2aMaxDepth !== undefined) {
    const currentDepth = runtime.a2aDepth ?? 0;
    const maxDepthLabel = runtime.a2aMaxDepth === 0 ? '∞' : `${runtime.a2aMaxDepth} 层`;
    lines.push(`【A2A 协作深度】当前 ${currentDepth} 层 / 最大 ${maxDepthLabel}`);
  }

  if (runtime.toAgentName) {
    lines.push(`【当前接收人】${runtime.toAgentName}`);
  }

  if (runtime.participants && runtime.participants.length > 0) {
    lines.push('【参与专家】');
    for (const participant of runtime.participants) {
      lines.push(`- ${participant.name}（${participant.domainLabel}）`);
    }
    lines.push('需要协作时，另起一行行首 @专家名；只是引用观点时用【专家名】。');
  }

  if (runtime.userMessage) {
    lines.push(`【用户输入/任务】${runtime.userMessage}`);
  }

  if (runtime.taskText) {
    lines.push(`【A2A协作任务】${runtime.taskText}`);
  }

  if (runtime.a2aCallChain && runtime.a2aCallChain.length > 0) {
    lines.push(`【调用链】${runtime.a2aCallChain.join(' → ')}`);
  }

  if (runtime.recentTranscript) {
    lines.push(`【对话记录】\n${runtime.recentTranscript}`);
  }

  return lines.join('\n');
}
