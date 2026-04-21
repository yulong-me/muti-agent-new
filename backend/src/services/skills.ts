import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import * as fs from 'fs/promises';
import { homedir } from 'os';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths.js';
import { ensureDirSync } from '../config/runtimePaths.js';
import { getAgent } from '../config/agentConfig.js';
import { store } from '../store.js';
import { ensureWorkspace } from './workspace.js';
import { debug, info, warn } from '../lib/logger.js';
import {
  agentSkillBindingsRepo,
  roomSkillBindingsRepo,
  skillsRepo,
  type SkillBindingRecord,
  type SkillMode,
  type SkillProviderCompat,
  type SkillRecord,
} from '../db/repositories/skills.js';
import type { ProviderName } from '../db/repositories/agents.js';

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEFAULT_PROVIDER_COMPAT: SkillProviderCompat[] = ['claude-code', 'opencode'];

export interface SkillBindingInput {
  skillId?: string;
  skillName?: string;
  mode?: SkillMode;
  enabled?: boolean;
}

export interface ManagedSkillInput {
  name: string;
  description?: string;
  content?: string;
  enabled?: boolean;
  providerCompat?: SkillProviderCompat[];
}

export interface ManagedSkillDetail extends SkillRecord {
  content: string;
  usage: {
    agentCount: number;
    roomCount: number;
  };
}

export interface DiscoveredSkill {
  name: string;
  description: string;
  sourceType: 'workspace' | 'global';
  sourcePath: string;
  bundlePath: string;
  readOnly: true;
  providerCompat: SkillProviderCompat[];
  checksum: string;
}

export interface EffectiveSkill {
  name: string;
  description: string;
  mode: SkillMode;
  source: 'room' | 'workspace' | 'global' | 'agent';
  sourceLabel: string;
  sourcePath: string;
  bundlePath: string;
  providerCompat: SkillProviderCompat[];
  enabled: boolean;
  checksum: string;
}

