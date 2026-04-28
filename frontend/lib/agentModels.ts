interface ProviderModelConfigLike {
  defaultModel?: string | null
}

export function normalizeModelValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function resolveEffectiveAgentModel(
  providerName: string,
  providerOpts: Record<string, unknown> | undefined,
  providers: Record<string, ProviderModelConfigLike> | undefined,
): string | null {
  return normalizeModelValue(providerOpts?.model)
    ?? normalizeModelValue(providers?.[providerName]?.defaultModel)
    ?? null
}

export function mergeAgentModel(
  providerOpts: Record<string, unknown> | undefined,
  modelInput: string,
): Record<string, unknown> {
  const next = { ...(providerOpts ?? {}) }
  const normalized = normalizeModelValue(modelInput)
  if (normalized) {
    next.model = normalized
  } else {
    delete next.model
  }
  return next
}
