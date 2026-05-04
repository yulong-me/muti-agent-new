'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

import { API_URL } from '@/lib/api'
import type { TeamListItem } from '@/lib/agents'
import { type SettingsTab } from '@/lib/settingsTabs'
import { debug, warn } from '@/lib/logger'

import { ProviderSettingsTab } from './settings-modal/ProviderSettingsTab'
import { SettingsTabSwitcher } from './settings-modal/SettingsTabSwitcher'
import { SkillSettingsTab } from './settings-modal/SkillSettingsTab'
import { TeamSettingsTab } from './settings-modal/TeamSettingsTab'
import type {
  ProviderName,
  ProviderConfig,
  ProviderReadiness,
  ReadOnlySkill,
  SkillConfig,
} from './settings-modal/types'

const API = API_URL

export default function SettingsModal({
  isOpen,
  onClose,
  initialTab = 'team',
}: {
  isOpen: boolean
  onClose: () => void
  initialTab?: SettingsTab
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({})
  const [providerReadiness, setProviderReadiness] = useState<Record<string, ProviderReadiness>>({})
  const [teamArchitectProvider, setTeamArchitectProvider] = useState<ProviderName>('claude-code')
  const [teams, setTeams] = useState<TeamListItem[]>([])
  const [skills, setSkills] = useState<SkillConfig[]>([])
  const [globalSkills, setGlobalSkills] = useState<ReadOnlySkill[]>([])
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isOpen) return
    setTab(initialTab)
  }, [initialTab, isOpen])

  useEffect(() => {
    if (!isOpen) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) return

    let cancelled = false
    setLoading(true)
    debug('ui:settings:load_start', { tab: initialTab })

    Promise.all([
      fetch(`${API}/api/providers`).then(response => response.json()),
      fetch(`${API}/api/providers/readiness`).then(response => response.json()).catch(() => ({})),
      fetch(`${API}/api/system-settings/team-architect`).then(response => response.json()).catch(() => ({ provider: 'claude-code' })),
      fetch(`${API}/api/teams`).then(response => response.json()).catch(() => []),
      fetch(`${API}/api/skills`).then(response => response.json()),
      fetch(`${API}/api/skills/global`).then(response => response.json()).catch(() => []),
    ]).then(([pr, readiness, teamArchitect, tm, sk, gl]) => {
      if (cancelled) return
      setProviders(pr)
      setProviderReadiness(readiness)
      if (teamArchitect?.provider === 'claude-code' || teamArchitect?.provider === 'opencode' || teamArchitect?.provider === 'codex') {
        setTeamArchitectProvider(teamArchitect.provider)
      }
      setTeams(Array.isArray(tm) ? tm : [])
      setSkills(sk)
      setGlobalSkills(gl)
      if (!selectedProvider && Object.keys(pr).length > 0) {
        setSelectedProvider(Object.keys(pr)[0])
      }
      debug('ui:settings:load_success', {
        providerCount: Object.keys(pr).length,
        teamCount: Array.isArray(tm) ? tm.length : 0,
        skillCount: sk.length,
        globalSkillCount: gl.length,
      })
      setLoading(false)
    }).catch(error => {
      if (cancelled) return
      warn('ui:settings:load_failed', { error })
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [initialTab, isOpen, selectedProvider])

  async function refreshProviderReadiness() {
    try {
      const response = await fetch(`${API}/api/providers/readiness`)
      if (!response.ok) return
      const readiness = await response.json() as Record<string, ProviderReadiness>
      setProviderReadiness(readiness)
    } catch (error) {
      warn('ui:settings:provider_readiness_failed', { error })
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 layer-modal flex items-center justify-center p-4 md:p-6 pointer-events-none">
      <button type="button" aria-label="关闭" className="pointer-events-auto absolute inset-0 layer-modal-scrim bg-[color:var(--overlay-scrim)] transition-opacity cursor-default" onClick={onClose} />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="系统设置"
          className="layer-overlay-content pointer-events-auto flex h-[calc(100vh-32px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl settings-panel shadow-2xl md:h-[calc(100vh-48px)] animate-in zoom-in-95 duration-200"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-line settings-nav shrink-0">
            <SettingsTabSwitcher tab={tab} onChange={setTab} />
            <button type="button" onClick={onClose} aria-label="关闭设置" className="p-2 text-ink-soft hover:text-ink hover:bg-surface-muted rounded-full transition-colors">
              <X className="w-4 h-4" aria-hidden />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 custom-scrollbar space-y-4">
            {loading ? (
              <div className="flex justify-center items-center h-40">
                <span className="text-ink-soft text-[13px] animate-pulse">加载中…</span>
              </div>
            ) : tab === 'provider' ? (
              <ProviderSettingsTab
                providers={providers}
                readiness={providerReadiness}
                selectedProvider={selectedProvider}
                teamArchitectProvider={teamArchitectProvider}
                onSelectProvider={setSelectedProvider}
                onUpdateProvider={provider => setProviders(previous => ({ ...previous, [provider.name]: provider }))}
                onTeamArchitectProviderChange={setTeamArchitectProvider}
                onRefreshReadiness={refreshProviderReadiness}
              />
            ) : tab === 'team' ? (
              <TeamSettingsTab
                teams={teams}
                skills={skills}
                globalSkills={globalSkills}
                onUpdated={updated => setTeams(previous => previous.map(team => team.id === updated.id ? updated : team))}
              />
            ) : (
              <SkillSettingsTab
                skills={skills}
                globalSkills={globalSkills}
                onCreated={skill => setSkills(previous => [skill, ...previous])}
                onImported={skill => setSkills(previous => [skill, ...previous])}
                onUpdate={updated => setSkills(previous => previous.map(skill => skill.id === updated.id ? updated : skill))}
                onDelete={skillId => setSkills(previous => previous.filter(skill => skill.id !== skillId))}
              />
            )}
          </div>
        </div>
    </div>
  )
}
