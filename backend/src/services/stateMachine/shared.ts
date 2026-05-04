import { v4 as uuid } from 'uuid';

import { roomsRepo, messagesRepo, auditRepo } from '../../db/index.js';
import { debug } from '../../lib/logger.js';
import { store } from '../../store.js';
import type { DiscussionRoom, Message } from '../../types.js';
import { emitAgentStatus, emitUserMessage } from '../socketEmitter.js';

export function telemetry(event: string, meta: Record<string, unknown>) {
  auditRepo.log(event, undefined, undefined, meta);
  debug(event, meta);
}

export function addMessage(
  roomId: string,
  msg: Omit<Message, 'id' | 'timestamp'>,
): Message | undefined {
  const room = store.get(roomId);
  if (!room) return undefined;

  const message: Message = { ...msg, id: uuid(), timestamp: Date.now() };
  store.update(roomId, { messages: [...room.messages, message] });
  messagesRepo.insert(roomId, message);
  // Sync updatedAt to DB so roomsRepo.list() reflects recent activity order
  roomsRepo.update(roomId, {});
  // Emit socket event so frontend inserts user message immediately (no waiting for poll)
  emitUserMessage(roomId, message);
  return message;
}

export function addUserMessage(
  roomId: string,
  content: string,
  toAgentId?: string,
): Message | undefined {
  return addMessage(roomId, {
    agentRole: 'USER',
    agentName: '你',
    content,
    type: 'user_action',
    toAgentId,
  });
}

export function addSystemMessage(roomId: string, content: string): Message | undefined {
  return addMessage(roomId, {
    agentRole: 'WORKER',
    agentName: '系统',
    content,
    type: 'system',
  });
}

export function appendMessageContent(roomId: string, messageId: string, extra: string) {
  const room = store.get(roomId);
  if (!room) return;

  const updatedMessages = room.messages.map(m =>
    m.id === messageId ? { ...m, content: m.content + extra } : m,
  );
  store.update(roomId, { messages: updatedMessages });

  const msg = room.messages.find(m => m.id === messageId);
  if (msg) {
    messagesRepo.updateContent(messageId, msg.content + extra);
  }
  // Note: do NOT sync updatedAt here — each token delta would cause DB write amplification.
  // updatedAt is synced when a new message is added (addMessage), which is sufficient
  // for "recent activity" ordering since the list only reorders on new message arrival.
}

export function buildTranscriptForAgentInvocation(
  room: NonNullable<ReturnType<typeof store.get>>,
  agentName: string,
): string | undefined {
  const hasJoinSystemMessage = room.messages.some(
    m => m.type === 'system' && m.agentName === agentName && m.content === `${agentName} 加入了讨论`,
  );
  const hasAgentSpokenBefore = room.messages.some(
    m => m.agentName === agentName && m.type !== 'system',
  );

  const transcriptMessages = hasJoinSystemMessage && !hasAgentSpokenBefore
    ? room.messages
    : room.messages.slice(-10);

  if (transcriptMessages.length === 0) return undefined;

  return transcriptMessages
    .map(m => `【${m.agentName}】${m.content}`)
    .join('\n\n');
}

export function updateAgentStatus(
  roomId: string,
  agentId: string,
  status: 'idle' | 'thinking' | 'waiting' | 'done',
) {
  const room = store.get(roomId);
  if (!room) return;

  store.update(roomId, {
    agents: room.agents.map(a => (a.id === agentId ? { ...a, status } : a)),
  });
  emitAgentStatus(roomId, agentId, status);
}

const REPORT_SECTION_MAX_CHARS = 2400;

function truncateSection(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= REPORT_SECTION_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, REPORT_SECTION_MAX_CHARS).trim()}\n\n...`;
}

function latestRunMessages(room: DiscussionRoom): Message[] {
  const lastUserIndex = room.messages
    .map((message, index) => ({ message, index }))
    .filter(item => item.message.agentRole === 'USER')
    .at(-1)?.index;

  const start = typeof lastUserIndex === 'number' ? lastUserIndex : 0;
  return room.messages.slice(start).filter(message => message.content.trim());
}

function buildOpenRisks(workerMessages: Message[]): string {
  const riskLines = workerMessages
    .flatMap(message => message.content.split(/\r?\n+/))
    .map(line => line.trim())
    .filter(line => /risk|risks|风险|待确认|open questions?|unsupported|不确定/i.test(line))
    .slice(0, 6);

  if (riskLines.length === 0) {
    return '- 未自动识别出单独风险项；以各 Agent 的最终消息为准。';
  }

  return riskLines.map(line => `- ${line.replace(/^[-*]\s*/, '')}`).join('\n');
}

function buildCompletionReport(room: DiscussionRoom): string {
  const runMessages = latestRunMessages(room);
  const workerMessages = runMessages.filter(message => message.agentRole === 'WORKER' && message.type !== 'system');
  const firstWorker = workerMessages[0];
  const lastWorker = workerMessages.at(-1);
  const middleWorkers = workerMessages.length > 2
    ? workerMessages.slice(1, -1)
    : workerMessages.length === 2
      ? [workerMessages[1]]
      : [];

  const planContent = firstWorker
    ? `来自 ${firstWorker.agentName}：\n\n${truncateSection(firstWorker.content)}`
    : '未产出单独计划。';

  const copyPackageContent = middleWorkers.length > 0
    ? middleWorkers
        .map(message => `来自 ${message.agentName}：\n\n${truncateSection(message.content)}`)
        .join('\n\n')
    : firstWorker
      ? `来自 ${firstWorker.agentName}：\n\n${truncateSection(firstWorker.content)}`
      : '未产出单独交付内容。';

  const reviewNotesContent = lastWorker && lastWorker.id !== firstWorker?.id
    ? `来自 ${lastWorker.agentName}：\n\n${truncateSection(lastWorker.content)}`
    : '未产出单独审查意见。';

  return [
    `# ${room.topic}`,
    '',
    '本轮任务完成，下面是自动整理的最终交付索引。',
    '',
    '## Plan',
    planContent,
    '',
    '## Copy Package',
    copyPackageContent,
    '',
    '## Review Notes',
    reviewNotesContent,
    '',
    '## Open Risks',
    buildOpenRisks(workerMessages),
  ].join('\n');
}

export function completeRoomRun(roomId: string): DiscussionRoom | undefined {
  const room = store.get(roomId);
  if (!room || room.state === 'DONE') return room;

  const busyAgent = room.agents.some(agent => agent.status === 'thinking' || agent.status === 'waiting');
  if (busyAgent) return room;

  const report = buildCompletionReport(room);
  addMessage(roomId, {
    agentRole: 'WORKER',
    agentName: '系统',
    content: report,
    type: 'summary',
  });

  const nextRoom = store.get(roomId);
  if (!nextRoom) return undefined;

  const completed = store.update(roomId, {
    state: 'DONE',
    report,
    agents: nextRoom.agents.map(agent => ({ ...agent, status: 'done' as const })),
  });
  roomsRepo.update(roomId, {
    state: 'DONE',
    report,
    agents: completed?.agents ?? nextRoom.agents,
  });
  for (const agent of completed?.agents ?? []) {
    emitAgentStatus(roomId, agent.id, agent.status);
  }
  return completed;
}
