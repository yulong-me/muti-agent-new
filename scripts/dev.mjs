#!/usr/bin/env node
/**
 * Cross-platform dev launcher.
 * Kills ports BE_PORT/FE_PORT, starts backend and frontend concurrently.
 * Passes NEXT_PUBLIC_API_URL=BE_URL so frontend knows where to find the API.
 *
 * Works on macOS, Linux, and Windows.
 */
import { execSync, spawn } from 'child_process';
import { platform } from 'os';

const BE_PORT = 7001;
const FE_PORT = 7002;
const BE_URL  = `http://localhost:${BE_PORT}`;
const FE_URL  = `http://localhost:${FE_PORT}`;

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

for (const port of PORTS) {
  killPort(port);
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
    env: { ...process.env, NEXT_PUBLIC_API_URL: BE_URL, ...extraEnv }
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
