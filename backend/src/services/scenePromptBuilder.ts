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
  /** Workspace path (shown as 【工作目录】) */
  workspace?: string;
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
  if (!room) return null;

  const scene = scenesRepo.get(room.sceneId);
  if (!scene) {
    throw new Error(`Scene not found: ${room.sceneId}`);
  }

  const parts: string[] = [];

  // 1. Scene Prompt
  parts.push(scene.prompt);

  // 2. Base prompt (Agent persona prompt or system action prompt)
  parts.push(basePrompt);

  // 3. Runtime Context
  parts.push(buildRuntimeContextString(runtime));

  return parts.join('\n\n');
}

function buildRuntimeContextString(runtime: RuntimeContext): string {
  const lines: string[] = ['【运行时上下文】'];

  if (runtime.workspace) {
    lines.push(`【工作目录】${runtime.workspace}`);
  }

  if (runtime.roomTopic) {
    lines.push(`【议题】${runtime.roomTopic}`);
  }

  if (runtime.userMessage) {
    lines.push(`【用户输入/任务】${runtime.userMessage}`);
  }

  if (runtime.taskText) {
    lines.push(`【A2A协作任务】${runtime.taskText}`);
  }

  if (runtime.toAgentName) {
    lines.push(`【接收人】${runtime.toAgentName}`);
  }

  if (runtime.a2aCallChain && runtime.a2aCallChain.length > 0) {
    lines.push(`【调用链】${runtime.a2aCallChain.join(' → ')}`);
  }

  if (runtime.recentTranscript) {
    lines.push(`【对话记录】\n${runtime.recentTranscript}`);
  }

  return lines.join('\n');
}