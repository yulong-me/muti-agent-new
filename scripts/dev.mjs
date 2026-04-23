#!/usr/bin/env node
/**
 * Cross-platform dev launcher.
 * Kills ports BE_PORT/FE_PORT, starts backend and frontend concurrently.
 * Default dev mode stays split:
 *   - backend:  http://localhost:7001
 *   - frontend: http://localhost:7002
 *
 * Works on macOS, Linux, and Windows.
 */
import { execSync, spawn } from 'child_process';
import { platform } from 'os';

const BE_PORT = 7001;
const FE_PORT = 7002;

const PORTS = [BE_PORT, FE_PORT];

function killPort(port) {
  try {
    if (platform() === 'win32') {
      // netstat + taskkill
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const pids = [...new Set(
        out.split('\n')
          .map(l => l.trim().split(/\s+/).at(-1))
          .filter(p => p && /^\d+$/.test(p) && p !== '0')
      )];
      for (const pid of pids) {
        try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }); } catch {}
      }
    } else {
      // SIGTERM first (graceful), then SIGKILL (force). lsof is reliable on macOS/Linux.
      execSync(
        `lsof -ti:${port} -t 2>/dev/null | xargs kill -TERM 2>/dev/null; sleep 1; lsof -ti:${port} -t 2>/dev/null | xargs kill -9 2>/dev/null || true`,
        { stdio: 'ignore', shell: true }
      );
    }
  } catch {
    // port was not in use — fine
  }
}

function safeListPids(port) {
  try {
    const out = execSync(`lsof -ti:${port} -t 2>/dev/null || true`, { encoding: 'utf8' });
    const pids = out.trim().split('\n').filter(p => p && /^\d+$/.test(p));
    return pids;
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

for (const port of PORTS) {
  await ensurePortFreed(port);
  // Verify port is actually free
  const pids = safeListPids(port);
  if (pids.length > 0) {
    console.log(`⚠ Port ${port} still occupied by PID ${pids.join(', ')} — manual kill may be needed`);
  } else {
    console.log(`✓ Port ${port} freed`);
  }
}

const isWin = platform() === 'win32';
const shell = isWin ? true : false;
const npmCmd = isWin ? 'pnpm.cmd' : 'pnpm';

const colors = { backend: '\x1b[34m', frontend: '\x1b[32m', reset: '\x1b[0m' };

function prefix(name, color) {
  return (line) => process.stdout.write(`${color}[${name}]${colors.reset} ${line}\n`);
}

function startProc(name, cwd, color, extraEnv) {
  const proc = spawn(npmCmd, ['dev'], {
    cwd, shell, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv }
  });
  const write = prefix(name, color);
  proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(write));
  proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(write));
  proc.on('exit', code => {
    console.log(`${color}[${name}]${colors.reset} exited with code ${code}`);
    process.exit(code ?? 1);
  });
  return proc;
}

const be = startProc('backend',  'backend',  colors.backend);
const fe = startProc('frontend', 'frontend', colors.frontend);

process.on('SIGINT',  () => { be.kill(); fe.kill(); process.exit(0); });
process.on('SIGTERM', () => { be.kill(); fe.kill(); process.exit(0); });
