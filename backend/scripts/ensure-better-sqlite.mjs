#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, '..');

function isNativeBindingMismatch(error) {
  if (!error || typeof error !== 'object') return false;
  const message = String(error.message || '');
  return error.code === 'ERR_DLOPEN_FAILED'
    || message.includes('Could not locate the bindings file')
    || message.includes('was compiled against a different Node.js version')
    || message.includes('NODE_MODULE_VERSION');
}

function loadBetterSqlite() {
  require('better-sqlite3');
}

function rebuildBetterSqlite() {
  const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(pnpmCmd, ['rebuild', 'better-sqlite3'], {
    cwd: backendDir,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

try {
  loadBetterSqlite();
} catch (error) {
  if (!isNativeBindingMismatch(error)) {
    throw error;
  }

  console.warn('[native] better-sqlite3 ABI mismatch detected, rebuilding for current Node...');
  rebuildBetterSqlite();
  loadBetterSqlite();
  console.log('[native] better-sqlite3 ready');
}
