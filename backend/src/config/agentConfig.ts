import { agentsRepo, type AgentConfig, type ProviderName } from '../db/repositories/agents.js';

export type { AgentConfig, ProviderName };
export { agentsRepo };

export function getAgents(): AgentConfig[] {
  return agentsRepo.list();
}

export function getAgent(id: string): AgentConfig | undefined {
  return agentsRepo.get(id);
}

export function saveAgents(agents: AgentConfig[]): void {
  // Full replace: clear and re-insert all
  const all = agentsRepo.list();
  for (const a of all) {
    agentsRepo.delete(a.id);
  }
  for (const a of agents) {
    agentsRepo.upsert(a);
  }
}
