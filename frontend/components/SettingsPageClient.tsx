'use client'

import { useRouter } from 'next/navigation'

import SettingsModal from '@/components/SettingsModal'
import { type SettingsTab } from '@/lib/settingsTabs'

export default function SettingsPageClient({
  initialTab,
  returnTo,
}: {
  initialTab: SettingsTab
  returnTo: string
}) {
  const router = useRouter()

  return (
    <SettingsModal
      isOpen={true}
      initialTab={initialTab}
      onClose={() => router.push(returnTo)}
    />
  )
}