function isWithin(parent: string, target: string): boolean {
  const rel = path.relative(parent, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function checksum(content: string): string {
  return createHash('sha1').update(content).digest('hex');
}

function normalizeSkillName(name: string): string {
  return name.trim().toLowerCase();
}

export function validateSkillName(name: string): string {
  const normalized = normalizeSkillName(name);
  if (!SKILL_NAME_RE.test(normalized)) {
    throw new Error('Skill name must match ^[a-z0-9]+(-[a-z0-9]+)*$');
  }
  return normalized;
}

function parseFrontmatterValue(content: string, key: string): string | undefined {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) return undefined;
  for (const rawLine of match[1].split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith(`${key}:`)) continue;
    const value = line.slice(key.length + 1).trim();
    return value.replace(/^['"]|['"]$/g, '');
  }
  return undefined;
}

function inferDescriptionFromContent(content: string): string {
  const fm = parseFrontmatterValue(content, 'description');
  if (fm) return fm;

  const lines = content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !line.startsWith('---') && !line.startsWith('#'));

  return lines[0] ?? '';
}

function scaffoldSkillContent(name: string, description: string): string {
  const desc = description.trim() || `Describe when to use the ${name} skill.`;
  return [
    '---',
    `name: ${name}`,
    `description: ${desc}`,
    '---',
    '',
    `# ${name}`,
    '',
    desc,
    '',
    '## Instructions',
    '',
    '- Add the reusable workflow, checklists, and constraints for this skill here.',
    '',
  ].join('\n');
}

function normalizeProviderCompat(providerCompat?: SkillProviderCompat[]): SkillProviderCompat[] {
  const next = Array.from(new Set((providerCompat ?? DEFAULT_PROVIDER_COMPAT).filter(
    provider => provider === 'claude-code' || provider === 'opencode',
  )));
  return next.length > 0 ? next : [...DEFAULT_PROVIDER_COMPAT];
}

function getManagedSkillDir(name: string): string {
  return path.join(runtimePaths.managedSkillsDir, name);
}

function getManagedSkillFile(name: string): string {
  return path.join(getManagedSkillDir(name), 'SKILL.md');
}

async function readManagedSkillFile(name: string): Promise<string> {
  return fs.readFile(getManagedSkillFile(name), 'utf-8');
}

function resolveSourceLabel(source: EffectiveSkill['source']): string {
  if (source === 'room') return 'Room';
  if (source === 'workspace') return 'Workspace';
  if (source === 'global') return 'Global';
  return 'Agent';
}

function toManagedSkillDetail(skill: SkillRecord, content: string): ManagedSkillDetail {
  return {
    ...skill,
    content,
    usage: skillsRepo.countBindingUsage(skill.id),
  };
}

export async function listManagedSkills(): Promise<ManagedSkillDetail[]> {
  const skills = skillsRepo.listManaged();
  const details = await Promise.all(skills.map(async skill => {
    const content = await readManagedSkillFile(skill.name).catch(() => '');
    return toManagedSkillDetail(skill, content);
  }));
  debug('skill:managed:list', { count: details.length });
  return details;
}

export async function getManagedSkill(name: string): Promise<ManagedSkillDetail | undefined> {
  const normalizedName = validateSkillName(name);
  const skill = skillsRepo.getManagedByName(normalizedName);
  if (!skill) return undefined;
  const content = await readManagedSkillFile(normalizedName).catch(() => '');
  const detail = toManagedSkillDetail(skill, content);
  debug('skill:managed:get', { name: normalizedName, enabled: detail.enabled });
  return detail;
}

function buildManagedSkillRecord(input: {
  name: string;
  description: string;
  filePath: string;
  enabled: boolean;
  providerCompat: SkillProviderCompat[];
  checksum: string;
}): SkillRecord {
  return {
    id: input.name,
    name: input.name,
    description: input.description,
    sourceType: 'managed',
    sourcePath: input.filePath,
    enabled: input.enabled,
    readOnly: false,
    builtin: false,
    providerCompat: input.providerCompat,
    updatedAt: Date.now(),
    checksum: input.checksum,
  };
}

export async function createManagedSkill(input: ManagedSkillInput): Promise<ManagedSkillDetail> {
  const name = validateSkillName(input.name);
  if (skillsRepo.getManagedByName(name)) {
    throw new Error(`Skill already exists: ${name}`);
  }

  ensureDirSync(runtimePaths.managedSkillsDir);
  const skillDir = getManagedSkillDir(name);
  await fs.mkdir(skillDir, { recursive: true });

  const content = (input.content?.trim() || scaffoldSkillContent(name, input.description ?? '')).trimEnd() + '\n';
  const filePath = getManagedSkillFile(name);
  await fs.writeFile(filePath, content, 'utf-8');

  const record = buildManagedSkillRecord({
    name,
    description: (input.description?.trim() || inferDescriptionFromContent(content)),
    filePath,
    enabled: input.enabled ?? true,
    providerCompat: normalizeProviderCompat(input.providerCompat),
    checksum: checksum(content),
  });
  skillsRepo.upsert(record);
  info('skill:managed:create', { name, enabled: record.enabled, providerCompat: record.providerCompat });
  return toManagedSkillDetail(record, content);
}

export async function importManagedSkillFolder(input: {
  sourcePath: string;
  name?: string;
  enabled?: boolean;
  providerCompat?: SkillProviderCompat[];
}): Promise<ManagedSkillDetail> {
  const sourcePath = path.resolve(input.sourcePath);
  const stat = await fs.stat(sourcePath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Skill folder not found: ${sourcePath}`);
  }

  const sourceSkillFile = path.join(sourcePath, 'SKILL.md');
  const content = await fs.readFile(sourceSkillFile, 'utf-8').catch(() => null);
  if (!content) {
    throw new Error('Selected folder does not contain SKILL.md');
  }

  const inferredName = input.name?.trim() || parseFrontmatterValue(content, 'name') || path.basename(sourcePath);
  const name = validateSkillName(inferredName);
  if (skillsRepo.getManagedByName(name)) {
    throw new Error(`Skill already exists: ${name}`);
  }

  ensureDirSync(runtimePaths.managedSkillsDir);
  const destDir = getManagedSkillDir(name);
  await fs.cp(sourcePath, destDir, { recursive: true, force: false, errorOnExist: true });

  const destContent = await readManagedSkillFile(name);
  const record = buildManagedSkillRecord({
    name,
    description: inferDescriptionFromContent(destContent),
    filePath: getManagedSkillFile(name),
    enabled: input.enabled ?? true,
    providerCompat: normalizeProviderCompat(input.providerCompat),
    checksum: checksum(destContent),
  });
  skillsRepo.upsert(record);
  info('skill:managed:import', { name, sourcePath, enabled: record.enabled, providerCompat: record.providerCompat });
  return toManagedSkillDetail(record, destContent);
}

export async function updateManagedSkill(name: string, input: Partial<ManagedSkillInput>): Promise<ManagedSkillDetail> {
  const normalizedName = validateSkillName(name);
  const existing = skillsRepo.getManagedByName(normalizedName);
  if (!existing) {
    throw new Error(`Skill not found: ${normalizedName}`);
  }

  const existingContent = await readManagedSkillFile(normalizedName).catch(() => '');
  const content = (input.content ?? existingContent).trimEnd() + '\n';
  const filePath = getManagedSkillFile(normalizedName);
  await fs.mkdir(getManagedSkillDir(normalizedName), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');

  const record = buildManagedSkillRecord({
    name: normalizedName,
    description: input.description?.trim() || inferDescriptionFromContent(content) || existing.description,
    filePath,
    enabled: input.enabled ?? existing.enabled,
    providerCompat: normalizeProviderCompat(input.providerCompat ?? existing.providerCompat),
    checksum: checksum(content),
  });
  skillsRepo.upsert(record);
  info('skill:managed:update', { name: normalizedName, enabled: record.enabled, providerCompat: record.providerCompat });
  return toManagedSkillDetail(record, content);
}

export async function deleteManagedSkill(name: string): Promise<'DELETED' | 'NOT_FOUND' | 'IN_USE'> {
  const normalizedName = validateSkillName(name);
  const existing = skillsRepo.getManagedByName(normalizedName);
  if (!existing) {
    warn('skill:managed:delete:not_found', { name: normalizedName });
    return 'NOT_FOUND';
  }

  const usage = skillsRepo.countBindingUsage(existing.id);
  if (usage.agentCount > 0 || usage.roomCount > 0) {
    warn('skill:managed:delete:in_use', { name: normalizedName, usage });
    return 'IN_USE';
  }

  skillsRepo.delete(existing.id);
  await fs.rm(getManagedSkillDir(normalizedName), { recursive: true, force: true });
  info('skill:managed:delete', { name: normalizedName });
  return 'DELETED';
}

function resolveManagedBindingInput(input: SkillBindingInput): SkillBindingRecord['skill'] {
  const skill = input.skillId
    ? skillsRepo.getById(input.skillId)
    : input.skillName
    ? skillsRepo.getManagedByName(validateSkillName(input.skillName))
    : undefined;

  if (!skill || skill.sourceType !== 'managed') {
    throw new Error(`Managed skill not found: ${input.skillId ?? input.skillName ?? 'unknown'}`);
  }
  return skill;
}

function normalizeBindingsInput(bindings: SkillBindingInput[]): Array<{ skillId: string; mode: SkillMode; enabled: boolean }> {
  const deduped = new Map<string, { skillId: string; mode: SkillMode; enabled: boolean }>();
  for (const binding of bindings) {
    const skill = resolveManagedBindingInput(binding);
    deduped.set(skill.id, {
      skillId: skill.id,
      mode: binding.mode === 'required' ? 'required' : 'auto',
      enabled: binding.enabled !== false,
    });
  }
  return Array.from(deduped.values());
}

export function listAgentSkillBindings(agentId: string): SkillBindingRecord[] {
  return agentSkillBindingsRepo.list(agentId);
}

export function replaceAgentSkillBindings(agentId: string, bindings: SkillBindingInput[]): SkillBindingRecord[] {
  agentSkillBindingsRepo.replace(agentId, normalizeBindingsInput(bindings));
  const next = agentSkillBindingsRepo.list(agentId);
  info('skill:bindings:agent:update', { agentId, bindingCount: next.length });
  return next;
}

export function listRoomSkillBindings(roomId: string): SkillBindingRecord[] {
  return roomSkillBindingsRepo.list(roomId);
}

export function replaceRoomSkillBindings(roomId: string, bindings: SkillBindingInput[]): SkillBindingRecord[] {
  roomSkillBindingsRepo.replace(roomId, normalizeBindingsInput(bindings));
  const next = roomSkillBindingsRepo.list(roomId);
  info('skill:bindings:room:update', { roomId, bindingCount: next.length });
  return next;
}

function resolveWorkspaceDiscoveryBoundary(workspacePath: string): { workspaceRoot: string; scanBoundary: string } {
  const workspaceRoot = path.resolve(workspacePath);
  const runtimeWorkspaceBase = path.resolve(runtimePaths.workspaceBaseDir);

  if (isWithin(runtimeWorkspaceBase, workspaceRoot)) {
    return { workspaceRoot, scanBoundary: workspaceRoot };
  }

  const git = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: workspaceRoot,
    encoding: 'utf-8',
  });
  const gitRoot = git.status === 0 ? git.stdout.trim() : '';

  return {
    workspaceRoot,
    scanBoundary: gitRoot ? path.resolve(gitRoot) : workspaceRoot,
  };
}

async function readDiscoveredSkillBundle(bundlePath: string, providerCompat: SkillProviderCompat[]): Promise<DiscoveredSkill | null> {
  const skillFile = path.join(bundlePath, 'SKILL.md');
  try {
    const content = await fs.readFile(skillFile, 'utf-8');
    const inferredName = parseFrontmatterValue(content, 'name') ?? path.basename(bundlePath);
    const name = validateSkillName(inferredName);
    return {
      name,
      description: inferDescriptionFromContent(content),
      sourceType: 'workspace',
      sourcePath: skillFile,
      bundlePath,
      readOnly: true,
      providerCompat,
      checksum: checksum(content),
    };
  } catch {
    return null;
  }
}

async function discoverBundlesFromDirectory(baseDir: string, providerCompat: SkillProviderCompat[]): Promise<DiscoveredSkill[]> {
  try {
    const stat = await fs.stat(baseDir);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  const discovered = await Promise.all(entries
    .filter(entry => entry.isDirectory())
    .map(entry => readDiscoveredSkillBundle(path.join(baseDir, entry.name), providerCompat)));
  return discovered.filter((skill): skill is DiscoveredSkill => Boolean(skill));
}

async function discoverGlobalSkills(): Promise<DiscoveredSkill[]> {
  const home = homedir();
  const byNameAndSource = new Map<string, DiscoveredSkill>();
  const sources: Array<{ dir: string; providerCompat: SkillProviderCompat[] }> = [
    { dir: path.join(home, '.claude', 'skills'), providerCompat: ['claude-code'] },
    { dir: path.join(home, '.config', 'opencode', 'skills'), providerCompat: ['opencode'] },
    { dir: path.join(home, '.opencode', 'skills'), providerCompat: ['opencode'] },
    { dir: path.join(home, '.agents', 'skills'), providerCompat: ['claude-code', 'opencode'] },
  ];

  for (const source of sources) {
    const skills = await discoverBundlesFromDirectory(source.dir, source.providerCompat);
    for (const skill of skills) {
      const discovered: DiscoveredSkill = {
        ...skill,
        sourceType: 'global',
      };
      const key = `${discovered.name}:${discovered.sourcePath}`;
      if (!byNameAndSource.has(key)) {
        byNameAndSource.set(key, discovered);
      }
    }
  }

  const discovered = Array.from(byNameAndSource.values()).sort((a, b) => a.name.localeCompare(b.name));
  debug('skill:discover:global', { count: discovered.length });
  return discovered;
}

export async function discoverWorkspaceSkills(workspacePath: string): Promise<{
  workspacePath: string;
  workspaceRoot: string;
  scanBoundary: string;
  workspaceSkills: DiscoveredSkill[];
  globalSkills: DiscoveredSkill[];
  skills: DiscoveredSkill[];
}> {
  const realWorkspace = await fs.realpath(workspacePath).catch(err => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return path.resolve(workspacePath);
    }
    throw err;
  });
  const { workspaceRoot, scanBoundary } = resolveWorkspaceDiscoveryBoundary(realWorkspace);

  const byName = new Map<string, DiscoveredSkill>();
  let current = workspaceRoot;
  while (true) {
    const candidates = await Promise.all([
      discoverBundlesFromDirectory(path.join(current, '.agents', 'skills'), ['claude-code', 'opencode']),
      discoverBundlesFromDirectory(path.join(current, '.claude', 'skills'), ['claude-code']),
      discoverBundlesFromDirectory(path.join(current, '.opencode', 'skills'), ['opencode']),
    ]);
    for (const skill of candidates.flat()) {
      if (!byName.has(skill.name)) {
        byName.set(skill.name, skill);
      }
    }

    if (current === scanBoundary) break;
    const parent = path.dirname(current);
    if (parent === current || !isWithin(scanBoundary, parent)) break;
    current = parent;
  }

  const workspaceSkills = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  const globalSkills = await discoverGlobalSkills();
  const merged = new Map<string, DiscoveredSkill>();

  for (const skill of globalSkills) {
    if (!merged.has(skill.name)) {
      merged.set(skill.name, skill);
    }
  }

  for (const skill of workspaceSkills) {
    merged.set(skill.name, skill);
  }

  debug('skill:discover:workspace', {
    workspacePath: realWorkspace,
    workspaceRoot,
    scanBoundary,
    workspaceCount: workspaceSkills.length,
    globalCount: globalSkills.length,
    mergedCount: merged.size,
  });

  return {
    workspacePath: realWorkspace,
    workspaceRoot,
    scanBoundary,
    workspaceSkills,
    globalSkills,
    skills: Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function discoverSystemGlobalSkills(): Promise<DiscoveredSkill[]> {
  return discoverGlobalSkills();
}

export async function getRoomWorkspace(roomId: string): Promise<string> {
  const room = store.get(roomId);
  if (!room) throw new Error(`Room not found: ${roomId}`);
  return ensureWorkspace(roomId, room.workspace);
}

function bindingToEffectiveSkill(binding: SkillBindingRecord, source: 'room' | 'agent'): EffectiveSkill {
  return {
    name: binding.skill.name,
    description: binding.skill.description,
    mode: binding.mode,
    source,
    sourceLabel: resolveSourceLabel(source),
    sourcePath: binding.skill.sourcePath,
    bundlePath: path.dirname(binding.skill.sourcePath),
    providerCompat: binding.skill.providerCompat,
    enabled: binding.enabled && binding.skill.enabled,
    checksum: binding.skill.checksum,
  };
}

function discoveredToEffectiveSkill(skill: DiscoveredSkill): EffectiveSkill {
  return {
    name: skill.name,
    description: skill.description,
    mode: 'auto',
    source: skill.sourceType,
    sourceLabel: resolveSourceLabel(skill.sourceType),
    sourcePath: skill.sourcePath,
    bundlePath: skill.bundlePath,
    providerCompat: skill.providerCompat,
    enabled: true,
    checksum: skill.checksum,
  };
}

export async function resolveEffectiveSkills(input: {
  roomId: string;
  agentConfigId: string;
  workspacePath?: string;
  providerName: ProviderName;
}): Promise<{
  workspacePath: string;
  roomBindings: SkillBindingRecord[];
  agentBindings: SkillBindingRecord[];
  globalSkills: DiscoveredSkill[];
  workspaceSkills: DiscoveredSkill[];
  discovered: DiscoveredSkill[];
  effective: EffectiveSkill[];
}> {
  const workspacePath = input.workspacePath ?? await getRoomWorkspace(input.roomId);
  const [roomBindings, agentBindings, discoveredResult] = await Promise.all([
    Promise.resolve(listRoomSkillBindings(input.roomId)),
    Promise.resolve(listAgentSkillBindings(input.agentConfigId)),
    discoverWorkspaceSkills(workspacePath),
  ]);

  const merged = new Map<string, EffectiveSkill>();

  for (const binding of agentBindings) {
    const skill = bindingToEffectiveSkill(binding, 'agent');
    if (!skill.enabled || !skill.providerCompat.includes(input.providerName)) continue;
    merged.set(skill.name, skill);
  }

  for (const discovered of discoveredResult.globalSkills) {
    const skill = discoveredToEffectiveSkill(discovered);
    if (!skill.providerCompat.includes(input.providerName)) continue;
    merged.set(skill.name, skill);
  }

  for (const discovered of discoveredResult.workspaceSkills) {
    const skill = discoveredToEffectiveSkill(discovered);
    if (!skill.providerCompat.includes(input.providerName)) continue;
    merged.set(skill.name, skill);
  }

  for (const binding of roomBindings) {
    const skill = bindingToEffectiveSkill(binding, 'room');
    if (!skill.enabled || !skill.providerCompat.includes(input.providerName)) continue;
    merged.set(skill.name, skill);
  }

  const effective = Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
  debug('skill:resolve:effective', {
    roomId: input.roomId,
    agentConfigId: input.agentConfigId,
    providerName: input.providerName,
    roomBindingCount: roomBindings.length,
    agentBindingCount: agentBindings.length,
    globalCount: discoveredResult.globalSkills.length,
    workspaceCount: discoveredResult.workspaceSkills.length,
    effectiveCount: effective.length,
  });

  return {
    workspacePath,
    roomBindings,
    agentBindings,
    globalSkills: discoveredResult.globalSkills,
    workspaceSkills: discoveredResult.workspaceSkills,
    discovered: discoveredResult.skills,
    effective,
  };
}

function providerSkillDir(providerName: ProviderName, providerRuntimeDir: string): string {
  return providerName === 'claude-code'
    ? path.join(providerRuntimeDir, '.claude', 'skills')
    : path.join(providerRuntimeDir, '.opencode', 'skills');
}

export async function assembleProviderRuntime(input: {
  roomId: string;
  providerName: ProviderName;
  effectiveWorkspace: string;
  effectiveSkills: EffectiveSkill[];
}): Promise<{
  providerRuntimeDir: string;
  providerWorkspacePath: string;
}> {
  const providerRuntimeDir = path.join(
    runtimePaths.providerRuntimeBaseDir,
    'rooms',
    input.roomId,
    input.providerName,
  );

  await fs.rm(providerRuntimeDir, { recursive: true, force: true });
  await fs.mkdir(providerSkillDir(input.providerName, providerRuntimeDir), { recursive: true });

  const providerWorkspacePath = path.join(providerRuntimeDir, 'workspace');
  await fs.symlink(input.effectiveWorkspace, providerWorkspacePath, 'dir');

  for (const skill of input.effectiveSkills) {
    const dest = path.join(providerSkillDir(input.providerName, providerRuntimeDir), skill.name);
    await fs.symlink(skill.bundlePath, dest, 'dir');
  }

  debug('skill:runtime:assembled', {
    roomId: input.roomId,
    providerName: input.providerName,
    effectiveWorkspace: input.effectiveWorkspace,
    skillCount: input.effectiveSkills.length,
    providerRuntimeDir,
  });

  return {
    providerRuntimeDir,
    providerWorkspacePath,
  };
}

export function buildEffectiveSkillSummary(skills: EffectiveSkill[]): string | undefined {
  if (skills.length === 0) return undefined;
  return skills
    .map(skill => `- ${skill.name} [${skill.mode}] (${skill.sourceLabel})`)
    .join('\n');
}

export function ensureAgentExists(agentId: string): void {
  if (!getAgent(agentId)) {
    throw new Error(`Agent not found: ${agentId}`);
  }
}
