import { db, DB_PATH } from './db.js';
import { initSchema, migrateFromJson, ensureBuiltinScenes } from './migrate.js';
import { roomsRepo, messagesRepo } from './repositories/rooms.js';
import { sessionsRepo } from './repositories/sessions.js';
import { auditRepo } from './repositories/audit.js';
import { agentsRepo } from './repositories/agents.js';
import { providersRepo } from './repositories/providers.js';
import { scenesRepo } from './repositories/scenes.js';
import { log } from '../log.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


/** Initialize DB: apply schema, migrate JSON configs, seed defaults if empty */
export function initDB(): void {
  initSchema();
  migrateFromJson();

  const existingAgents = agentsRepo.list();
  const metaRow = db.prepare("SELECT value FROM app_meta WHERE key = 'bootstrap_seed_version'").get() as { value: string } | undefined;

  if (!metaRow) {
    // Determine whether this is a truly fresh empty DB or a legacy DB getting its first meta marker.
    // Historical DB = any of agents / providers / scenes already has rows.
    const hasHistoricalData =
      agentsRepo.list().length > 0 ||
      Object.keys(providersRepo.list()).length > 0 ||
      scenesRepo.list().length > 0;

    if (hasHistoricalData) {
      // Legacy DB upgrading: do NOT seed / supplement anything, just write the meta marker.
      // Existing agents, providers, scenes are preserved as-is.
      db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('bootstrap_seed_version', '1')").run();
      log('INFO', 'db:seed:bootstrap:legacy', { reason: 'historical data found, meta written only' });
    } else {
      // Truly fresh DB: seed all builtin data once.
      const SEEDED_PROVIDERS = [
        { name: 'claude-code', label: 'Claude Code', cliPath: 'claude', defaultModel: 'claude-sonnet-4-6', apiKey: '', baseUrl: '', timeout: 1800, thinking: true },
        { name: 'opencode',    label: 'OpenCode',    cliPath: '~/.opencode/bin/opencode', defaultModel: 'MiniMax-M2.7', apiKey: '', baseUrl: '', timeout: 1800, thinking: true },
      ];
      let providersSeeded = 0;
      for (const p of SEEDED_PROVIDERS) {
        providersRepo.insertIfNotExists(p.name, p);
        providersSeeded++;
      }

      ensureBuiltinScenes();

      const agentsList = [
        { id: 'paul-graham',     name: 'Paul Graham',    roleLabel: 'Paul Graham' },
        { id: 'zhang-yiming',    name: '张一鸣',          roleLabel: '张一鸣' },
        { id: 'andrej-karpathy', name: 'Andrej Karpathy', roleLabel: 'Karpathy' },
        { id: 'ilya-sutskever',  name: 'Ilya Sutskever', roleLabel: 'Ilya' },
        { id: 'mrbeast',         name: 'MrBeast',         roleLabel: 'MrBeast' },
        { id: 'trump',           name: '特朗普',           roleLabel: '特朗普' },
        { id: 'steve-jobs',      name: '乔布斯',           roleLabel: '乔布斯' },
        { id: 'elon-musk',       name: '马斯克',           roleLabel: '马斯克' },
        { id: 'munger',          name: '查理·芒格',        roleLabel: '芒格' },
        { id: 'feynman',         name: '理查德·费曼',       roleLabel: '费曼' },
        { id: 'naval',           name: '纳瓦尔',           roleLabel: '纳瓦尔' },
        { id: 'taleb',           name: '塔勒布',           roleLabel: '塔勒布' },
        { id: 'zhangxuefeng',    name: '张雪峰',           roleLabel: '张雪峰' },
      ];
      const skillsDir = path.resolve(__dirname, '../../../.agents/skills');
      let agentsSeeded = 0;
      for (const agent of agentsList) {
        const mdPath = path.join(skillsDir, `${agent.id}-perspective`, 'SKILL.md');
        let systemPrompt = '';
        try {
          if (fs.existsSync(mdPath)) {
            systemPrompt = fs.readFileSync(mdPath, 'utf-8');
          } else {
            log('WARN', 'db:seed:agents:missing_md', { path: mdPath });
            continue;
          }
        } catch (err) {
          log('ERROR', 'db:seed:agents:read_error', { err: String(err) });
          continue;
        }
        agentsRepo.upsert({
          id: agent.id,
          name: agent.name,
          role: 'WORKER',
          roleLabel: agent.roleLabel,
          provider: 'claude-code',
          providerOpts: { thinking: true },
          systemPrompt,
          enabled: true,
          tags: ['persona', 'expert']
        });
        agentsSeeded++;
      }

      db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('bootstrap_seed_version', '1')").run();
      log('INFO', 'db:seed:bootstrap:done', { agentsSeeded, scenesSeeded: 2, providersSeeded });
    }
  } else {
    // Already bootstrapped — never auto-overwrite anything, not even "missing" builtin items
    log('INFO', 'db:seed:bootstrap:skipped', { reason: 'bootstrap_seed_version already set' });
  }

  log('INFO', 'db:init:done', { dbPath: DB_PATH });
}

export { db, DB_PATH };
export { roomsRepo, messagesRepo };
export { sessionsRepo };
export { auditRepo };
export { agentsRepo };
export { providersRepo };
export { scenesRepo };
