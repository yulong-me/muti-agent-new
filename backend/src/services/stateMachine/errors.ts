import { v4 as uuid } from 'uuid';

import { auditRepo, messagesRepo } from '../../db/index.js';
import { error, info } from '../../lib/logger.js';
import { store } from '../../store.js';
import type {
  AgentExecutionErrorCode,
  AgentRunError,
  Message,
  ToolCall,
} from '../../types.js';
import { emitRoomErrorEvent, emitStreamEnd } from '../socketEmitter.js';
import { updateAgentStatus } from './shared.js';

export interface AgentRequestMeta {
  originalUserContent?: string;
  toAgentId?: string;
  toAgentName?: string;
  triggerMessageId?: string;
  parentRunId?: string;
}

export function normalizeAgentExecutionError(err: unknown): {
  code: AgentExecutionErrorCode;
  timeoutPhase?: 'first_token' | 'idle';
  rawMessage: string;
  title: string;
  message: string;
  retryable: boolean;
} {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const taggedCode = (err as Error & { code?: string }).code;
  const timeoutPhase = (err as Error & { phase?: string }).phase;

  if (taggedCode === 'AGENT_TIMEOUT') {
    if (timeoutPhase === 'idle') {
      return {
        code: 'AGENT_TIMEOUT',
        timeoutPhase: 'idle',
        rawMessage,
        title: '连接中断',
        message: '专家已经开始回复，但中途失去了响应。当前已生成内容会被保留，你可以重试，或找回原提问后继续。',
        retryable: true,
      };
    }
    return {
      code: 'AGENT_TIMEOUT',
      timeoutPhase: 'first_token',
      rawMessage,
      title: '响应超时',
      message: '等待专家的响应超时了，可能他暂时卡住了。你可以重试，或把原问题找回后换个问法再试。',
      retryable: true,
    };
  }

  if (taggedCode === 'AGENT_PROCESS_EXIT') {
    return {
      code: 'AGENT_PROCESS_EXIT',
      rawMessage,
      title: '服务异常断开',
      message: '该专家服务刚刚开小差退出了，当前这轮回答没有完整结束。你可以稍后重试。',
      retryable: true,
    };
  }

  if (taggedCode === 'AGENT_PROVIDER_ERROR') {
    return {
      code: 'AGENT_PROVIDER_ERROR',
      rawMessage,
      title: '上游服务波动',
      message: '模型服务暂时不稳定，这一轮响应被中断了。稍等片刻再试通常就能恢复。',
      retryable: true,
    };
  }

  if (taggedCode === 'AGENT_STOPPED') {
    return {
      code: 'AGENT_STOPPED',
      rawMessage,
      title: '已停止回答',
      message: '已按你的要求停止这一轮回答，当前已生成的内容会被保留。',
      retryable: false,
    };
  }

  if (taggedCode === 'AGENT_PARSE_ERROR') {
    return {
      code: 'AGENT_PARSE_ERROR',
      rawMessage,
      title: '响应格式异常',
      message: '解析专家响应时遇到了格式混乱，这一轮没有完整结束。你可以找回原提问后换个问法再试。',
      retryable: true,
    };
  }

  return {
    code: 'AGENT_RUNTIME_ERROR',
    rawMessage,
    title: '执行时遇到问题',
    message: '专家构思时遇到了点小问题，这次回答没能顺利完成。原提问还可以找回后继续重试。',
    retryable: true,
  };
}

export function handleAgentRunFailure(args: {
  err: unknown;
  roomId: string;
  agentId: string;
  agentName: string;
  providerName: string;
  msg?: Message;
  msgId: string;
  streamStarted: boolean;
  accumulated: string;
  accumulatedThinking: string;
  accumulatedToolCalls: ToolCall[];
  requestMeta?: AgentRequestMeta;
}): AgentRunError {
  const traceId = uuid();
  const normalized = normalizeAgentExecutionError(args.err);
  const runError: AgentRunError = {
    traceId,
    messageId: args.msgId || undefined,
    agentId: args.agentId,
    agentName: args.agentName,
    code: normalized.code,
    timeoutPhase: normalized.timeoutPhase,
    title: normalized.title,
    message: normalized.message,
    retryable: normalized.retryable,
    originalUserContent: args.requestMeta?.originalUserContent,
    toAgentId: args.requestMeta?.toAgentId,
    toAgentName: args.requestMeta?.toAgentName,
  };

  if (normalized.code === 'AGENT_STOPPED') {
    info('stream.stopped', {
      traceId,
      roomId: args.roomId,
      agentId: args.agentId,
      agentName: args.agentName,
      provider: args.providerName,
      code: normalized.code,
    });
    auditRepo.log('agent:run_stopped', normalized.rawMessage, args.agentId, {
      traceId,
      roomId: args.roomId,
      agentName: args.agentName,
      provider: args.providerName,
      code: normalized.code,
      messageId: args.msgId || undefined,
    });
  } else {
    error('stream.error', {
      traceId,
      roomId: args.roomId,
      agentId: args.agentId,
      agentName: args.agentName,
      provider: args.providerName,
      code: normalized.code,
      error: normalized.rawMessage,
    });
    auditRepo.log('agent:run_failed', normalized.rawMessage, args.agentId, {
      traceId,
      roomId: args.roomId,
      agentName: args.agentName,
      provider: args.providerName,
      code: normalized.code,
      messageId: args.msgId || undefined,
    });
  }

  if (args.msg) {
    const room = store.get(args.roomId);
    if (room) {
      store.update(args.roomId, {
        messages: room.messages.map(m =>
          m.id === args.msg!.id
            ? {
                ...m,
                content: args.accumulated,
                thinking: args.accumulatedThinking,
                toolCalls: args.accumulatedToolCalls,
                duration_ms: 0,
                total_cost_usd: 0,
                input_tokens: 0,
                output_tokens: 0,
                runError,
              }
            : m,
        ),
      });
    }
    messagesRepo.updateContent(args.msg.id, args.accumulated, {
      thinking: args.accumulatedThinking,
      toolCalls: args.accumulatedToolCalls,
      duration_ms: 0,
      total_cost_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
      runError,
    });
  }

  if (args.streamStarted && args.msgId) {
    emitStreamEnd(args.roomId, args.agentId, args.msgId, {
      duration_ms: 0,
      total_cost_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
    });
    updateAgentStatus(args.roomId, args.agentId, 'idle');
  }

  emitRoomErrorEvent(args.roomId, runError);
  return runError;
}
