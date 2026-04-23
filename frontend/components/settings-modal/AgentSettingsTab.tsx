'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Edit2, Plus, Save, Trash2 } from 'lucide-react'

import { mergeAgentModel, normalizeModelValue, resolveEffectiveAgentModel } from '@/lib/agentModels'

import {
  type AgentConfig,
  type AgentSkillBindingInput,
  type ProviderConfig,
  type ProviderName,
  type SkillBinding,
  type SkillConfig,
  PROVIDER_COLORS,
  PROVIDER_LABELS,
} from './types'

function ConfirmDeleteDialog({
  agent,
  onConfirm,
  onCancel,
}: {
  agent: AgentConfig
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[color:var(--overlay-scrim)]">
      <div className="settings-surface rounded-2xl shadow-2xl p-6 w-full max-w-xs mx-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="tone-danger-panel flex h-10 w-10 items-center justify-center rounded-full border">
            <Trash2 className="tone-danger-text w-5 h-5" />
          </div>
          <div>
            <h3 className="text-[15px] font-bold text-ink">确认删除</h3>
            <p className="text-[12px] text-ink-soft">此操作不可恢复</p>
          </div>
        </div>
        <p className="text-[13px] text-ink mb-5">
          确定要删除 Agent
          <span className="font-bold">{agent.name}</span>
          吗？
        </p>
        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className="flex-1 px-4 py-2 text-[13px] font-medium text-ink-soft hover:text-ink hover:bg-surface-muted rounded-xl transition-colors">取消</button>
          <button type="button" onClick={onConfirm} className="tone-danger-button flex-1 rounded-xl px-4 py-2 text-[13px] font-bold transition-colors">删除</button>
        </div>
      </div>
    </div>
  )
}

