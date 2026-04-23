#!/usr/bin/env node
/**
 * Optional dev launcher that simulates production routing:
 *   - gateway:  http://localhost:7000
 *   - backend:  http://localhost:7001
 *   - frontend: http://localhost:7002
 */
import { execSync, spawn } from 'child_process';
import { platform } from 'os';

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '7000', 10);
const BE_PORT = 7001;
const FE_PORT = 7002;

const PORTS = [BE_PORT, FE_PORT];

function killPort(port) {
  try {
    if (platform() === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const pids = [...new Set(
        out.split('\n')
          .map((line) => line.trim().split(/\s+/).at(-1))
          .filter((pid) => pid && /^\d+$/.test(pid) && pid !== '0'),
      )];
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        } catch {
          // ignore
        }
      }
    } else {
      execSync(
        `lsof -ti:${port} -t 2>/dev/null | xargs kill -TERM 2>/dev/null; sleep 1; lsof -ti:${port} -t 2>/dev/null | xargs kill -9 2>/dev/null || true`,
        { stdio: 'ignore', shell: true },
      );
    }
  } catch {
    // fine if already free
  }
}

function safeListPids(port) {
  try {
    const out = execSync(`lsof -ti:${port} -t 2>/dev/null || true`, { encoding: 'utf8' });
    return out.trim().split('\n').filter((pid) => pid && /^\d+$/.test(pid));
  } catch {
    return [];
  }
}

async function ensurePortFreed(port) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    killPort(port);
    const pids = safeListPids(port);
    if (pids.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function isPortAvailable(port) {
  return safeListPids(port).length === 0;
}

for (const port of PORTS) {
  await ensurePortFreed(port);
  const pids = safeListPids(port);
  if (pids.length > 0) {
    console.log(`⚠ Port ${port} still occupied by PID ${pids.join(', ')} — manual kill may be needed`);
  } else {
    console.log(`✓ Port ${port} freed`);
  }
}

if (!isPortAvailable(GATEWAY_PORT)) {
  const pids = safeListPids(GATEWAY_PORT);
  console.error(`Gateway port ${GATEWAY_PORT} is already in use by PID ${pids.join(', ')}. Choose another port via GATEWAY_PORT.`);
  process.exit(1);
}

const isWin = platform() === 'win32';
const shell = isWin ? true : false;
const npmCmd = isWin ? 'pnpm.cmd' : 'pnpm';

const colors = {
  backend: '\x1b[34m',
  frontend: '\x1b[32m',
  gateway: '\x1b[35m',
  reset: '\x1b[0m',
};

function prefix(name, color) {
  return (line) => process.stdout.write(`${color}[${name}]${colors.reset} ${line}\n`);
}

function startProc(name, cmd, args, cwd, color, extraEnv = {}) {
  const proc = spawn(cmd, args, {
    cwd,
    shell,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
  });
  const write = prefix(name, color);
  proc.stdout.on('data', (data) => data.toString().split('\n').filter(Boolean).forEach(write));
  proc.stderr.on('data', (data) => data.toString().split('\n').filter(Boolean).forEach(write));
  proc.on('exit', (code) => {
    console.log(`${color}[${name}]${colors.reset} exited with code ${code}`);
    process.exit(code ?? 1);
  });
  return proc;
}

const be = startProc('backend', npmCmd, ['dev'], 'backend', colors.backend);
const fe = startProc('frontend', npmCmd, ['dev'], 'frontend', colors.frontend);
const gateway = startProc('gateway', process.execPath, ['scripts/gateway.mjs'], '.', colors.gateway, {
  GATEWAY_PORT: String(GATEWAY_PORT),
  BACKEND_PORT: String(BE_PORT),
  FRONTEND_PORT: String(FE_PORT),
});

process.on('SIGINT', () => {
  be.kill();
  fe.kill();
  gateway.kill();
  process.exit(0);
});
process.on('SIGTERM', () => {
  be.kill();
  fe.kill();
  gateway.kill();
  process.exit(0);
});
