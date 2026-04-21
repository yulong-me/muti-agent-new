import { db, DB_PATH } from './db.js';
import { resolveBootstrapAction } from './bootstrapStrategy.js';
import { initSchema, migrateFromJson, ensureBuiltinScenes } from './migrate.js';
import { roomsRepo, messagesRepo } from './repositories/rooms.js';
import { sessionsRepo } from './repositories/sessions.js';
import { auditRepo } from './repositories/audit.js';
import { agentsRepo } from './repositories/agents.js';
import { providersRepo } from './repositories/providers.js';
import { scenesRepo } from './repositories/scenes.js';
import { skillsRepo, agentSkillBindingsRepo, roomSkillBindingsRepo } from './repositories/skills.js';
import { log } from '../log.js';
import {
  BUILTIN_AGENT_DEFINITIONS,
  SOFTWARE_DEVELOPMENT_AGENT_DEFINITIONS,
  ROUNDTABLE_AGENT_DEFINITIONS,
  buildBuiltinProviderOptsForMigration,
  type BuiltinAgentDefinition,
} from '../prompts/builtinAgents.js';
import { runtimePaths } from '../config/runtimePaths.js';
import fs from 'fs';
import path from 'path';

const SEEDED_PROVIDERS = [
  { name: 'claude-code', label: 'Claude Code', cliPath: 'claude', defaultModel: 'claude-sonnet-4-6', apiKey: '', baseUrl: '', timeout: 1800, thinking: true },
  { name: 'opencode',    label: 'OpenCode',    cliPath: '~/.opencode/bin/opencode', defaultModel: 'MiniMax-M2.7', apiKey: '', baseUrl: '', timeout: 1800, thinking: true },
] as const;

function countRows(tableName: 'agents' | 'providers' | 'scenes' | 'rooms'): number {
  return (db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get() as { cnt: number }).cnt;
}

function seedBuiltinProviders(): number {
  let providersSeeded = 0;
  for (const p of SEEDED_PROVIDERS) {
    providersRepo.insertIfNotExists(p.name, p);
    providersSeeded++;
  }
  return providersSeeded;
}

function resolveBuiltinAgentPrompt(agent: BuiltinAgentDefinition): string | null {
  if (agent.systemPrompt !== undefined) return agent.systemPrompt;
  if (!agent.skillId) return '';

  const mdPath = path.join(runtimePaths.builtinSkillsDir, `${agent.skillId}-perspective`, 'SKILL.md');
  try {
    if (fs.existsSync(mdPath)) {
      return fs.readFileSync(mdPath, 'utf-8');
    }
    log('WARN', 'db:seed:agents:missing_md', { path: mdPath });
  } catch (err) {
    log('ERROR', 'db:seed:agents:read_error', { err: String(err) });
  }
  return null;
}

function seedBuiltinAgent(agent: BuiltinAgentDefinition): boolean {
  const systemPrompt = resolveBuiltinAgentPrompt(agent);
  if (systemPrompt === null) return false;
  agentsRepo.upsert({
    id: agent.id,
    name: agent.name,
    role: 'WORKER',
    roleLabel: agent.roleLabel,
    provider: agent.provider,
    providerOpts: agent.providerOpts,
    systemPrompt,
    enabled: true,
    tags: agent.tags,
  });
  return true;
}

function seedBuiltinAgents(): number {
  let agentsSeeded = 0;
  for (const agent of BUILTIN_AGENT_DEFINITIONS) {
    if (seedBuiltinAgent(agent)) agentsSeeded++;
  }
  return agentsSeeded;
}

function hasTags(agent: { tags: string[] }, expected: string[]): boolean {
  return agent.tags.length === expected.length && expected.every(tag => agent.tags.includes(tag));
}

