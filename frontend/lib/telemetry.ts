import type { ContextHealth, InvocationUsage, Message, SessionTelemetry } from './agents'

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function normalizeProviderKey(provider?: string): 'claude-code' | 'opencode' | undefined {
  if (!provider) return undefined
  const normalized = provider.trim().toLowerCase()
  if (normalized === 'claude code' || normalized === 'claude-code') return 'claude-code'
  if (normalized === 'opencode' || normalized === 'open code') return 'opencode'
  return undefined
}

export function formatCompactTokenCount(value?: number): string {
  if (!isFiniteNonNegative(value)) return '0'
  if (value < 1000) return String(Math.round(value))
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`
  return `${(value / 1_000_000).toFixed(1)}m`
}

export function formatLatencyMs(value?: number): string {
  if (!isFiniteNonNegative(value)) return '0ms'
  if (value < 1000) return `${Math.round(value)}ms`
  if (value < 10_000) return `${(value / 1000).toFixed(1)}s`
  return `${Math.round(value / 1000)}s`
}

export function formatUsd(value?: number): string {
  if (!isFiniteNonNegative(value) || value <= 0) return '$0'
  if (value >= 1) return `$${value.toFixed(2)}`
  if (value >= 0.01) return `$${value.toFixed(3)}`
  return `$${value.toFixed(4)}`
}

export function getProviderBadgeClass(provider?: string): string {
  const normalized = normalizeProviderKey(provider)
  if (normalized === 'claude-code') return 'provider-badge-claude-code'
  if (normalized === 'opencode') return 'provider-badge-opencode'
  return 'border-line bg-surface text-ink'
}

export function getProviderSwatchClass(provider?: string): string {
  const normalized = normalizeProviderKey(provider)
  if (normalized === 'claude-code') return 'provider-swatch-claude-code'
  if (normalized === 'opencode') return 'provider-swatch-opencode'
  return 'bg-ink-soft/55'
}

export function formatSessionSnapshotLabel(message: Pick<Message, 'contextHealth' | 'sessionId'>): string | undefined {
  if (message.contextHealth?.usedTokens !== undefined) {
    return `Context ${formatCompactTokenCount(message.contextHealth.usedTokens)}`
  }
  if (message.sessionId) {
    const shortId = message.sessionId.length > 8
      ? `${message.sessionId.slice(0, 8)}…`
      : message.sessionId
    return `Session ID ${shortId}`
  }
  return undefined
}

export function getMessageInvocationUsage(message: Message): InvocationUsage | undefined {
  if (message.invocationUsage) return message.invocationUsage

  const hasLegacyStats = isFiniteNonNegative(message.input_tokens)
    || isFiniteNonNegative(message.output_tokens)
    || isFiniteNonNegative(message.duration_ms)
    || isFiniteNonNegative(message.total_cost_usd)

  if (!hasLegacyStats) return undefined

  return {
    inputTokens: message.input_tokens,
    outputTokens: message.output_tokens,
    costUsd: message.total_cost_usd,
    latencyMs: message.duration_ms,
  }
}

export function getSessionTelemetryForAgent(
  telemetryByAgent: Record<string, SessionTelemetry> | undefined,
  agentConfigId: string | undefined,
): SessionTelemetry | undefined {
  return agentConfigId ? telemetryByAgent?.[agentConfigId] : undefined
}

export function getPreferredContextHealth(
  telemetry?: SessionTelemetry,
  message?: Message,
): ContextHealth | undefined {
  return telemetry?.contextHealth ?? message?.contextHealth
}
