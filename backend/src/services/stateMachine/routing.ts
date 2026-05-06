import { debug, info, warn } from '../../lib/logger.js';
import { store } from '../../store.js';
import {
  hasActiveAgentRunInRoom,
  stopAgentRun as requestStopAgentRun,
} from '../agentRuns.js';
import { resetA2AContext, scanForA2AMentions } from '../routing/A2ARouter.js';
import { streamingCallAgent } from './execution.js';
import { addUserMessage, telemetry } from './shared.js';

export async function routeToAgent(
  roomId: string,
  content: string,
  toAgentId: string,
): Promise<void> {
  const room = store.get(roomId);
  if (!room || room.state === 'DONE') return;

  const contentSnippet = content.length > 80 ? `${content.slice(0, 80)}…` : content;
  const agentNames = room.agents.map(a => a.name);
  const mentions = scanForA2AMentions(content, agentNames);
  info('msg:recv', { roomId, contentLength: content.length, contentSnippet, mentions, toAgentId });

  const target = room.agents.find(a => a.id === toAgentId);
  if (!target) {
    warn('route.fallback', { roomId, toAgentId, reason: 'agent_not_found' });
    telemetry('route:agent_not_found', { roomId, toAgentId });
    return;
  }
  if (target.role !== 'WORKER') {
    warn('route.fallback', {
      roomId,
      toAgentId,
      toAgentName: target.name,
      toAgentRole: target.role,
      reason: 'not_worker',
    });
    addUserMessage(roomId, content, target.id);
    return;
  }

  debug('route.to', {
    roomId,
    toAgentId,
    toAgentName: target.name,
    toAgentRole: 'WORKER',
    path: 'routeToAgent',
  });

  if ((room.a2aDepth ?? 0) > 0 || (room.a2aCallChain?.length ?? 0) > 0) {
    debug('a2a:reset:user_trigger', {
      roomId,
      previousDepth: room.a2aDepth ?? 0,
      previousCallChain: room.a2aCallChain ?? [],
      toAgentName: target.name,
    });
    resetA2AContext(roomId);
  }

  const triggerMessage = addUserMessage(roomId, content, target.id);
  info('msg.user', {
    roomId,
    contentLength: content.length,
    toAgentId: target.id,
    toAgentName: target.name,
    toAgentRole: 'WORKER',
  });

  const workerOutput = await streamingCallAgent(
    {
      domainLabel: target.domainLabel,
      systemPrompt: `专业${target.domainLabel}，执行具体任务`,
      userMessage: `议题：${room.topic}\n\n用户（直接发送给你）：${content}`,
    },
    roomId,
    target.id,
    target.configId,
    target.name,
    'statement',
    'WORKER',
    {
      originalUserContent: content,
      toAgentId: target.id,
      toAgentName: target.name,
      triggerMessageId: triggerMessage?.id,
    },
  );

  telemetry('worker:direct:output', {
    roomId,
    workerName: target.name,
    outputLength: workerOutput.length,
  });
}

export function stopAgentRun(roomId: string, agentId: string) {
  return requestStopAgentRun(roomId, agentId);
}

export function isRoomBusy(roomId: string): boolean {
  const room = store.get(roomId);
  const hasBusyAgent = room
    ? room.agents.some(a => a.status === 'thinking' || a.status === 'waiting')
    : false;
  return hasBusyAgent || hasActiveAgentRunInRoom(roomId);
}
