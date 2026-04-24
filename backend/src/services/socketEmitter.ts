/**
 * Central Socket.IO event emitter.
 * Imported by stateMachine to emit streaming events to frontend.
 * Must be initialized by server.ts at startup.
 */
import type { Server as SocketIOServer } from 'socket.io';
import type { AgentRunError, ContextHealth, InvocationUsage } from '../types.js';
import { debug, error, info } from '../lib/logger.js';

let _io: SocketIOServer | null = null;

export function initSocketEmitter(io: SocketIOServer) {
  _io = io;
  info('socket:emitter:init');
}

function getIO() {
  if (!_io) {
    error('socket:emitter:uninitialized');
    throw new Error('Socket emitter not initialized — call initSocketEmitter first');
  }
  return _io;
}

/** Emit a streaming delta to all clients in a room */
export function emitStreamDelta(roomId: string, agentId: string, text: string) {
  getIO().to(roomId).emit('stream_delta', { roomId, agentId, text });
}

/** Emit streaming start — frontend creates a placeholder message */
export function emitStreamStart(roomId: string, agentId: string, agentConfigId: string, agentName: string, timestamp: number, id: string, agentRole: string) {
  debug('socket:emit:stream_start', { roomId, agentId, agentConfigId, agentName, messageId: id, agentRole });
  getIO().to(roomId).emit('stream_start', { roomId, agentId, agentConfigId, agentName, timestamp, id, agentRole });
}

/** Emit streaming end — frontend finalizes the message with timing/stats */
export function emitStreamEnd(
  roomId: string,
  agentId: string,
  id: string,
  stats: {
    duration_ms: number;
    total_cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    agentConfigId?: string;
    sessionId?: string;
    invocationUsage?: InvocationUsage;
    contextHealth?: ContextHealth;
  },
) {
  debug('socket:emit:stream_end', { roomId, agentId, messageId: id, duration_ms: stats.duration_ms, output_tokens: stats.output_tokens });
  getIO().to(roomId).emit('stream_end', { roomId, agentId, id, ...stats });
}

/** Emit thinking delta to clients in a room */
export function emitThinkingDelta(roomId: string, agentId: string, thinking: string) {
  getIO().to(roomId).emit('thinking_delta', { roomId, agentId, thinking });
}

/** Emit tool use event to clients in a room */
export function emitToolUse(roomId: string, agentId: string, toolName: string, toolInput: Record<string, unknown>, callId?: string, timestamp?: number) {
  getIO().to(roomId).emit('tool_use', { roomId, agentId, toolName, toolInput, callId, timestamp });
}

/** Emit agent status change */
export function emitAgentStatus(roomId: string, agentId: string, status: string) {
  debug('socket:emit:agent_status', { roomId, agentId, status });
  getIO().to(roomId).emit('agent_status', { roomId, agentId, status });
}

/** Emit structured room error event for agent execution failures */
export function emitRoomErrorEvent(
  roomId: string,
  error: AgentRunError,
) {
  debug('socket:emit:room_error', { roomId, agentId: error.agentId, code: error.code, retryable: error.retryable });
  getIO().to(roomId).emit('room_error_event', { roomId, error });
}

/** Emit user message insertion — frontend inserts immediately without waiting for poll */
export function emitUserMessage(roomId: string, message: { id: string; agentRole: string; agentName: string; content: string; timestamp: number; type: string }) {
  debug('socket:emit:user_message', { roomId, messageId: message.id, agentName: message.agentName, type: message.type });
  getIO().to(roomId).emit('user_message', { roomId, message });
}

// F007: Emit agent joined — new agent added to room, with system message
export function emitRoomAgentJoined(
  roomId: string,
  agent: { id: string; role: string; name: string; domainLabel: string; configId: string; status: string },
  systemMessage: { id: string; agentRole: string; agentName: string; content: string; timestamp: number; type: string },
  agents: { id: string; role: string; name: string; domainLabel: string; configId: string; status: string }[],
) {
  info('socket:emit:room_agent_joined', { roomId, agentId: agent.id, agentName: agent.name, totalAgents: agents.length });
  getIO().to(roomId).emit('room:agent-joined', { roomId, agent, systemMessage, agents });
}
