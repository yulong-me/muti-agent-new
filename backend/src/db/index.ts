import { db, DB_PATH } from './db.js';
import { resolveBootstrapAction } from './bootstrapStrategy.js';
import { initSchema, migrateFromJson } from './migrate.js';
import { roomsRepo, messagesRepo } from './repositories/rooms.js';
import { agentRunsRepo } from './repositories/agentRuns.js';
import { sessionsRepo } from './repositories/sessions.js';
import { auditRepo } from './repositories/audit.js';
import { agentsRepo } from './repositories/agents.js';
import { providersRepo } from './repositories/providers.js';
import { systemSettingsRepo } from './repositories/systemSettings.js';
import { teamsRepo } from './repositories/teams.js';
import { evolutionRepo } from './repositories/teamEvolution.js';
import { skillsRepo, agentSkillBindingsRepo, roomSkillBindingsRepo } from './repositories/skills.js';
import { log } from '../log.js';
import {
  BUILTIN_AGENT_DEFINITIONS,
  LEGACY_SOFTWARE_DEVELOPMENT_AGENT_DEFINITIONS,
  PREVIOUS_SOFTWARE_DEVELOPMENT_AGENT_DEFINITIONS,
  SOFTWARE_DEVELOPMENT_AGENT_DEFINITIONS,
  SOFTWARE_DEVELOPMENT_TEAM_TAG,
  ROUNDTABLE_AGENT_DEFINITIONS,
  buildBuiltinProviderOptsForMigration,
  type BuiltinAgentDefinition,
} from '../prompts/builtinAgents.js';
import { BUILTIN_PROVIDER_DEFINITIONS } from '../config/builtinProviders.js';
import { runtimePaths } from '../config/runtimePaths.js';
import { matchesResolvedBuiltinAgent, shouldRunBuiltinAgentCatalogV5Migrations } from './builtinAgentCatalog.js';
import { BUILTIN_PROVIDER_CATALOG_VERSION, backfillMissingBuiltinProviders } from './builtinProviderCatalog.js';
import fs from 'fs';
import path from 'path';

