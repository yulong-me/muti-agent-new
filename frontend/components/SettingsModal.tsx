'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

import { API_URL } from '@/lib/api'
import { mergeAgentModel } from '@/lib/agentModels'
import { type SettingsTab } from '@/lib/settingsTabs'
import { debug, info, warn } from '@/lib/logger'

import { AgentSettingsTab } from './settings-modal/AgentSettingsTab'
import { ProviderSettingsTab } from './settings-modal/ProviderSettingsTab'
import { SceneSettingsTab } from './settings-modal/SceneSettingsTab'
import { SettingsTabSwitcher } from './settings-modal/SettingsTabSwitcher'
import { SkillSettingsTab } from './settings-modal/SkillSettingsTab'
import type {
  AgentConfig,
  AgentSkillBindingInput,
  ProviderConfig,
  ProviderName,
  ProviderReadiness,
  ReadOnlySkill,
  SceneConfig,
  SkillBinding,
  SkillConfig,
} from './settings-modal/types'

const API = API_URL

interface AgentCreateDraft {
  id: string
  name: string
  roleLabel: string
  provider: ProviderName
  model: string
  systemPrompt: string
  tags: string[]
}

export default function SettingsModal({
  isOpen,
  onClose,
  initialTab = 'agent',
}: {
  isOpen: boolean
  onClose: () => void
  initialTab?: SettingsTab
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [agents, setAgents] = useState<AgentConfig[]>([])
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({})
  const [providerReadiness, setProviderReadiness] = useState<Record<string, ProviderReadiness>>({})
  const [scenes, setScenes] = useState<SceneConfig[]>([])
  const [skills, setSkills] = useState<SkillConfig[]>([])
  const [globalSkills, setGlobalSkills] = useState<ReadOnlySkill[]>([])
  const [agentSkillBindings, setAgentSkillBindings] = useState<Record<string, SkillBinding[]>>({})
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<AgentConfig | null>(null)

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
      fetch(`${API}/api/agents`).then(response => response.json()),
      fetch(`${API}/api/providers`).then(response => response.json()),
      fetch(`${API}/api/providers/readiness`).then(response => response.json()).catch(() => ({})),
      fetch(`${API}/api/scenes`).then(response => response.json()),
      fetch(`${API}/api/skills`).then(response => response.json()),
      fetch(`${API}/api/skills/global`).then(response => response.json()).catch(() => []),
    ]).then(async ([ag, pr, readiness, sc, sk, gl]) => {
      if (cancelled) return
      setAgents(ag)
      setProviders(pr)
      setProviderReadiness(readiness)
      setScenes(sc)
      setSkills(sk)
      setGlobalSkills(gl)
      const bindingEntries = await Promise.all(
        (ag as AgentConfig[]).map(async agent => {
          try {
            const response = await fetch(`${API}/api/agents/${agent.id}/skills`)
            return [agent.id, response.ok ? await response.json() as SkillBinding[] : []] as const
          } catch {
            return [agent.id, []] as const
          }
        }),
      )
      if (cancelled) return
      setAgentSkillBindings(Object.fromEntries(bindingEntries))
      if (!selectedProvider && Object.keys(pr).length > 0) {
        setSelectedProvider(Object.keys(pr)[0])
      }
      debug('ui:settings:load_success', {
        agentCount: ag.length,
        providerCount: Object.keys(pr).length,
        sceneCount: sc.length,
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

  function handleAgentSave(updated: AgentConfig, bindings: AgentSkillBindingInput[]): Promise<void> {
    setSaving(true)
    info('ui:settings:agent_save', { agentId: updated.id, bindingCount: bindings.length })
    return fetch(`${API}/api/agents/${updated.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).then(async response => {
      const agent = await response.json() as AgentConfig & { error?: string }
      if (!response.ok) throw new Error(agent.error ?? '保存失败')
      const bindingsResponse = await fetch(`${API}/api/agents/${updated.id}/skills`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bindings }),
      })
      const nextBindings = await bindingsResponse.json().catch(() => []) as SkillBinding[] & { error?: string }
      if (!bindingsResponse.ok) {
        throw new Error((nextBindings as { error?: string }).error ?? 'Skill 保存失败')
      }
      setAgents(previous => previous.map(item => item.id === agent.id ? agent : item))
      setAgentSkillBindings(previous => ({ ...previous, [updated.id]: Array.isArray(nextBindings) ? nextBindings : [] }))
      info('ui:settings:agent_save_success', { agentId: updated.id, bindingCount: bindings.length })
      setSaving(false)
    }).catch(error => {
      warn('ui:settings:agent_save_failed', { agentId: updated.id, error })
      setSaving(false)
      throw error
    })
  }

  async function handleAgentCreate(draft: AgentCreateDraft): Promise<void> {
    setSaving(true)
    info('ui:settings:agent_create', { agentId: draft.id, provider: draft.provider })
    try {
      const response = await fetch(`${API}/api/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: draft.id,
          name: draft.name,
          roleLabel: draft.roleLabel,
          provider: draft.provider,
          role: 'WORKER',
          providerOpts: mergeAgentModel({ thinking: true }, draft.model),
          systemPrompt: draft.systemPrompt,
          tags: draft.tags,
          enabled: true,
        }),
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || `HTTP ${response.status}`)
      }
      const created = await response.json() as AgentConfig
      info('ui:settings:agent_create_success', { agentId: created.id, provider: created.provider })
      setAgents(previous => [...previous, created])
      setAgentSkillBindings(previous => ({ ...previous, [created.id]: [] }))
    } catch (error) {
      warn('ui:settings:agent_create_failed', { agentId: draft.id, error })
      throw error
    } finally {
      setSaving(false)
    }
  }

  function handleAgentDelete(agentId: string) {
    info('ui:settings:agent_delete', { agentId })
    fetch(`${API}/api/agents/${agentId}`, { method: 'DELETE' })
      .then(response => {
        if (!response.ok) {
          warn('ui:settings:agent_delete_failed', { agentId, status: response.status })
          return
        }
        setAgents(previous => previous.filter(agent => agent.id !== agentId))
        setAgentSkillBindings(previous => {
          const next = { ...previous }
          delete next[agentId]
          return next
        })
        info('ui:settings:agent_delete_success', { agentId })
      })
      .catch(error => {
        warn('ui:settings:agent_delete_failed', { agentId, error })
      })
    setPendingDelete(null)
  }

  if (!isOpen) return null

  return (
    <>
      <button type="button" aria-label="关闭" className="fixed inset-0 bg-[color:var(--overlay-scrim)] z-40 transition-opacity cursor-default" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="系统设置"
          className="pointer-events-auto flex h-[calc(100vh-32px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl settings-panel shadow-2xl md:h-[calc(100vh-48px)] animate-in zoom-in-95 duration-200"
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
            ) : tab === 'agent' ? (
              <AgentSettingsTab
                agents={agents}
                providers={providers}
                skills={skills}
                agentSkillBindings={agentSkillBindings}
                saving={saving}
                pendingDelete={pendingDelete}
                onCreateAgent={handleAgentCreate}
                onSaveAgent={handleAgentSave}
                onDeleteRequest={setPendingDelete}
                onDeleteConfirm={handleAgentDelete}
                onDeleteCancel={() => setPendingDelete(null)}
              />
            ) : tab === 'provider' ? (
              <ProviderSettingsTab
                providers={providers}
                readiness={providerReadiness}
                selectedProvider={selectedProvider}
                onSelectProvider={setSelectedProvider}
                onUpdateProvider={provider => setProviders(previous => ({ ...previous, [provider.name]: provider }))}
                onRefreshReadiness={refreshProviderReadiness}
              />
            ) : tab === 'scene' ? (
              <SceneSettingsTab
                scenes={scenes}
                onCreated={scene => setScenes(previous => [...previous, scene])}
                onUpdate={updated => setScenes(previous => previous.map(scene => scene.id === updated.id ? updated : scene))}
                onDelete={sceneId => setScenes(previous => previous.filter(scene => scene.id !== sceneId))}
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
    </>
  )
}
