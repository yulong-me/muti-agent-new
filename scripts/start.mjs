#!/usr/bin/env node
/**
 * Production launcher.
 * Kills occupied gateway/backend/frontend ports first, then starts:
 *   - gateway:  http://localhost:7000
 *   - backend:  http://localhost:7001
 *   - frontend: http://localhost:7002
 */
import { execSync, spawn } from 'child_process';
import { platform } from 'os';

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '7000', 10);
const BE_PORT = 7001;
const FE_PORT = 7002;

const isWin = platform() === 'win32';
const shell = isWin ? true : false;
const npmCmd = isWin ? 'pnpm.cmd' : 'pnpm';

const colors = { backend: '\x1b[34m', frontend: '\x1b[32m', gateway: '\x1b[35m', reset: '\x1b[0m' };
let shuttingDown = false;

function prefix(name, color) {
  return (line) => process.stdout.write(`${color}[${name}]${colors.reset} ${line}\n`);
}

function listPidsOnPort(port) {
  try {
    if (isWin) {
      const out = execSync(`netstat -ano | findstr :${port}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return [...new Set(
        out.split('\n')
          .map(line => line.trim().split(/\s+/).at(-1))
          .filter(pid => pid && /^\d+$/.test(pid) && pid !== '0'),
      )];
    }

    const out = execSync(`lsof -ti:${port} -t 2>/dev/null || true`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      shell: true,
    });
    return out.trim().split('\n').filter(pid => pid && /^\d+$/.test(pid));
  } catch {
    return [];
  }
}

function killPort(port) {
  const pids = listPidsOnPort(port);
  if (pids.length === 0) return;

  console.log(`Port ${port} occupied by PID ${pids.join(', ')}; killing...`);
  try {
    if (isWin) {
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        } catch {
          // keep going; we'll verify below
        }
      }
      return;
    }

    execSync(
      `lsof -ti:${port} -t 2>/dev/null | xargs kill -TERM 2>/dev/null; sleep 1; lsof -ti:${port} -t 2>/dev/null | xargs kill -9 2>/dev/null || true`,
      { stdio: 'ignore', shell: true },
    );
  } catch {
    // Verification below decides whether this is fatal.
  }
}

async function ensurePortFreed(port, label) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    killPort(port);
    const remaining = listPidsOnPort(port);
    if (remaining.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const remaining = listPidsOnPort(port);
  throw new Error(`${label} port ${port} is still in use by PID ${remaining.join(', ')}`);
}

function ensurePortAvailable(port, label) {
  const remaining = listPidsOnPort(port);
  if (remaining.length > 0) {
    throw new Error(`${label} port ${port} is already in use by PID ${remaining.join(', ')}. Free it or override ${label === 'Gateway' ? 'GATEWAY_PORT' : 'PORT'}.`);
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (gateway && !gateway.killed) gateway.kill();
  if (be && !be.killed) be.kill();
  if (fe && !fe.killed) fe.kill();
  process.exit(code);
}

function startProc(name, cmd, args, cwd, color, extraEnv) {
  const proc = spawn(cmd, args, {
    cwd,
    shell,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
  });
  const write = prefix(name, color);
  proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(write));
  proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(write));
  proc.on('exit', code => {
    console.log(`${color}[${name}]${colors.reset} exited with code ${code}`);
    shutdown(code ?? 1);
  });
  return proc;
}

try {
  ensurePortAvailable(GATEWAY_PORT, 'Gateway');
  await ensurePortFreed(BE_PORT, 'Backend');
  await ensurePortFreed(FE_PORT, 'Frontend');
} catch (err) {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
}

const be = startProc('backend', npmCmd, ['start'], 'backend', colors.backend, { PORT: String(BE_PORT) });
const fe = startProc('frontend', npmCmd, ['start'], 'frontend', colors.frontend, { PORT: String(FE_PORT) });
const gateway = startProc('gateway', process.execPath, ['scripts/gateway.mjs'], '.', colors.gateway, {
  GATEWAY_PORT: String(GATEWAY_PORT),
  BACKEND_PORT: String(BE_PORT),
  FRONTEND_PORT: String(FE_PORT),
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
