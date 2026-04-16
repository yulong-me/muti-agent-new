import { db, DB_PATH } from './db.js';
import { initSchema, migrateFromJson } from './migrate.js';
import { roomsRepo, messagesRepo } from './repositories/rooms.js';
import { sessionsRepo } from './repositories/sessions.js';
import { auditRepo } from './repositories/audit.js';
import { agentsRepo } from './repositories/agents.js';
import { providersRepo } from './repositories/providers.js';
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

  // Seed default provider if empty
  const providers = providersRepo.list();
  if (Object.keys(providers).length === 0) {
    providersRepo.upsert('claude-code', {
      label: 'Claude Code',
      cliPath: 'claude',
      defaultModel: 'claude-sonnet-4-6',
      apiKey: '',
      baseUrl: '',
      timeout: 90,
      thinking: true,
    });
    providersRepo.upsert('opencode', {
      label: 'OpenCode',
      cliPath: '~/.opencode/bin/opencode',
      defaultModel: 'MiniMax-M2.7',
      apiKey: '',
      baseUrl: '',
      timeout: 90,
      thinking: true,
    });
    log('INFO', 'db:seed:providers:done');
  }

  // Seed / upgrade default agents: detect existing seeded agents by well-known IDs
  // If any of the new-domain agents are missing, do a full replace (migration from old seed)
  const SEEDED_IDS = new Set([
    'paul-graham', 'zhang-yiming', 'andrej-karpathy', 'ilya-sutskever', 
    'mrbeast', 'trump', 'steve-jobs', 'elon-musk', 'munger', 
    'feynman', 'naval', 'taleb', 'zhangxuefeng'
  ]);
  const agentsList = [
    { id: 'paul-graham', name: 'Paul Graham', roleLabel: 'Paul Graham' },
    { id: 'zhang-yiming', name: '张一鸣', roleLabel: '张一鸣' },
    { id: 'andrej-karpathy', name: 'Andrej Karpathy', roleLabel: 'Karpathy' },
    { id: 'ilya-sutskever', name: 'Ilya Sutskever', roleLabel: 'Ilya' },
    { id: 'mrbeast', name: 'MrBeast', roleLabel: 'MrBeast' },
    { id: 'trump', name: '特朗普', roleLabel: '特朗普' },
    { id: 'steve-jobs', name: '乔布斯', roleLabel: '乔布斯' },
    { id: 'elon-musk', name: '马斯克', roleLabel: '马斯克' },
    { id: 'munger', name: '查理·芒格', roleLabel: '芒格' },
    { id: 'feynman', name: '理查德·费曼', roleLabel: '费曼' },
    { id: 'naval', name: '纳瓦尔', roleLabel: '纳瓦尔' },
    { id: 'taleb', name: '塔勒布', roleLabel: '塔勒布' },
    { id: 'zhangxuefeng', name: '张雪峰', roleLabel: '张雪峰' }
  ];

  const existingAgents = agentsRepo.list();
  const needsSeed = existingAgents.length === 0 ||
    !SEEDED_IDS.has(existingAgents[0]?.id ?? ''); // if first agent id doesn't match new seed IDs, re-seed

  if (needsSeed) {
    // Remove old agents before re-seeding
    if (existingAgents.length > 0) {
      for (const a of existingAgents) agentsRepo.delete(a.id);
      log('INFO', 'db:seed:agents:migration:cleared', { count: existingAgents.length });
    }
    
    // Read skills from .agents/skills and insert
    const skillsDir = path.resolve(__dirname, '../../../.agents/skills');
    
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
        systemPrompt: systemPrompt,
        enabled: true,
        tags: ['persona', 'expert']
      });
    }

    log('INFO', 'db:seed:agents:done', { count: agentsList.length });
  }

  log('INFO', 'db:init:done', { dbPath: DB_PATH });
}

export { db, DB_PATH };
export { roomsRepo, messagesRepo };
export { sessionsRepo };
export { auditRepo };
export { agentsRepo };
export { providersRepo };
