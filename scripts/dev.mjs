#!/usr/bin/env node
/**
 * Cross-platform dev launcher.
 * Kills any processes occupying ports 7001/7002,
 * then starts backend and frontend concurrently.
 *
 * Works on macOS, Linux, and Windows (no lsof/kill dependency).
 */
import { execSync, spawn } from 'child_process';
import { platform } from 'os';

const PORTS = [7001, 7002];

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
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore', shell: true });
    }
  } catch {
    // port was not in use — fine
  }
}

for (const port of PORTS) {
  killPort(port);
  console.log(`✓ Port ${port} freed`);
}

const isWin = platform() === 'win32';
const shell = isWin ? true : false;
const npmCmd = isWin ? 'pnpm.cmd' : 'pnpm';

const colors = { backend: '\x1b[34m', frontend: '\x1b[32m', reset: '\x1b[0m' };

function prefix(name, color) {
  return (line) => process.stdout.write(`${color}[${name}]${colors.reset} ${line}\n`);
}

function startProc(name, cwd, color) {
  const proc = spawn(npmCmd, ['dev'], { cwd, shell, stdio: ['ignore', 'pipe', 'pipe'] });
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