function countRows(tableName: 'agents' | 'providers' | 'teams' | 'rooms'): number {
  return (db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`).get() as { cnt: number }).cnt;
}

function seedBuiltinProviders(): number {
  let providersSeeded = 0;
  for (const p of BUILTIN_PROVIDER_DEFINITIONS) {
    providersRepo.insertIfNotExists(p.name, p);
    providersSeeded++;
  }
  return providersSeeded;
}

function ensureBuiltinProviderCatalogV1(): void {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'builtin_provider_catalog_version'").get() as { value: string } | undefined;
  const currentVersion = Number.parseInt(row?.value ?? '0', 10);
  if (currentVersion >= BUILTIN_PROVIDER_CATALOG_VERSION) return;

  const inserted = backfillMissingBuiltinProviders({
    getProvider: name => providersRepo.get(name),
    insertProviderIfNotExists: (name, data) => providersRepo.insertIfNotExists(name, data),
  }, BUILTIN_PROVIDER_DEFINITIONS);

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('builtin_provider_catalog_version', ?)").run(String(BUILTIN_PROVIDER_CATALOG_VERSION));
  log('INFO', 'db:seed:providers:catalog_v1', { inserted });
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

function matchesExactBuiltinAgent(
  agent: {
    name: string;
    role: string;
    roleLabel: string;
    provider: string;
    providerOpts: Record<string, unknown>;
    systemPrompt: string;
    enabled: boolean;
    tags: string[];
  },
  definition: BuiltinAgentDefinition,
  options?: { ignoreProviderFields?: boolean },
): boolean {
  const systemPrompt = resolveBuiltinAgentPrompt(definition);
  if (systemPrompt === null) return false;

  return matchesResolvedBuiltinAgent(agent, definition, systemPrompt, options);
}

function ensureBuiltinAgentCatalogV6(): void {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'builtin_agent_catalog_version'").get() as { value: string } | undefined;
  const currentVersion = Number.parseInt(row?.value ?? '0', 10);
  if (currentVersion >= 6) return;

  let inserted = 0;
  let retagged = 0;
  let providerMigrated = 0;
  let upgraded = 0;
  let retired = 0;
  const shouldRunV5Migrations = shouldRunBuiltinAgentCatalogV5Migrations(currentVersion);

  if (shouldRunV5Migrations) {
    const migratableSoftwareDefsById = new Map<string, BuiltinAgentDefinition[]>();
    for (const definition of [
      ...LEGACY_SOFTWARE_DEVELOPMENT_AGENT_DEFINITIONS,
      ...PREVIOUS_SOFTWARE_DEVELOPMENT_AGENT_DEFINITIONS,
    ]) {
      const existing = migratableSoftwareDefsById.get(definition.id) ?? [];
      existing.push(definition);
      migratableSoftwareDefsById.set(definition.id, existing);
    }
    const activeSoftwareAgentIds = new Set(SOFTWARE_DEVELOPMENT_AGENT_DEFINITIONS.map(def => def.id));

    for (const agent of SOFTWARE_DEVELOPMENT_AGENT_DEFINITIONS) {
      const existing = agentsRepo.get(agent.id);
      if (!existing) {
        if (seedBuiltinAgent(agent)) inserted++;
        continue;
      }

      const previousDefinitions = migratableSoftwareDefsById.get(agent.id) ?? [];
      if (!previousDefinitions.some(definition => matchesExactBuiltinAgent(existing, definition, { ignoreProviderFields: true }))) continue;
      if (seedBuiltinAgent(agent)) upgraded++;
    }

    for (const legacyDefinition of LEGACY_SOFTWARE_DEVELOPMENT_AGENT_DEFINITIONS) {
      if (activeSoftwareAgentIds.has(legacyDefinition.id)) continue;

      const existing = agentsRepo.get(legacyDefinition.id);
      if (!existing) continue;
      if (!matchesExactBuiltinAgent(existing, legacyDefinition, { ignoreProviderFields: true })) continue;

      agentsRepo.upsert({
        ...existing,
        tags: existing.tags.filter(tag => tag !== SOFTWARE_DEVELOPMENT_TEAM_TAG),
      });
      retired++;
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
  }

  for (const def of BUILTIN_AGENT_DEFINITIONS) {
    const existing = agentsRepo.get(def.id);
    if (existing) continue;
    if (seedBuiltinAgent(def)) inserted++;
  }

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('builtin_agent_catalog_version', '6')").run();
  log('INFO', 'db:seed:agents:catalog_v6', { inserted, retagged, providerMigrated, upgraded, retired });
}

const seedFreshBuiltinData = db.transaction(() => {
  const providersSeeded = seedBuiltinProviders();
  const agentsSeeded = seedBuiltinAgents();
  const teamSeedResult = teamsRepo.ensureBuiltinTeams();
  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('bootstrap_seed_version', '1')").run();
  return { agentsSeeded, teamsSeeded: teamSeedResult.teamsInserted, providersSeeded };
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
  const teamsCount = countRows('teams');
  const roomsCount = countRows('rooms');
  const bootstrapAction = resolveBootstrapAction({
    metaPresent: Boolean(metaRow),
    agentsCount,
    providersCount,
    teamsCount,
    roomsCount,
  });

  if (bootstrapAction === 'fresh_seed_all') {
    const { agentsSeeded, teamsSeeded, providersSeeded } = seedFreshBuiltinData();
    log('INFO', 'db:seed:bootstrap:done', { agentsSeeded, teamsSeeded, providersSeeded });
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
    const { agentsSeeded, teamsSeeded, providersSeeded } = seedFreshBuiltinData();
    log('WARN', 'db:seed:bootstrap:repair_partial', {
      reason: 'bootstrap marker existed but agents/teams were empty',
      agentsSeeded,
      teamsSeeded,
      providersSeeded,
    });
  } else {
    log('INFO', 'db:seed:bootstrap:skipped', { reason: 'bootstrap_seed_version already set' });
  }

  ensureBuiltinAgentCatalogV6();
  ensureBuiltinProviderCatalogV1();
  const teamSeedResult = teamsRepo.ensureBuiltinTeams();
  if (teamSeedResult.teamsInserted > 0 || teamSeedResult.versionsInserted > 0) {
    log('INFO', 'db:seed:teams', teamSeedResult);
  }

  log('INFO', 'db:init:done', { dbPath: DB_PATH });
}

export { db, DB_PATH };
export { roomsRepo, messagesRepo };
export { agentRunsRepo };
export { sessionsRepo };
export { auditRepo };
export { agentsRepo };
export { providersRepo };
export { systemSettingsRepo };
export { teamsRepo };
export { evolutionRepo };
export { skillsRepo };
export { agentSkillBindingsRepo };
export { roomSkillBindingsRepo };
