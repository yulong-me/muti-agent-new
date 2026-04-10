import express from 'express';
import cors from 'cors';
import { roomsRouter } from './routes/rooms.js';
import { store } from './store.js';

const app = express();
app.use(cors());
app.use(express.json());

// ── Request logging middleware ──────────────────────────────────────────────
function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[${ts}] [${level}] ${msg}${metaStr}`);
}

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

app.listen(7001, () => {
  log('INFO', 'Backend running on http://localhost:7001');
});

export { log };