function ensureBuiltinAgentCatalogV3(): void {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'builtin_agent_catalog_version'").get() as { value: string } | undefined;
  if (row?.value === '3') return;

  let inserted = 0;
  let retagged = 0;
  let providerMigrated = 0;

  for (const agent of SOFTWARE_DEVELOPMENT_AGENT_DEFINITIONS) {
    if (agentsRepo.get(agent.id)) continue;
    if (seedBuiltinAgent(agent)) inserted++;
  }

  for (const def of ROUNDTABLE_AGENT_DEFINITIONS) {
    const existing = agentsRepo.get(def.id);
    if (!existing || !hasTags(existing, ['persona', 'expert'])) continue;
    agentsRepo.upsert({ ...existing, tags: def.tags });
    retagged++;
  }

  for (const def of BUILTIN_AGENT_DEFINITIONS) {
    const existing = agentsRepo.get(def.id);
    if (!existing || existing.provider === def.provider) continue;
    agentsRepo.upsert({
      ...existing,
      provider: def.provider,
      providerOpts: buildBuiltinProviderOptsForMigration(def.providerOpts, existing.providerOpts),
    });
    providerMigrated++;
  }

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('builtin_agent_catalog_version', '3')").run();
  log('INFO', 'db:seed:agents:catalog_v3', { inserted, retagged, providerMigrated });
}

const seedFreshBuiltinData = db.transaction(() => {
  const providersSeeded = seedBuiltinProviders();
  ensureBuiltinScenes();
  const agentsSeeded = seedBuiltinAgents();
  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('bootstrap_seed_version', '1')").run();
  return { agentsSeeded, scenesSeeded: countRows('scenes'), providersSeeded };
});

const backfillLegacyBuiltinAgents = db.transaction(() => {
  const agentsSeeded = seedBuiltinAgents();
  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('bootstrap_seed_version', '1')").run();
  return { agentsSeeded };
});


/** Initialize DB: apply schema, migrate JSON configs, seed defaults if empty */
export function initDB(): void {
  initSchema();
  migrateFromJson();

  const metaRow = db.prepare("SELECT value FROM app_meta WHERE key = 'bootstrap_seed_version'").get() as { value: string } | undefined;
  const agentsCount = countRows('agents');
  const providersCount = countRows('providers');
  const scenesCount = countRows('scenes');
  const roomsCount = countRows('rooms');
  const bootstrapAction = resolveBootstrapAction({
    metaPresent: Boolean(metaRow),
    agentsCount,
    providersCount,
    scenesCount,
    roomsCount,
  });

  if (bootstrapAction === 'fresh_seed_all') {
    const { agentsSeeded, scenesSeeded, providersSeeded } = seedFreshBuiltinData();
    log('INFO', 'db:seed:bootstrap:done', { agentsSeeded, scenesSeeded, providersSeeded });
  } else if (bootstrapAction === 'legacy_backfill_agents') {
    const { agentsSeeded } = backfillLegacyBuiltinAgents();
    log('INFO', 'db:seed:bootstrap:legacy_agents_backfilled', {
      reason: 'historical data found, agents catalog was empty',
      agentsSeeded,
    });
  } else if (bootstrapAction === 'legacy_mark_only') {
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('bootstrap_seed_version', '1')").run();
    log('INFO', 'db:seed:bootstrap:legacy', { reason: 'historical data found, meta written only' });
  } else if (bootstrapAction === 'repair_partial') {
    const { agentsSeeded, scenesSeeded, providersSeeded } = seedFreshBuiltinData();
    log('WARN', 'db:seed:bootstrap:repair_partial', {
      reason: 'bootstrap marker existed but agents/scenes were empty',
      agentsSeeded,
      scenesSeeded,
      providersSeeded,
    });
  } else {
    log('INFO', 'db:seed:bootstrap:skipped', { reason: 'bootstrap_seed_version already set' });
  }

  ensureBuiltinAgentCatalogV3();

  log('INFO', 'db:init:done', { dbPath: DB_PATH });
}

export { db, DB_PATH };
export { roomsRepo, messagesRepo };
export { sessionsRepo };
export { auditRepo };
export { agentsRepo };
export { providersRepo };
export { scenesRepo };
export { skillsRepo };
export { agentSkillBindingsRepo };
export { roomSkillBindingsRepo };
