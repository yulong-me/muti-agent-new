import SettingsPageClient from '@/components/SettingsPageClient'
import { resolveSettingsReturnPath, resolveSettingsTab } from '@/lib/settingsTabs'

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default function SettingsTabPage({
  params,
  searchParams,
}: {
  params: { tab?: string }
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const initialTab = resolveSettingsTab(firstParam(params.tab))
  const returnTo = resolveSettingsReturnPath(firstParam(searchParams?.returnTo))

  return <SettingsPageClient initialTab={initialTab} returnTo={returnTo} />
}
