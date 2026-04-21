import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(fileDir, '..', '..');
const repoRoot = path.resolve(backendRoot, '..');

const runtimeRoot = path.resolve(process.env.OPENCOUNCIL_RUNTIME_ROOT ?? backendRoot);
const builtinSkillsDir = path.resolve(
  process.env.OPENCOUNCIL_BUILTIN_SKILLS_DIR ?? path.join(repoRoot, '.agents', 'skills'),
);

export const runtimePaths = {
  backendRoot,
  repoRoot,
  runtimeRoot,
  dataDir: path.join(runtimeRoot, 'data'),
  dbPath: path.join(runtimeRoot, 'data', 'muti-agent.db'),
  logsDir: path.join(runtimeRoot, 'logs'),
  workspaceBaseDir: path.join(runtimeRoot, 'workspaces'),
  workspaceArchiveDir: path.join(runtimeRoot, 'workspaces-archive'),
  builtinSkillsDir,
} as const;

export function ensureDirSync(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
