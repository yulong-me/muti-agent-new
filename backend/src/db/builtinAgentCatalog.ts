import type { BuiltinAgentDefinition } from '../prompts/builtinAgents.js';

interface StoredBuiltinAgentSnapshot {
  name: string;
  role: string;
  roleLabel: string;
  provider: string;
  providerOpts: Record<string, unknown>;
  systemPrompt: string;
  enabled: boolean;
  tags: string[];
}

function hasTags(agent: { tags: string[] }, expected: string[]): boolean {
  return agent.tags.length === expected.length && expected.every(tag => agent.tags.includes(tag));
}

export function shouldRunBuiltinAgentCatalogV5Migrations(currentVersion: number): boolean {
  return currentVersion < 5;
}

export function matchesResolvedBuiltinAgent(
  agent: StoredBuiltinAgentSnapshot,
  definition: BuiltinAgentDefinition,
  resolvedSystemPrompt: string,
  options?: { ignoreProviderFields?: boolean },
): boolean {
  const ignoreProviderFields = options?.ignoreProviderFields ?? false;
  const providerMatches = ignoreProviderFields || (
    agent.provider === definition.provider &&
    JSON.stringify(agent.providerOpts) === JSON.stringify(definition.providerOpts)
  );

  return (
    agent.name === definition.name &&
    agent.role === 'WORKER' &&
    agent.roleLabel === definition.roleLabel &&
    providerMatches &&
    agent.systemPrompt === resolvedSystemPrompt &&
    agent.enabled === true &&
    hasTags(agent, definition.tags)
  );
}