function AgentRow({
  agent,
  providers,
  availableSkills,
  skillBindings,
  onSave,
  onDeleteRequest,
  saving,
}: {
  agent: AgentConfig
  providers: Record<string, ProviderConfig>
  availableSkills: SkillConfig[]
  skillBindings: SkillBinding[]
  onSave: (agent: AgentConfig, bindings: AgentSkillBindingInput[]) => Promise<void>
  onDeleteRequest: (agent: AgentConfig) => void
  saving: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<AgentConfig>(agent)
  const [formSkillBindings, setFormSkillBindings] = useState<AgentSkillBindingInput[]>(
    skillBindings.map(binding => ({ skillId: binding.skillId, mode: binding.mode, enabled: binding.enabled })),
  )
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (!editing) {
      setForm(agent)
      setFormSkillBindings(skillBindings.map(binding => ({
        skillId: binding.skillId,
        mode: binding.mode,
        enabled: binding.enabled,
      })))
    }
  }, [agent, editing, skillBindings])

  function field<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) {
    setForm(previous => ({ ...previous, [key]: value }))
  }

  function opt(key: string, value: unknown) {
    setForm(previous => ({ ...previous, providerOpts: { ...previous.providerOpts, [key]: value } }))
  }

  function modelInput(value: string) {
    setForm(previous => ({ ...previous, providerOpts: mergeAgentModel(previous.providerOpts, value) }))
  }

  function toggleSkill(skillId: string, enabled: boolean) {
    setFormSkillBindings(previous => {
      const existing = previous.find(binding => binding.skillId === skillId)
      if (enabled) {
        if (existing) {
          return previous.map(binding => binding.skillId === skillId ? { ...binding, enabled: true } : binding)
        }
        return [...previous, { skillId, mode: 'auto', enabled: true }]
      }
      return previous.filter(binding => binding.skillId !== skillId)
    })
  }

  function setSkillMode(skillId: string, mode: 'auto' | 'required') {
    setFormSkillBindings(previous => previous.map(binding => (
      binding.skillId === skillId ? { ...binding, mode } : binding
    )))
  }

  async function handleSave() {
    setSaveError('')
    try {
      await onSave(form, formSkillBindings)
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      setSaveError((error as Error).message || '保存失败')
    }
  }

  function handleCancel() {
    setEditing(false)
    setForm(agent)
    setFormSkillBindings(skillBindings.map(binding => ({
      skillId: binding.skillId,
      mode: binding.mode,
      enabled: binding.enabled,
    })))
    setSaveError('')
  }

  const isHost = agent.role === 'MANAGER'
  const providerClassName = PROVIDER_COLORS[agent.provider]
  const effectiveModel = resolveEffectiveAgentModel(agent.provider, agent.providerOpts, providers)
  const formModel = normalizeModelValue(form.providerOpts.model) ?? ''
  const enabledSkillBindings = skillBindings.filter(binding => binding.enabled)

  if (!editing) {
    return (
      <tr className="border-b border-line hover:bg-surface-muted transition-colors group">
        <td className="px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${isHost ? 'provider-orb provider-swatch-host' : 'provider-orb provider-swatch-worker'}`}>
              {agent.name.slice(0, 1)}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-ink text-[13px]">{agent.name}</span>
                {isHost && <span className="tone-warning-pill rounded border px-1.5 py-0.5 text-[10px] font-bold">主持</span>}
              </div>
              <span className="text-[11px] text-ink-soft">{agent.roleLabel}</span>
              {enabledSkillBindings.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {enabledSkillBindings.map(binding => (
                    <span key={binding.skillId} className="text-[10px] px-1.5 py-0.5 rounded-md bg-accent/10 border border-accent/20 text-accent font-semibold">
                      {binding.skill.name}
                      {binding.mode === 'required' ? ' · required' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </td>
        <td className="px-4 py-3.5">
          <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider border ${providerClassName}`}>{agent.provider}</span>
        </td>
        <td className="px-4 py-3.5">
          <span className="text-[11px] text-ink-soft font-mono">{effectiveModel ?? '默认'}</span>
        </td>
        <td className="px-4 py-3.5">
          <div className="flex flex-wrap gap-1">
            {agent.tags.map(tag => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-md bg-surface-muted border border-line text-ink-soft">{tag}</span>
            ))}
            {agent.tags.length === 0 && <span className="text-[11px] text-ink-soft/40">—</span>}
          </div>
        </td>
        <td className="px-4 py-3.5">
          <span className="text-[11px] text-ink-soft">{agent.providerOpts.thinking !== false ? '🧠' : '—'}</span>
        </td>
        <td className="px-4 py-3.5 text-right">
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {saved && <span className="tone-success-text mr-1 flex items-center gap-1 text-[11px]" aria-live="polite"><CheckCircle2 className="w-3 h-3" aria-hidden />已保存</span>}
            {isHost ? <span className="text-[11px] text-ink-soft/40 mr-2">—</span> : (
              <>
                <button type="button" onClick={() => setEditing(true)} aria-label="编辑" className="p-1.5 text-ink-soft hover:text-ink hover:bg-surface-muted rounded-md transition-colors"><Edit2 className="w-3.5 h-3.5" aria-hidden /></button>
                <button type="button" onClick={() => onDeleteRequest(agent)} aria-label="删除" className="tone-danger-icon rounded-md p-1.5 transition-colors"><Trash2 className="w-3.5 h-3.5" aria-hidden /></button>
              </>
            )}
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-b border-line bg-surface-muted">
      <td colSpan={6} className="px-4 py-4">
        <div className="flex flex-col gap-4">
          <span className="text-[13px] font-bold text-ink">
            {agent.name}
            <span className="text-ink-soft font-normal ml-1">编辑中…</span>
          </span>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">Provider</label>
              {(Object.keys(PROVIDER_LABELS) as ProviderName[]).map(provider => (
                <label key={provider} className="flex items-center gap-1.5 cursor-pointer py-1">
                  <input type="radio" name={`p-${agent.id}`} value={provider} checked={form.provider === provider} onChange={() => field('provider', provider)} className="accent-accent" />
                  <span className="text-[12px] text-ink">{PROVIDER_LABELS[provider]}</span>
                </label>
              ))}
            </div>
            <div>
              <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">标签（逗号分隔）</label>
              <input value={form.tags.join(', ')} onChange={event => field('tags', event.target.value.split(',').map(tag => tag.trim()).filter(Boolean))} className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">模型（可选）</label>
              <input value={formModel} onChange={event => modelInput(event.target.value)} placeholder={providers[form.provider]?.defaultModel || '使用 Provider 默认模型'} className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink font-mono focus:outline-none focus:ring-2 focus:ring-accent/50" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">推理</label>
              <button type="button" onClick={() => opt('thinking', !form.providerOpts.thinking)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.providerOpts.thinking ? 'bg-accent' : 'bg-surface'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.providerOpts.thinking ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">角色标签</label>
              <input value={form.roleLabel} onChange={event => field('roleLabel', event.target.value)} className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">System Prompt</label>
            <textarea value={form.systemPrompt} onChange={event => field('systemPrompt', event.target.value)} rows={2} className="w-full settings-input rounded-xl px-3 py-2 text-[12px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none font-mono" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-soft uppercase mb-2">Default Skills</label>
            <div className="rounded-2xl border border-line bg-surface divide-y divide-line">
              {availableSkills.length === 0 ? (
                <div className="px-3 py-3 text-[12px] text-ink-soft">还没有 managed skill，先去 Skill 标签里创建。</div>
              ) : availableSkills.map(skill => {
                const binding = formSkillBindings.find(item => item.skillId === skill.id)
                return (
                  <div key={skill.id} className="px-3 py-3 flex items-start justify-between gap-3">
                    <label className="flex items-start gap-2 cursor-pointer flex-1">
                      <input type="checkbox" checked={Boolean(binding)} onChange={event => toggleSkill(skill.id, event.target.checked)} className="mt-0.5 accent-accent" />
                      <span className="min-w-0">
                        <span className="block text-[12px] font-semibold text-ink">{skill.name}</span>
                        <span className="block text-[11px] text-ink-soft">{skill.description || '无描述'}</span>
                      </span>
                    </label>
                    <select value={binding?.mode ?? 'auto'} disabled={!binding} onChange={event => setSkillMode(skill.id, event.target.value as 'auto' | 'required')} className="settings-input rounded-lg px-2 py-1 text-[11px] text-ink disabled:opacity-40">
                      <option value="auto">auto</option>
                      <option value="required">required</option>
                    </select>
                  </div>
                )
              })}
            </div>
          </div>
          {saveError && <p className="tone-danger-panel rounded-xl border px-3 py-1.5 text-[12px]">{saveError}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={handleCancel} className="px-4 py-1.5 text-[12px] text-ink-soft hover:text-ink hover:bg-surface rounded-xl transition-colors">取消</button>
            <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-[12px] font-bold bg-ink text-bg rounded-xl hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-1.5">
              <Save className="w-3.5 h-3.5" aria-hidden />
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </td>
    </tr>
  )
}

interface AgentCreateDraft {
  id: string
  name: string
  roleLabel: string
  provider: ProviderName
  model: string
  systemPrompt: string
  tags: string[]
}

export function AgentSettingsTab({
  agents,
  providers,
  skills,
  agentSkillBindings,
  saving,
  pendingDelete,
  onCreateAgent,
  onSaveAgent,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  agents: AgentConfig[]
  providers: Record<string, ProviderConfig>
  skills: SkillConfig[]
  agentSkillBindings: Record<string, SkillBinding[]>
  saving: boolean
  pendingDelete: AgentConfig | null
  onCreateAgent: (draft: AgentCreateDraft) => Promise<void>
  onSaveAgent: (agent: AgentConfig, bindings: AgentSkillBindingInput[]) => Promise<void>
  onDeleteRequest: (agent: AgentConfig) => void
  onDeleteConfirm: (agentId: string) => void
  onDeleteCancel: () => void
}) {
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState<AgentCreateDraft>({
    id: '',
    name: '',
    roleLabel: '',
    provider: 'claude-code',
    model: '',
    systemPrompt: '',
    tags: [],
  })
  const [addError, setAddError] = useState('')

  async function handleAddAgent() {
    if (!addForm.id || !addForm.name) {
      setAddError('ID 和名称必填')
      return
    }
    try {
      await onCreateAgent(addForm)
      setAddForm({
        id: '',
        name: '',
        roleLabel: '',
        provider: 'claude-code',
        model: '',
        systemPrompt: '',
        tags: [],
      })
      setAddOpen(false)
      setAddError('')
    } catch (error) {
      setAddError((error as Error).message)
    }
  }

  return (
    <>
      {addOpen ? (
        <div className="settings-surface rounded-xl p-5 space-y-3">
          <p className="text-[13px] font-bold text-ink flex items-center gap-1.5"><Plus className="w-4 h-4 text-accent" aria-hidden />新增 Agent</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="add-agent-id" className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">ID</label>
              <input id="add-agent-id" value={addForm.id} onChange={event => setAddForm(previous => ({ ...previous, id: event.target.value }))} className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-ink-soft/40" placeholder="my-agent" />
            </div>
            <div>
              <label htmlFor="add-agent-name" className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">名称</label>
              <input id="add-agent-name" value={addForm.name} onChange={event => setAddForm(previous => ({ ...previous, name: event.target.value }))} className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-ink-soft/40" placeholder="小明" />
            </div>
            <div>
              <label htmlFor="add-agent-role" className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">角色标签</label>
              <input id="add-agent-role" value={addForm.roleLabel} onChange={event => setAddForm(previous => ({ ...previous, roleLabel: event.target.value }))} className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-ink-soft/40" placeholder="研究员" />
            </div>
            <div>
              <label htmlFor="add-agent-provider" className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">Provider</label>
              <select id="add-agent-provider" value={addForm.provider} onChange={event => setAddForm(previous => ({ ...previous, provider: event.target.value as ProviderName }))} className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none">
                {(Object.keys(PROVIDER_LABELS) as ProviderName[]).map(provider => <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="add-agent-model" className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">模型（可选）</label>
              <input id="add-agent-model" value={addForm.model} onChange={event => setAddForm(previous => ({ ...previous, model: event.target.value }))} className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink font-mono focus:outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-ink-soft/40" placeholder={providers[addForm.provider]?.defaultModel || '使用 Provider 默认模型'} />
            </div>
          </div>
          <div>
            <label htmlFor="add-agent-prompt" className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">System Prompt</label>
            <textarea id="add-agent-prompt" value={addForm.systemPrompt} onChange={event => setAddForm(previous => ({ ...previous, systemPrompt: event.target.value }))} rows={2} className="w-full settings-input rounded-xl px-3 py-2 text-[12px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none font-mono" />
          </div>
          {addError && <p className="tone-danger-panel rounded-xl border px-3 py-1.5 text-[12px]">{addError}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setAddOpen(false)} className="px-4 py-1.5 text-[12px] text-ink-soft hover:text-ink hover:bg-surface-muted rounded-xl transition-colors">取消</button>
            <button type="button" onClick={handleAddAgent} disabled={saving} className="px-4 py-1.5 text-[12px] font-bold bg-accent text-white rounded-xl hover:bg-accent-deep disabled:opacity-50 transition-all flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" aria-hidden />
              {saving ? '创建中…' : '创建'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAddOpen(true)} className="w-full py-3 text-[13px] font-bold text-ink-soft border border-dashed border-line rounded-xl hover:border-accent/50 hover:text-accent transition-colors flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" aria-hidden />
          新增 Agent
        </button>
      )}

      <div className="settings-surface rounded-xl overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-line bg-surface-muted">
              <th className="px-4 py-3 text-[11px] font-bold text-ink-soft uppercase">名称</th>
              <th className="px-4 py-3 text-[11px] font-bold text-ink-soft uppercase">Provider</th>
              <th className="px-4 py-3 text-[11px] font-bold text-ink-soft uppercase">模型</th>
              <th className="px-4 py-3 text-[11px] font-bold text-ink-soft uppercase">标签</th>
              <th className="px-4 py-3 text-[11px] font-bold text-ink-soft uppercase">推理</th>
              <th className="px-4 py-3 text-[11px] font-bold text-ink-soft uppercase text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {agents.map(agent => (
              <AgentRow
                key={agent.id}
                agent={agent}
                providers={providers}
                availableSkills={skills}
                skillBindings={agentSkillBindings[agent.id] ?? []}
                onSave={onSaveAgent}
                onDeleteRequest={onDeleteRequest}
                saving={saving}
              />
            ))}
          </tbody>
        </table>
      </div>

      {pendingDelete && (
        <ConfirmDeleteDialog
          agent={pendingDelete}
          onConfirm={() => onDeleteConfirm(pendingDelete.id)}
          onCancel={onDeleteCancel}
        />
      )}
    </>
  )
}
