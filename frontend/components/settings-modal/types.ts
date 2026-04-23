export type ProviderName = 'claude-code' | 'opencode'

export interface AgentConfig {
  id: string
  name: string
  roleLabel: string
  role: 'MANAGER' | 'WORKER'
  provider: ProviderName
  providerOpts: { thinking?: boolean; [key: string]: unknown }
  systemPrompt: string
  enabled: boolean
  tags: string[]
}

export interface SceneConfig {
  id: string
  name: string
  description?: string
  prompt: string
  builtin: boolean
  canDelete: boolean
  canEditName: boolean
  canEditPrompt: boolean
}

export interface ProviderConfig {
  name: string
  label: string
  cliPath: string
  defaultModel: string
  apiKey: string
  baseUrl: string
  timeout: number
  thinking: boolean
  lastTested: number | null
  lastTestResult: { success: boolean; cli?: string; output?: string; error?: string } | null
}

export interface SkillConfig {
  id: string
  name: string
  description: string
  enabled: boolean
  providerCompat: ProviderName[]
  content: string
  usage: { agentCount: number; roomCount: number }
}

export interface SkillBinding {
  skillId: string
  mode: 'auto' | 'required'
  enabled: boolean
  skill: {
    id: string
    name: string
    description: string
  }
}

export interface AgentSkillBindingInput {
  skillId: string
  mode: 'auto' | 'required'
  enabled: boolean
}

export interface ReadOnlySkill {
  name: string
  description: string
  sourceType: 'global' | 'workspace'
  sourcePath: string
}

export const PROVIDER_LABELS: Record<ProviderName, string> = {
  'claude-code': 'Claude Code',
  'opencode': 'OpenCode',
}

export const PROVIDER_COLORS: Record<ProviderName, string> = {
  'claude-code': 'provider-badge-claude-code',
  'opencode': 'provider-badge-opencode',
}

export const PROVIDER_SWATCHES: Record<ProviderName, string> = {
  'claude-code': 'provider-swatch provider-orb provider-swatch-claude-code',
  'opencode': 'provider-swatch provider-orb provider-swatch-opencode',
}

export const PROVIDER_DOTS: Record<ProviderName, string> = {
  'claude-code': 'provider-swatch-claude-code',
  'opencode': 'provider-swatch-opencode',
}
