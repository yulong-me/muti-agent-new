import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { roomsRouter } from './routes/rooms.js';
import { agentsRouter } from './routes/agents.js';
import providersRouter from './routes/providers.js';
import { logsRouter } from './routes/logs.js';
import { browseRouter } from './routes/browse.js';
import { gitRouter } from './routes/git.js';
import { scenesRouter } from './routes/scenes.js';
import { store } from './store.js';
import { log } from './log.js';
import { initDB, roomsRepo } from './db/index.js';

initDB();

// 启动时从 DB 恢复所有 rooms 到内存 store，确保重启后对话列表不丢失
const persistedRooms = roomsRepo.list();
for (const room of persistedRooms) {
  store.create(room);
}
log('INFO', 'store:loaded_from_db', { roomCount: persistedRooms.length });

const app = express();
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());

// ── Request logging middleware ──────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  const reqId = Math.random().toString(36).slice(2, 9);
  (req as any).reqId = reqId;
  log('INFO', '→ request', { reqId, method: req.method, path: req.path });
  res.on('finish', () => {
    const dur = Date.now() - start;
    log('INFO', '← response', { reqId, method: req.method, path: req.path, status: res.statusCode, duration_ms: dur });
  });
  next();
});

app.use('/api/rooms', roomsRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/providers', providersRouter);
app.use('/api/logs', logsRouter);
app.use('/api/browse', browseRouter);
app.use('/api/git', gitRouter);
app.use('/api/scenes', scenesRouter);

// ── Debug endpoint ──────────────────────────────────────────────────────────
app.get('/api/debug', (_req, res) => {
  const rooms = store.list();
  const summary = rooms.map(r => ({
    id: r.id,
    topic: r.topic,
    state: r.state,
    agentCount: r.agents.length,
    messageCount: r.messages.length,
    agents: r.agents.map(a => ({ role: a.role, name: a.name, domainLabel: a.domainLabel, status: a.status })),
    lastMessage: r.messages[r.messages.length - 1]
      ? { agentName: r.messages[r.messages.length - 1].agentName, type: r.messages[r.messages.length - 1].type, timestamp: r.messages[r.messages.length - 1].timestamp }
      : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
  res.json({ timestamp: new Date().toISOString(), roomCount: rooms.length, rooms: summary });
});

// ── Health endpoint ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Socket.IO ───────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  log('INFO', 'socket:connect', { socketId: socket.id });
  socket.on('join-room', (roomId: string) => {
    socket.join(roomId);
    log('INFO', 'socket:join', { socketId: socket.id, roomId });
  });
  socket.on('leave-room', (roomId: string) => {
    socket.leave(roomId);
    log('INFO', 'socket:leave', { socketId: socket.id, roomId });
  });
  socket.on('disconnect', () => {
    log('INFO', 'socket:disconnect', { socketId: socket.id });
  });
});

// Initialize the socket emitter for use by stateMachine/routes
import { initSocketEmitter } from './services/socketEmitter.js';
initSocketEmitter(io);

const BACKEND_PORT = parseInt(process.env.PORT || '7001', 10);
httpServer.listen(BACKEND_PORT, () => {
  log('INFO', `Backend running on http://localhost:${BACKEND_PORT}`);
});
