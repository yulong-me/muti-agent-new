import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

export type ProviderName = 'claude-code' | 'opencode';

export interface AgentConfig {
  id: string;
  name: string;
  /** One-liner label shown in the UI */
  roleLabel: string;
  role: 'HOST' | 'AGENT';
  provider: ProviderName;
  /** Provider-specific options passed to the CLI */
  providerOpts: {
    model?: string;
    thinking?: boolean;
    [key: string]: unknown;
  };
  /** System prompt injected before user message */
  systemPrompt: string;
  enabled: boolean;
}

const CONFIG_PATH = resolve(process.cwd(), 'config', 'agents.json');

function defaultAgents(): AgentConfig[] {
  return [
    {
      id: 'claude-sonnet',
      name: 'Sonnet',
      roleLabel: '主持人',
      role: 'HOST',
      provider: 'claude-code',
      providerOpts: { thinking: true },
      systemPrompt: '你是一个严谨的主持人，引导多智能体讨论。',
      enabled: true,
    },
    {
      id: 'claude-opus',
      name: 'Opus',
      roleLabel: '研究员',
      role: 'AGENT',
      provider: 'claude-code',
      providerOpts: { thinking: true },
      systemPrompt: '你是一个深度研究员，善于调查和分析。',
      enabled: true,
    },
    {
      id: 'gemini-flash',
      name: 'Gemini Flash',
      roleLabel: '辩论员',
      role: 'AGENT',
      provider: 'opencode',
      providerOpts: { model: 'google/gemini-2-0-flash', thinking: false },
      systemPrompt: '你是一个善于辩论的专家。',
      enabled: true,
    },
  ];
}

function ensureConfig(): AgentConfig[] {
  if (!existsSync(CONFIG_PATH)) {
    const dir = resolve(process.cwd(), 'config');
    mkdirSync(dir, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(defaultAgents(), null, 2));
    return defaultAgents();
  }
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as AgentConfig[];
  } catch {
    return defaultAgents();
  }
}

// In-memory cache — reload on each API call so changes take effect immediately
let _cache: AgentConfig[] | null = null;

export function getAgents(): AgentConfig[] {
  _cache = _cache ?? ensureConfig();
  return _cache;
}

export function getAgent(id: string): AgentConfig | undefined {
  return getAgents().find(a => a.id === id);
}

/** Lookup by agent name (used when room agents use UUIDs as id but name is stable) */
export function getAgentByName(name: string): AgentConfig | undefined {
  return getAgents().find(a => a.name === name);
}

export function saveAgents(agents: AgentConfig[]): void {
  _cache = agents;
  writeFileSync(CONFIG_PATH, JSON.stringify(agents, null, 2));
}
