/**
 * Central Socket.IO event emitter.
 * Imported by stateMachine to emit streaming events to frontend.
 * Must be initialized by server.ts at startup.
 */
import type { Server as SocketIOServer } from 'socket.io';

let _io: SocketIOServer | null = null;

export function initSocketEmitter(io: SocketIOServer) {
  _io = io;
}

function getIO() {
  if (!_io) throw new Error('Socket emitter not initialized — call initSocketEmitter first');
  return _io;
}

/** Emit a streaming delta to all clients in a room */
export function emitStreamDelta(roomId: string, agentId: string, text: string) {
  getIO().to(roomId).emit('stream_delta', { roomId, agentId, text });
}

/** Emit streaming start — frontend creates a placeholder message */
export function emitStreamStart(roomId: string, agentId: string, agentName: string, timestamp: number, tempMsgId: string) {
  getIO().to(roomId).emit('stream_start', { roomId, agentId, agentName, timestamp, tempMsgId });
}

/** Emit streaming end — frontend finalizes the message with timing/stats */
export function emitStreamEnd(
  roomId: string,
  agentId: string,
  tempMsgId: string,
  stats: { duration_ms: number; total_cost_usd: number; input_tokens: number; output_tokens: number },
) {
  getIO().to(roomId).emit('stream_end', { roomId, agentId, tempMsgId, ...stats });
}

/** Emit thinking delta to clients in a room */
export function emitThinkingDelta(roomId: string, agentId: string, thinking: string) {
  getIO().to(roomId).emit('thinking_delta', { roomId, agentId, thinking });
}

/** Emit agent status change */
export function emitAgentStatus(roomId: string, agentId: string, status: string) {
  getIO().to(roomId).emit('agent_status', { roomId, agentId, status });
}
