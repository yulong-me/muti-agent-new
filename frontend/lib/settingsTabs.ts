export type SettingsTab = 'agent' | 'provider' | 'scene'

export function resolveSettingsTab(value?: string | null): SettingsTab {
  if (value === 'provider' || value === 'providers') return 'provider'
  if (value === 'scene' || value === 'scenes') return 'scene'
  if (value === 'agent' || value === 'agents') return 'agent'
  return 'agent'
}

export function resolveSettingsReturnPath(value?: string | null): string {
  if (!value) return '/'
  if (!value.startsWith('/')) return '/'
  if (value.startsWith('//')) return '/'
  return value
}

export function buildSettingsHref(tab: SettingsTab, returnTo?: string | null): string {
  const params = new URLSearchParams({ tab })
  const safeReturnTo = resolveSettingsReturnPath(returnTo)
  if (safeReturnTo !== '/') {
    params.set('returnTo', safeReturnTo)
  }
  return `/settings?${params.toString()}`
}
