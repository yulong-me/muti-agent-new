'use client'

import { useEffect, useState, useRef } from 'react'
import { X, Bot, Server, CheckCircle2, Trash2, Edit2, Save, Plus, Loader2, Play, XCircle, BrainCircuit } from 'lucide-react'
import { API_URL } from '@/lib/api'
import { mergeAgentModel, normalizeModelValue, resolveEffectiveAgentModel } from '@/lib/agentModels'
import { debug, info, warn } from '@/lib/logger'
import { type SettingsTab } from '../lib/settingsTabs'
import { DirectoryPicker } from './DirectoryPicker'

const API = API_URL;

function fmtErr(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (/did not match the expected pattern/i.test(msg)) {
    return '浏览器拦截了表单校验（pattern）。请禁用扩展或使用无痕窗口重试。'
  }
  return msg || fallback
}

type ProviderName = 'claude-code' | 'opencode'

interface AgentConfig {
  id: string; name: string; roleLabel: string; role: 'MANAGER' | 'WORKER'
  provider: ProviderName; providerOpts: { thinking?: boolean; [k: string]: unknown }
  systemPrompt: string; enabled: boolean; tags: string[]
}

interface SceneConfig {
  id: string; name: string; description?: string; prompt: string; builtin: boolean
  canDelete: boolean; canEditName: boolean; canEditPrompt: boolean
}

interface ProviderConfig {
  name: string; label: string; cliPath: string; defaultModel: string
  apiKey: string; baseUrl: string; timeout: number; thinking: boolean
  lastTested: number | null
  lastTestResult: { success: boolean; cli?: string; output?: string; error?: string } | null
}

interface SkillConfig {
  id: string
  name: string
  description: string
  enabled: boolean
  providerCompat: ProviderName[]
  content: string
  usage: { agentCount: number; roomCount: number }
}

interface SkillBinding {
  skillId: string
  mode: 'auto' | 'required'
  enabled: boolean
  skill: {
    id: string
    name: string
    description: string
  }
}

interface ReadOnlySkill {
  name: string
  description: string
  sourceType: 'global' | 'workspace'
  sourcePath: string
}

const PROVIDER_LABELS: Record<ProviderName, string> = {
  'claude-code': 'Claude Code', 'opencode': 'OpenCode',
}
const PROVIDER_COLORS: Record<ProviderName, string> = {
  'claude-code': 'text-accent bg-accent/10 border-accent/20',
  'opencode': 'text-purple-500 bg-purple-500/10 border-purple-500/20',
}

// ── Agent Row ──────────────────────────────────────────────────────────────────

function AgentRow({ agent, providers, availableSkills, skillBindings, onSave, onDeleteRequest, saving }: {
  agent: AgentConfig
  providers: Record<string, ProviderConfig>
  availableSkills: SkillConfig[]
  skillBindings: SkillBinding[]
  onSave: (a: AgentConfig, bindings: Array<{ skillId: string; mode: 'auto' | 'required'; enabled: boolean }>) => Promise<void>
  onDeleteRequest: (agent: AgentConfig) => void
  saving: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<AgentConfig>(agent)
  const [formSkillBindings, setFormSkillBindings] = useState<Array<{ skillId: string; mode: 'auto' | 'required'; enabled: boolean }>>(
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
  }, [agent, skillBindings, editing])

  function field<K extends keyof AgentConfig>(k: K, v: AgentConfig[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }
  function opt(k: string, v: unknown) {
    setForm(f => ({ ...f, providerOpts: { ...f.providerOpts, [k]: v } }))
  }
  function modelInput(value: string) {
    setForm(f => ({ ...f, providerOpts: mergeAgentModel(f.providerOpts, value) }))
  }
  function toggleSkill(skillId: string, enabled: boolean) {
    setFormSkillBindings(prev => {
      const existing = prev.find(binding => binding.skillId === skillId)
      if (enabled) {
        if (existing) {
          return prev.map(binding => binding.skillId === skillId ? { ...binding, enabled: true } : binding)
        }
        return [...prev, { skillId, mode: 'auto', enabled: true }]
      }
      return prev.filter(binding => binding.skillId !== skillId)
    })
  }
  function setSkillMode(skillId: string, mode: 'auto' | 'required') {
    setFormSkillBindings(prev => prev.map(binding => (
      binding.skillId === skillId ? { ...binding, mode } : binding
    )))
  }
  async function handleSave() {
    setSaveError('')
    try {
      await onSave(form, formSkillBindings)
      setEditing(false); setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveError((err as Error).message || '保存失败')
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
  const pc = PROVIDER_COLORS[agent.provider]
  const effectiveModel = resolveEffectiveAgentModel(agent.provider, agent.providerOpts, providers)
  const formModel = normalizeModelValue(form.providerOpts.model) ?? ''
  const enabledSkillBindings = skillBindings.filter(binding => binding.enabled)

  if (!editing) {
    return (
      <tr className="border-b border-line hover:bg-white/[0.03] transition-colors group">
        <td className="px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[12px] font-bold shadow-sm flex-shrink-0"
              style={{ backgroundColor: isHost ? '#EA580C' : '#4F46E5' }}>
              {agent.name.slice(0, 1)}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-ink text-[13px]">{agent.name}</span>
                {isHost && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 border border-orange-500/20 text-orange-600 font-bold">主持</span>}
              </div>
              <span className="text-[11px] text-ink-soft">{agent.roleLabel}</span>
              {enabledSkillBindings.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {enabledSkillBindings.map(binding => (
                    <span key={binding.skillId} className="text-[10px] px-1.5 py-0.5 rounded-md bg-accent/10 border border-accent/20 text-accent font-semibold">
                      {binding.skill.name}{binding.mode === 'required' ? ' · required' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </td>
        <td className="px-4 py-3.5">
          <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider border ${pc}`}>{agent.provider}</span>
        </td>
        <td className="px-4 py-3.5">
          <span className="text-[11px] text-ink-soft font-mono">{effectiveModel ?? '默认'}</span>
        </td>
        <td className="px-4 py-3.5">
          <div className="flex flex-wrap gap-1">
            {agent.tags.map(t => (
              <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.04] border border-white/10 text-ink-soft">{t}</span>
            ))}
            {agent.tags.length === 0 && <span className="text-[11px] text-ink-soft/40">—</span>}
          </div>
        </td>
        <td className="px-4 py-3.5">
          <span className="text-[11px] text-ink-soft">{agent.providerOpts.thinking !== false ? '🧠' : '—'}</span>
        </td>
        <td className="px-4 py-3.5 text-right">
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {saved && <span className="text-[11px] text-emerald-500 flex items-center gap-1 mr-1" aria-live="polite"><CheckCircle2 className="w-3 h-3" aria-hidden/>已保存</span>}
            {isHost ? <span className="text-[11px] text-ink-soft/40 mr-2">—</span> : (
              <>
                <button type="button" onClick={() => setEditing(true)} aria-label="编辑" className="p-1.5 text-ink-soft hover:text-ink hover:bg-white/5 rounded-md transition-colors"><Edit2 className="w-3.5 h-3.5" aria-hidden/></button>
                <button type="button" onClick={() => onDeleteRequest(agent)} aria-label="删除" className="p-1.5 text-ink-soft hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"><Trash2 className="w-3.5 h-3.5" aria-hidden/></button>
              </>
            )}
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-b border-line bg-white/[0.03]">
      <td colSpan={6} className="px-4 py-4">
        <div className="flex flex-col gap-4">
          <span className="text-[13px] font-bold text-ink">{agent.name} <span className="text-ink-soft font-normal ml-1">编辑中…</span></span>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">Provider</label>
              {(Object.keys(PROVIDER_LABELS) as ProviderName[]).map(p => (
                <label key={p} className="flex items-center gap-1.5 cursor-pointer py-1">
                  <input type="radio" name={`p-${agent.id}`} value={p} checked={form.provider === p}
                    onChange={() => field('provider', p)} className="accent-accent"/>
                  <span className="text-[12px] text-ink">{PROVIDER_LABELS[p]}</span>
                </label>
              ))}
            </div>
            <div>
              <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">标签（逗号分隔）</label>
              <input value={form.tags.join(', ')}
                onChange={e => field('tags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"/>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">模型（可选）</label>
              <input
                value={formModel}
                onChange={e => modelInput(e.target.value)}
                placeholder={providers[form.provider]?.defaultModel || '使用 Provider 默认模型'}
                className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink font-mono focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">推理</label>
              <button type="button" onClick={() => opt('thinking', !form.providerOpts.thinking)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.providerOpts.thinking ? 'bg-accent' : 'bg-white/10'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.providerOpts.thinking ? 'translate-x-6' : 'translate-x-1'}`}/>
              </button>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">角色标签</label>
              <input value={form.roleLabel} onChange={e => field('roleLabel', e.target.value)}
                className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"/>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">System Prompt</label>
            <textarea value={form.systemPrompt} onChange={e => field('systemPrompt', e.target.value)} rows={2}
              className="w-full settings-input rounded-xl px-3 py-2 text-[12px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none font-mono"/>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-soft uppercase mb-2">Default Skills</label>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] divide-y divide-white/[0.06]">
              {availableSkills.length === 0 ? (
                <div className="px-3 py-3 text-[12px] text-ink-soft">还没有 managed skill，先去 Skill 标签里创建。</div>
              ) : availableSkills.map(skill => {
                const binding = formSkillBindings.find(item => item.skillId === skill.id)
                return (
                  <div key={skill.id} className="px-3 py-3 flex items-start justify-between gap-3">
                    <label className="flex items-start gap-2 cursor-pointer flex-1">
                      <input
                        type="checkbox"
                        checked={Boolean(binding)}
                        onChange={e => toggleSkill(skill.id, e.target.checked)}
                        className="mt-0.5 accent-accent"
                      />
                      <span className="min-w-0">
                        <span className="block text-[12px] font-semibold text-ink">{skill.name}</span>
                        <span className="block text-[11px] text-ink-soft">{skill.description || '无描述'}</span>
                      </span>
                    </label>
                    <select
                      value={binding?.mode ?? 'auto'}
                      disabled={!binding}
                      onChange={e => setSkillMode(skill.id, e.target.value as 'auto' | 'required')}
                      className="settings-input rounded-lg px-2 py-1 text-[11px] text-ink disabled:opacity-40"
                    >
                      <option value="auto">auto</option>
                      <option value="required">required</option>
                    </select>
                  </div>
                )
              })}
            </div>
          </div>
          {saveError && <p className="text-[12px] text-red-400 bg-red-500/10 px-3 py-1.5 rounded-xl">{saveError}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={handleCancel} className="px-4 py-1.5 text-[12px] text-ink-soft hover:text-ink hover:bg-white/5 rounded-xl transition-colors">取消</button>
            <button type="button" onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 text-[12px] font-bold bg-ink text-bg rounded-xl hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-1.5">
              <Save className="w-3.5 h-3.5" aria-hidden/> {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </td>
    </tr>
  )
}

// ── Provider Tab ────────────────────────────────────────────────────────────────

function ProviderDetail({ provider, onUpdate }: { provider: ProviderConfig; onUpdate?: (p: ProviderConfig) => void }) {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState(provider.lastTestResult)
  const [editing, setEditing] = useState(false)
  const [editCliPath, setEditCliPath] = useState(provider.cliPath)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => { setResult(provider.lastTestResult) }, [provider])
  useEffect(() => { setEditCliPath(provider.cliPath) }, [provider])

  function handleTest() {
    setTesting(true)
    info('ui:settings:provider_test', { provider: provider.name })
    fetch(`${API}/api/providers/${provider.name}/test`, { method: 'POST' })
      .then(r => r.json())
      .then((r: ProviderConfig['lastTestResult']) => {
        debug('ui:settings:provider_test_result', {
          provider: provider.name,
          success: Boolean(r?.success),
        })
        setResult(r)
        setTesting(false)
      })
      .catch(e => {
        warn('ui:settings:provider_test_failed', { provider: provider.name, error: e })
        setResult({ success: false, error: e.message })
        setTesting(false)
      })
  }

  async function handleSave() {
    setSaveError('')
    setSaving(true)
    try {
      const res = await fetch(`${API}/api/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: provider.name,
          label: provider.label,
          cliPath: editCliPath,
          defaultModel: provider.defaultModel,
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl,
          timeout: provider.timeout,
          thinking: provider.thinking,
        }),
      })
      const updated = await res.json() as ProviderConfig
      if (!res.ok) throw new Error(updated.lastTestResult?.error || '保存失败')
      onUpdate?.(updated)
      setResult(null)
      setEditing(false)
      info('ui:settings:provider_saved', { provider: provider.name })
    } catch (err) {
      warn('ui:settings:provider_save_failed', { provider: provider.name, error: err })
      setSaveError((err as Error).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    setEditing(false)
    setEditCliPath(provider.cliPath)
    setSaveError('')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[14px] font-bold shadow-sm"
          style={{ backgroundColor: provider.name === 'claude-code' ? '#0071E3' : '#7C3AED' }}>
          {provider.label.slice(0, 1)}
        </div>
        <div>
          <p className="text-[14px] font-bold text-ink">{provider.label}</p>
          <p className="text-[11px] text-ink-soft font-mono">{provider.name}</p>
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[11px] font-bold text-ink-soft uppercase">CLI 路径</p>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[11px] text-accent hover:text-accent transition-colors"
            >
              <Edit2 className="w-3 h-3" aria-hidden/> 编辑
            </button>
          )}
        </div>
        {editing ? (
          <div className="space-y-2">
            <input
              type="text"
              value={editCliPath}
              onChange={e => setEditCliPath(e.target.value)}
              placeholder="claude"
              className="w-full settings-input rounded-xl px-3 py-2 text-[12px] text-ink font-mono focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            {saveError && <p className="text-[11px] text-red-400">{saveError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                className="flex-1 py-1.5 text-[12px] text-ink-soft hover:text-ink hover:bg-white/5 rounded-xl transition-colors flex items-center justify-center gap-1"
              >
                <XCircle className="w-3.5 h-3.5" aria-hidden/> 取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || editCliPath === provider.cliPath}
                className="flex-1 py-1.5 text-[12px] font-bold bg-accent text-white rounded-xl hover:bg-accent-deep disabled:opacity-50 transition-all flex items-center justify-center gap-1"
              >
                <Save className="w-3.5 h-3.5" aria-hidden/> {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-ink font-mono settings-input rounded-xl px-3 py-2">{provider.cliPath}</p>
        )}
      </div>
      <button type="button" onClick={handleTest} disabled={testing}
        className="w-full py-2.5 text-[13px] bg-ink text-bg rounded-xl hover:opacity-90 disabled:opacity-50 transition-all font-bold flex items-center justify-center gap-2">
        {testing ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden/>测试中…</> : <><Play className="w-4 h-4 fill-current" aria-hidden/>{result ? '重新测试' : '测试连接'}</>}
      </button>
      {result && (
        <div className="border border-line rounded-xl overflow-hidden">
          <div className="bg-[#1e1e1e] px-4 py-2 font-mono text-[11px] text-gray-400 border-b border-[#333] flex items-center gap-2">
            {result.success ? <CheckCircle2 className="w-3 h-3 text-emerald-400"/> : <X className="w-3 h-3 text-red-400"/>}
            命令
          </div>
          {result.cli && <div className="bg-[#1e1e1e] px-4 py-2.5 font-mono text-[12px] text-emerald-400 whitespace-pre-wrap break-all" aria-label="执行的命令">{result.cli}</div>}
          {result.error && <div className="bg-[#1e1e1e] px-4 py-2.5 font-mono text-[12px] text-red-400 whitespace-pre-wrap break-all" aria-label="错误信息">{result.error}</div>}
          {result.output && <div className="bg-[#1e1e1e] px-4 py-2.5 font-mono text-[12px] text-emerald-300/80 whitespace-pre-wrap break-all border-t border-[#333] max-h-48 overflow-y-auto" aria-label="命令输出">{result.output}</div>}
        </div>
      )}
    </div>
  )
}

// ── Scene Create Form ─────────────────────────────────────────────────────────

function SceneCreateForm({ onCreated }: { onCreated: (s: SceneConfig) => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', prompt: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function handleCreate() {
    if (!form.name.trim()) { setError('名称必填'); return }
    if (!form.prompt.trim()) { setError('Prompt模板必填'); return }
    setSaving(true)
    info('ui:settings:scene_create', { name: form.name.trim() })
    fetch(`${API}/api/scenes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }).then(r => {
      if (!r.ok) return r.json().then(err => { throw new Error(err.error || `HTTP ${r.status}`) })
      return r.json()
    }).then(s => {
      onCreated(s)
      setForm({ name: '', description: '', prompt: '' })
      setOpen(false)
      setError('')
      info('ui:settings:scene_create_success', { sceneId: s.id, name: s.name })
    }).catch(e => {
      warn('ui:settings:scene_create_failed', { name: form.name.trim(), error: e })
      setError(fmtErr(e, '创建失败'))
    }).finally(() => { setSaving(false) })
  }

  return (
    <div className="settings-surface rounded-xl p-5">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}
          className="w-full py-3 text-[13px] font-bold text-ink-soft border border-dashed border-white/10 rounded-xl hover:border-accent/50 hover:text-accent transition-colors flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" aria-hidden/>新建场景
        </button>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] font-bold text-ink flex items-center gap-1.5"><Plus className="w-4 h-4 text-accent" aria-hidden/>新建场景</p>
          <div>
            <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">名称</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="我的自定义场景"
              autoComplete="off"
              className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-ink-soft/40"/>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">描述（可选）</label>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="简短描述该场景的用途…"
              autoComplete="off"
              className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-ink-soft/40"/>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">Prompt 模板</label>
            <textarea value={form.prompt} onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))} rows={4}
              placeholder="【场景模式：xxx】&#10;定义该场景下所有 agent 的行为约束…"
              autoComplete="off"
              className="w-full settings-input rounded-xl px-3 py-2 text-[12px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none font-mono placeholder:text-ink-soft/40"/>
          </div>
          {error && <p className="text-[12px] text-red-400 bg-red-500/10 px-3 py-1.5 rounded-xl">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setOpen(false); setError('') }} className="px-4 py-1.5 text-[12px] text-ink-soft hover:text-ink hover:bg-white/5 rounded-xl transition-colors">取消</button>
            <button type="button" onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 text-[12px] font-bold bg-accent text-white rounded-xl hover:bg-accent-deep disabled:opacity-50 transition-all flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" aria-hidden/>{saving ? '创建中…' : '创建'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Scene Row ─────────────────────────────────────────────────────────────────

function SceneRow({ scene, onUpdate, onDelete }: {
  scene: SceneConfig;
  onUpdate: (s: SceneConfig) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: scene.name, description: scene.description ?? '', prompt: scene.prompt })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { if (!editing) setForm({ name: scene.name, description: scene.description ?? '', prompt: scene.prompt }) }, [scene, editing])

  async function handleSave() {
    setSaveError('')
    setSaving(true)
    try {
      // Builtin scenes: omit name from payload (backend rejects renaming builtin)
      const payload: Record<string, string> = { description: form.description, prompt: form.prompt };
      if (canEditName) payload.name = form.name;
      const res = await fetch(`${API}/api/scenes/${encodeURIComponent(scene.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || '保存失败')
      }
      const updated = await res.json() as SceneConfig
      onUpdate(updated)
      setEditing(false)
      info('ui:settings:scene_saved', { sceneId: scene.id, name: updated.name })
    } catch (err) {
      warn('ui:settings:scene_save_failed', { sceneId: scene.id, error: err })
      setSaveError(fmtErr(err, '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`${API}/api/scenes/${encodeURIComponent(scene.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || '删除失败')
      }
      onDelete(scene.id)
      info('ui:settings:scene_deleted', { sceneId: scene.id, name: scene.name })
    } catch (err) {
      warn('ui:settings:scene_delete_failed', { sceneId: scene.id, error: err })
      alert(fmtErr(err, '删除失败'))
      setDeleting(false)
    }
  }

  const canEditName = scene.canEditName && !scene.builtin
  const canDelete = scene.canDelete && !scene.builtin

  return (
    <div className="settings-surface rounded-xl p-5">
      {editing ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] font-bold text-ink">编辑场景 <span className="text-ink-soft font-normal ml-1">编辑中…</span></p>
          {canEditName && (
            <div>
              <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">名称</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                autoComplete="off"
                className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"/>
            </div>
          )}
          <div>
            <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">描述</label>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              autoComplete="off"
              className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"/>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">Prompt 模板</label>
            <textarea value={form.prompt} onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))} rows={4}
              autoComplete="off"
              className="w-full settings-input rounded-xl px-3 py-2 text-[12px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none font-mono"/>
          </div>
          {saveError && <p className="text-[12px] text-red-400 bg-red-500/10 px-3 py-1.5 rounded-xl">{saveError}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setEditing(false)} className="px-4 py-1.5 text-[12px] text-ink-soft hover:text-ink hover:bg-white/5 rounded-xl transition-colors">取消</button>
            <button type="button" onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 text-[12px] font-bold bg-accent text-white rounded-xl hover:bg-accent-deep disabled:opacity-50 transition-all flex items-center gap-1.5">
              <Save className="w-3.5 h-3.5" aria-hidden/> {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                <BrainCircuit className="w-4 h-4 text-accent" aria-hidden/>
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-[14px] font-bold text-ink">{scene.name}</p>
                  {scene.builtin && <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 border border-accent/20 text-accent font-bold">内置</span>}
                </div>
                {scene.description && <p className="text-[11px] text-ink-soft mt-0.5">{scene.description}</p>}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setEditing(true)} aria-label="编辑" className="p-1.5 text-ink-soft hover:text-ink hover:bg-white/5 rounded-md transition-colors">
                <Edit2 className="w-3.5 h-3.5" aria-hidden/>
              </button>
              {canDelete && (
                <button type="button" onClick={handleDelete} disabled={deleting} aria-label="删除" className="p-1.5 text-ink-soft hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors">
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden/> : <Trash2 className="w-3.5 h-3.5" aria-hidden/>}
                </button>
              )}
            </div>
          </div>
          <div className="bg-white/[0.03] rounded-xl px-3 py-2 border border-white/[0.05]">
            <p className="text-[10px] font-bold text-ink-soft uppercase mb-1">Prompt</p>
            <p className="text-[11px] text-ink font-mono whitespace-pre-wrap">{scene.prompt.slice(0, 120)}{scene.prompt.length > 120 ? '…' : ''}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function SkillCreateForm({ onCreated }: { onCreated: (skill: SkillConfig) => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', content: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate() {
    if (!form.name.trim()) { setError('名称必填'); return }
    setSaving(true)
    setError('')
    info('ui:settings:skill_create', { name: form.name.trim() })
    try {
      const res = await fetch(`${API}/api/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || '创建失败')
      }
      const created = await res.json() as SkillConfig
      onCreated(created)
      setForm({ name: '', description: '', content: '' })
      setOpen(false)
      info('ui:settings:skill_create_success', { name: created.name })
    } catch (err) {
      warn('ui:settings:skill_create_failed', { name: form.name.trim(), error: err })
      setError(fmtErr(err, '创建失败'))
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full py-3 text-[13px] font-bold text-ink-soft border border-dashed border-white/10 rounded-xl hover:border-accent/50 hover:text-accent transition-colors flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" aria-hidden/>手动创建
      </button>
    )
  }

  return (
    <div className="settings-surface rounded-xl p-5 space-y-3">
      <p className="text-[13px] font-bold text-ink flex items-center gap-1.5"><BrainCircuit className="w-4 h-4 text-accent" aria-hidden/>手动创建 Skill</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">名称</label>
          <input
            value={form.name}
            onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder="request-review"
            className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">描述</label>
          <input
            value={form.description}
            onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
            placeholder="什么时候该使用这个 skill"
            className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">SKILL.md</label>
        <textarea
          value={form.content}
          onChange={e => setForm(prev => ({ ...prev, content: e.target.value }))}
          rows={8}
          placeholder="留空则自动生成基础模板"
          className="w-full settings-input rounded-xl px-3 py-2 text-[12px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none font-mono"
        />
      </div>
      {error && <p className="text-[12px] text-red-400 bg-red-500/10 px-3 py-1.5 rounded-xl">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={() => setOpen(false)} className="px-4 py-1.5 text-[12px] text-ink-soft hover:text-ink hover:bg-white/5 rounded-xl transition-colors">取消</button>
        <button type="button" onClick={handleCreate} disabled={saving} className="px-4 py-1.5 text-[12px] font-bold bg-accent text-white rounded-xl hover:bg-accent-deep disabled:opacity-50 transition-all flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" aria-hidden/>{saving ? '创建中…' : '创建'}
        </button>
      </div>
    </div>
  )
}

function SkillImportForm({ onImported }: { onImported: (skill: SkillConfig) => void }) {
  const [open, setOpen] = useState(false)
  const [sourcePath, setSourcePath] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleImport() {
    if (!sourcePath.trim()) {
      setError('请选择一个 skill 文件夹')
      return
    }
    setSaving(true)
    setError('')
    info('ui:settings:skill_import', { sourcePath: sourcePath.trim() })
    try {
      const res = await fetch(`${API}/api/skills/import-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath: sourcePath.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || '导入失败')
      }
      const imported = await res.json() as SkillConfig
      onImported(imported)
      setSourcePath('')
      setOpen(false)
      info('ui:settings:skill_import_success', { name: imported.name, sourcePath: sourcePath.trim() })
    } catch (err) {
      warn('ui:settings:skill_import_failed', { sourcePath: sourcePath.trim(), error: err })
      setError(fmtErr(err, '导入失败'))
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full py-3 text-[13px] font-bold text-ink-soft border border-dashed border-white/10 rounded-xl hover:border-accent/50 hover:text-accent transition-colors flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" aria-hidden/>导入文件夹
      </button>
    )
  }

  return (
    <div className="settings-surface rounded-xl p-5 space-y-3">
      <p className="text-[13px] font-bold text-ink flex items-center gap-1.5"><Plus className="w-4 h-4 text-accent" aria-hidden/>导入 Skill 文件夹</p>
      <DirectoryPicker
        value={sourcePath}
        onChange={setSourcePath}
        inputLabel="Skill 文件夹路径"
        placeholder="/Users/.../my-skill"
      />
      <p className="text-[11px] text-ink-soft">选择包含 `SKILL.md` 的 skill bundle 目录，系统会把整个文件夹导入为 managed skill。</p>
      {error && <p className="text-[12px] text-red-400 bg-red-500/10 px-3 py-1.5 rounded-xl">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={() => setOpen(false)} className="px-4 py-1.5 text-[12px] text-ink-soft hover:text-ink hover:bg-white/5 rounded-xl transition-colors">取消</button>
        <button type="button" onClick={handleImport} disabled={saving} className="px-4 py-1.5 text-[12px] font-bold bg-accent text-white rounded-xl hover:bg-accent-deep disabled:opacity-50 transition-all flex items-center gap-1.5">
          <Save className="w-3.5 h-3.5" aria-hidden/>{saving ? '导入中…' : '导入'}
        </button>
      </div>
    </div>
  )
}

function SkillRow({ skill, onUpdate, onDelete }: {
  skill: SkillConfig
  onUpdate: (skill: SkillConfig) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    description: skill.description,
    content: skill.content,
    enabled: skill.enabled,
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!editing) {
      setForm({
        description: skill.description,
        content: skill.content,
        enabled: skill.enabled,
      })
    }
  }, [skill, editing])

  async function handleSave() {
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch(`${API}/api/skills/${encodeURIComponent(skill.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || '保存失败')
      }
      const updated = await res.json() as SkillConfig
      onUpdate(updated)
      setEditing(false)
      info('ui:settings:skill_saved', { name: skill.name, enabled: updated.enabled })
    } catch (err) {
      warn('ui:settings:skill_save_failed', { name: skill.name, error: err })
      setSaveError(fmtErr(err, '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`${API}/api/skills/${encodeURIComponent(skill.name)}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || '删除失败')
      }
      onDelete(skill.id)
      info('ui:settings:skill_deleted', { name: skill.name })
    } catch (err) {
      warn('ui:settings:skill_delete_failed', { name: skill.name, error: err })
      alert(fmtErr(err, '删除失败'))
      setDeleting(false)
    }
  }

  return (
    <div className="settings-surface rounded-xl p-5">
      {editing ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-bold text-ink">{skill.name}</p>
            <label className="flex items-center gap-2 text-[11px] text-ink-soft">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={e => setForm(prev => ({ ...prev, enabled: e.target.checked }))}
                className="accent-accent"
              />
              启用
            </label>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">描述</label>
            <input
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">SKILL.md</label>
            <textarea
              value={form.content}
              onChange={e => setForm(prev => ({ ...prev, content: e.target.value }))}
              rows={10}
              className="w-full settings-input rounded-xl px-3 py-2 text-[12px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none font-mono"
            />
          </div>
          {saveError && <p className="text-[12px] text-red-400 bg-red-500/10 px-3 py-1.5 rounded-xl">{saveError}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setEditing(false)} className="px-4 py-1.5 text-[12px] text-ink-soft hover:text-ink hover:bg-white/5 rounded-xl transition-colors">取消</button>
            <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-[12px] font-bold bg-accent text-white rounded-xl hover:bg-accent-deep disabled:opacity-50 transition-all flex items-center gap-1.5">
              <Save className="w-3.5 h-3.5" aria-hidden/>{saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-[14px] font-bold text-ink">{skill.name}</p>
                {!skill.enabled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.08] text-ink-soft font-bold">停用</span>}
              </div>
              <p className="text-[11px] text-ink-soft mt-0.5">{skill.description || '无描述'}</p>
              <p className="text-[10px] text-ink-soft/70 mt-1">绑定：Agent {skill.usage.agentCount} / Room {skill.usage.roomCount}</p>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setEditing(true)} aria-label="编辑" className="p-1.5 text-ink-soft hover:text-ink hover:bg-white/5 rounded-md transition-colors">
                <Edit2 className="w-3.5 h-3.5" aria-hidden/>
              </button>
              <button type="button" onClick={handleDelete} disabled={deleting} aria-label="删除" className="p-1.5 text-ink-soft hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors">
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden/> : <Trash2 className="w-3.5 h-3.5" aria-hidden/>}
              </button>
            </div>
          </div>
          <div className="bg-white/[0.03] rounded-xl px-3 py-2 border border-white/[0.05]">
            <p className="text-[10px] font-bold text-ink-soft uppercase mb-1">Preview</p>
            <p className="text-[11px] text-ink font-mono whitespace-pre-wrap">{skill.content.slice(0, 180)}{skill.content.length > 180 ? '…' : ''}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export default function SettingsModal({ isOpen, onClose, initialTab = 'agent' }: { isOpen: boolean; onClose: () => void; initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [agents, setAgents] = useState<AgentConfig[]>([])
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({})
  const [scenes, setScenes] = useState<SceneConfig[]>([])
  const [skills, setSkills] = useState<SkillConfig[]>([])
  const [globalSkills, setGlobalSkills] = useState<ReadOnlySkill[]>([])
  const [agentSkillBindings, setAgentSkillBindings] = useState<Record<string, SkillBinding[]>>({})
  const [selProvider, setSelProvider] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<AgentConfig | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState({
    id: '',
    name: '',
    roleLabel: '',
    provider: 'claude-code' as ProviderName,
    model: '',
    systemPrompt: '',
    tags: [] as string[],
  })
  const [addError, setAddError] = useState('')
  const backdropRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return
    setTab(initialTab)
  }, [initialTab, isOpen])

  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    debug('ui:settings:load_start', { tab: initialTab })
    Promise.all([
      fetch(`${API}/api/agents`).then(r => r.json()),
      fetch(`${API}/api/providers`).then(r => r.json()),
      fetch(`${API}/api/scenes`).then(r => r.json()),
      fetch(`${API}/api/skills`).then(r => r.json()),
      fetch(`${API}/api/skills/global`).then(r => r.json()).catch(() => []),
    ]).then(async ([ag, pr, sc, sk, gl]) => {
      setAgents(ag)
      setProviders(pr)
      setScenes(sc)
      setSkills(sk)
      setGlobalSkills(gl)
      const bindingEntries = await Promise.all(
        (ag as AgentConfig[]).map(async agent => {
          try {
            const res = await fetch(`${API}/api/agents/${agent.id}/skills`)
            return [agent.id, res.ok ? await res.json() as SkillBinding[] : []] as const
          } catch {
            return [agent.id, []] as const
          }
        }),
      )
      setAgentSkillBindings(Object.fromEntries(bindingEntries))
      if (!selProvider && Object.keys(pr).length > 0) setSelProvider(Object.keys(pr)[0])
      debug('ui:settings:load_success', {
        agentCount: ag.length,
        providerCount: Object.keys(pr).length,
        sceneCount: sc.length,
        skillCount: sk.length,
        globalSkillCount: gl.length,
      })
      setLoading(false)
    }).catch((err) => {
      warn('ui:settings:load_failed', { error: err })
      setLoading(false)
    })
  }, [isOpen])

  function handleAgentSave(updated: AgentConfig, bindings: Array<{ skillId: string; mode: 'auto' | 'required'; enabled: boolean }>): Promise<void> {
    setSaving(true)
    info('ui:settings:agent_save', { agentId: updated.id, bindingCount: bindings.length })
    return fetch(`${API}/api/agents/${updated.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      .then(async res => {
        const a = await res.json() as AgentConfig & {error?: string}
        if (!res.ok) throw new Error(a.error ?? '保存失败')
        const bindingsRes = await fetch(`${API}/api/agents/${updated.id}/skills`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bindings }),
        })
        const nextBindings = await bindingsRes.json().catch(() => []) as SkillBinding[] & { error?: string }
        if (!bindingsRes.ok) throw new Error((nextBindings as { error?: string }).error ?? 'Skill 保存失败')
        setAgents(prev => prev.map(x => x.id === a.id ? a : x))
        setAgentSkillBindings(prev => ({ ...prev, [updated.id]: Array.isArray(nextBindings) ? nextBindings : [] }))
        info('ui:settings:agent_save_success', { agentId: updated.id, bindingCount: bindings.length })
        setSaving(false)
      }).catch(e => {
        warn('ui:settings:agent_save_failed', { agentId: updated.id, error: e })
        setSaving(false)
        throw e
      })
  }
  function handleAgentDelete(id: string) {
    info('ui:settings:agent_delete', { agentId: id })
    fetch(`${API}/api/agents/${id}`, { method: 'DELETE' })
      .then(r => {
        if (!r.ok) {
          warn('ui:settings:agent_delete_failed', { agentId: id, status: r.status })
          return
        }
        setAgents(prev => prev.filter(a => a.id !== id))
        setAgentSkillBindings(prev => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        info('ui:settings:agent_delete_success', { agentId: id })
      })
      .catch((err) => {
        warn('ui:settings:agent_delete_failed', { agentId: id, error: err })
      })
  }
  function ConfirmDeleteDialog({ agent, onConfirm, onCancel }: { agent: AgentConfig; onConfirm: () => void; onCancel: () => void }) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-xl -webkit-backdrop-blur-xl">
        <div className="settings-surface rounded-2xl shadow-2xl p-6 w-full max-w-xs mx-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
              <Trash2 className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-ink">确认删除</h3>
              <p className="text-[12px] text-ink-soft">此操作不可恢复</p>
            </div>
          </div>
          <p className="text-[13px] text-ink mb-5">确定要删除 Agent <span className="font-bold">{agent.name}</span> 吗？</p>
          <div className="flex gap-3">
            <button type="button" onClick={onCancel} className="flex-1 px-4 py-2 text-[13px] font-medium text-ink-soft hover:text-ink hover:bg-white/5 rounded-xl transition-colors">取消</button>
            <button type="button" onClick={onConfirm} className="flex-1 px-4 py-2 text-[13px] font-bold bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors">删除</button>
          </div>
        </div>
      </div>
    )
  }
  function handleAddAgent() {
    if (!addForm.id || !addForm.name) { setAddError('ID 和名称必填'); return }
    setSaving(true)
    info('ui:settings:agent_create', { agentId: addForm.id, provider: addForm.provider })
    fetch(`${API}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: addForm.id,
        name: addForm.name,
        roleLabel: addForm.roleLabel,
        provider: addForm.provider,
        role: 'WORKER',
        providerOpts: mergeAgentModel({ thinking: true }, addForm.model),
        systemPrompt: addForm.systemPrompt,
        tags: addForm.tags,
        enabled: true,
      }),
    })
      .then(r => {
        if (!r.ok) return r.json().then(err => { throw new Error(err.error || `HTTP ${r.status}`) })
        return r.json()
      })
      .then(a => {
        info('ui:settings:agent_create_success', { agentId: a.id, provider: a.provider })
        setAgents(prev => [...prev, a]); setAgentSkillBindings(prev => ({ ...prev, [a.id]: [] })); setAddForm({ id: '', name: '', roleLabel: '', provider: 'claude-code', model: '', systemPrompt: '', tags: [] }); setAddOpen(false); setAddError(''); setSaving(false)
      })
      .catch(e => {
        warn('ui:settings:agent_create_failed', { agentId: addForm.id, error: e })
        setAddError(e.message); setSaving(false)
      })
  }

  if (!isOpen) return null

  const currentProvider = selProvider ? providers[selProvider] : null

  return (
    <>
      <button type="button" ref={backdropRef} aria-label="关闭" className="fixed inset-0 bg-black/60 backdrop-blur-xl -webkit-backdrop-blur-xl z-40 transition-opacity cursor-default" onClick={onClose}/>
      <div className="fixed inset-0 z-50 flex justify-end">
        <div className="w-full md:w-[640px] h-full settings-panel relative flex flex-col animate-in slide-in-from-right duration-300">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] settings-nav shrink-0">
            <div className="flex gap-1 settings-surface rounded-xl p-1">
              <button type="button" onClick={() => setTab('agent')}
                className={`px-4 py-1.5 rounded-lg text-[12px] font-bold transition-all flex items-center gap-1.5 ${tab === 'agent' ? 'shadow-sm text-ink' : 'text-ink-soft hover:text-ink'}`}>
                <Bot className="w-3.5 h-3.5" aria-hidden/>Agent
              </button>
              <button type="button" onClick={() => setTab('provider')}
                className={`px-4 py-1.5 rounded-lg text-[12px] font-bold transition-all flex items-center gap-1.5 ${tab === 'provider' ? 'shadow-sm text-ink' : 'text-ink-soft hover:text-ink'}`}>
                <Server className="w-3.5 h-3.5" aria-hidden/>CLI 连接
              </button>
              <button type="button" onClick={() => setTab('scene')}
                className={`px-4 py-1.5 rounded-lg text-[12px] font-bold transition-all flex items-center gap-1.5 ${tab === 'scene' ? 'shadow-sm text-ink' : 'text-ink-soft hover:text-ink'}`}>
                <BrainCircuit className="w-3.5 h-3.5" aria-hidden/>场景
              </button>
              <button type="button" onClick={() => setTab('skill')}
                className={`px-4 py-1.5 rounded-lg text-[12px] font-bold transition-all flex items-center gap-1.5 ${tab === 'skill' ? 'shadow-sm text-ink' : 'text-ink-soft hover:text-ink'}`}>
                <BrainCircuit className="w-3.5 h-3.5" aria-hidden/>Skill
              </button>
            </div>
            <button type="button" onClick={onClose} aria-label="关闭设置" className="p-2 text-ink-soft hover:text-ink hover:bg-white/[0.06] rounded-full transition-colors">
              <X className="w-4 h-4" aria-hidden/>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 custom-scrollbar space-y-4">
            {loading ? (
              <div className="flex justify-center items-center h-40"><span className="text-ink-soft text-[13px] animate-pulse">加载中…</span></div>
            ) : tab === 'agent' ? (
              <>
                {/* Add form — above table */}
                {addOpen ? (
                  <div className="settings-surface rounded-xl p-5 space-y-3">
                    <p className="text-[13px] font-bold text-ink flex items-center gap-1.5"><Plus className="w-4 h-4 text-accent" aria-hidden/>新增 Agent</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="add-agent-id" className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">ID</label>
                        <input id="add-agent-id" value={addForm.id} onChange={e => setAddForm(f => ({ ...f, id: e.target.value }))}
                          className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-ink-soft/40" placeholder="my-agent"/>
                      </div>
                      <div>
                        <label htmlFor="add-agent-name" className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">名称</label>
                        <input id="add-agent-name" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                          className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-ink-soft/40" placeholder="小明"/>
                      </div>
                      <div>
                        <label htmlFor="add-agent-role" className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">角色标签</label>
                        <input id="add-agent-role" value={addForm.roleLabel} onChange={e => setAddForm(f => ({ ...f, roleLabel: e.target.value }))}
                          className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-ink-soft/40" placeholder="研究员"/>
                      </div>
                      <div>
                        <label htmlFor="add-agent-provider" className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">Provider</label>
                        <select id="add-agent-provider" value={addForm.provider} onChange={e => setAddForm(f => ({ ...f, provider: e.target.value as ProviderName }))}
                          className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none">
                          {(Object.keys(PROVIDER_LABELS) as ProviderName[]).map(p => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="add-agent-model" className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">模型（可选）</label>
                        <input id="add-agent-model" value={addForm.model} onChange={e => setAddForm(f => ({ ...f, model: e.target.value }))}
                          className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink font-mono focus:outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-ink-soft/40"
                          placeholder={providers[addForm.provider]?.defaultModel || '使用 Provider 默认模型'}/>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="add-agent-prompt" className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">System Prompt</label>
                      <textarea id="add-agent-prompt" value={addForm.systemPrompt} onChange={e => setAddForm(f => ({ ...f, systemPrompt: e.target.value }))} rows={2}
                        className="w-full settings-input rounded-xl px-3 py-2 text-[12px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none font-mono"/>
                    </div>
                    {addError && <p className="text-[12px] text-red-400 bg-red-500/10 px-3 py-1.5 rounded-xl">{addError}</p>}
                    <div className="flex gap-2 justify-end">
                      <button type="button" onClick={() => setAddOpen(false)} className="px-4 py-1.5 text-[12px] text-ink-soft hover:text-ink hover:bg-white/5 rounded-xl transition-colors">取消</button>
                      <button type="button" onClick={handleAddAgent} disabled={saving}
                        className="px-4 py-1.5 text-[12px] font-bold bg-accent text-white rounded-xl hover:bg-accent-deep disabled:opacity-50 transition-all flex items-center gap-1.5">
                        <Plus className="w-3.5 h-3.5" aria-hidden/>{saving ? '创建中…' : '创建'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setAddOpen(true)}
                    className="w-full py-3 text-[13px] font-bold text-ink-soft border border-dashed border-white/10 rounded-xl hover:border-accent/50 hover:text-accent transition-colors flex items-center justify-center gap-2">
                    <Plus className="w-4 h-4" aria-hidden/>新增 Agent
                  </button>
                )}

                {/* Table */}
                <div className="settings-surface rounded-xl overflow-hidden">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-line bg-white/[0.02]">
                        <th className="px-4 py-3 text-[11px] font-bold text-ink-soft uppercase">名称</th>
                        <th className="px-4 py-3 text-[11px] font-bold text-ink-soft uppercase">Provider</th>
                        <th className="px-4 py-3 text-[11px] font-bold text-ink-soft uppercase">模型</th>
                        <th className="px-4 py-3 text-[11px] font-bold text-ink-soft uppercase">标签</th>
                        <th className="px-4 py-3 text-[11px] font-bold text-ink-soft uppercase">推理</th>
                        <th className="px-4 py-3 text-[11px] font-bold text-ink-soft uppercase text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agents.map(a => (
                        <AgentRow
                          key={a.id}
                          agent={a}
                          providers={providers}
                          availableSkills={skills}
                          skillBindings={agentSkillBindings[a.id] ?? []}
                          onSave={handleAgentSave}
                          onDeleteRequest={setPendingDelete}
                          saving={saving}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : tab === 'skill' ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <SkillCreateForm onCreated={(skill) => setSkills(prev => [skill, ...prev])} />
                  <SkillImportForm onImported={(skill) => setSkills(prev => [skill, ...prev])} />
                </div>
                <div className="space-y-3">
                  {skills.length === 0 ? (
                    <div className="settings-surface rounded-xl p-5 text-[12px] text-ink-soft">还没有 managed skills。创建后就可以给 Agent 和 Room 绑定。</div>
                  ) : skills.map(skill => (
                    <SkillRow
                      key={skill.id}
                      skill={skill}
                      onUpdate={(updated) => setSkills(prev => prev.map(item => item.id === updated.id ? updated : item))}
                      onDelete={(id) => setSkills(prev => prev.filter(item => item.id !== id))}
                    />
                  ))}
                </div>
                <div className="settings-surface rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <BrainCircuit className="w-4 h-4 text-accent" aria-hidden />
                    <p className="text-[13px] font-bold text-ink">系统全局 Skills（只读）</p>
                  </div>
                  {globalSkills.length === 0 ? (
                    <p className="text-[12px] text-ink-soft">当前没有发现 `~/.claude/skills`、`~/.config/opencode/skills`、`~/.agents/skills` 下的全局 skills。</p>
                  ) : (
                    <div className="space-y-2">
                      {globalSkills.map(skill => (
                        <div key={`${skill.name}:${skill.sourcePath}`} className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-semibold text-ink">{skill.name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.08] text-ink-soft font-bold uppercase">{skill.sourceType}</span>
                          </div>
                          <p className="mt-1 text-[11px] text-ink-soft">{skill.description || '无描述'}</p>
                          <p className="mt-1 text-[10px] text-ink-soft/70 font-mono break-all">{skill.sourcePath}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : tab === 'scene' ? (
              <>
                {/* New Scene */}
                <SceneCreateForm onCreated={(s) => setScenes(prev => [...prev, s])}/>
                {/* Scene list */}
                <div className="flex flex-col gap-3">
                  {scenes.map(scene => (
                    <SceneRow key={scene.id} scene={scene} onUpdate={(updated) => setScenes(prev => prev.map(s => s.id === updated.id ? updated : s))} onDelete={(id) => setScenes(prev => prev.filter(s => s.id !== id))}/>
                  ))}
                </div>
              </>
            ) : (
              <>
                {/* Provider list */}
                <div className="flex flex-col gap-2">
                  {Object.values(providers).map(p => (
                    <button type="button" key={p.name} onClick={() => setSelProvider(p.name)}
                      className={`w-full text-left px-4 py-3 rounded-xl transition-all flex items-center gap-3 ${selProvider === p.name ? 'settings-surface border-2 border-accent shadow-sm' : 'settings-surface border-2 border-transparent hover:border-white/15'}`}>
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.name === 'claude-code' ? '#0071E3' : '#7C3AED' }}/>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-ink truncate">{p.label}</p>
                        <p className="text-[11px] text-ink-soft font-mono truncate">{p.name}</p>
                      </div>
                      {p.lastTestResult && (p.lastTestResult.success
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" aria-hidden/>
                        : <X className="w-4 h-4 text-red-400 flex-shrink-0" aria-hidden/>)}
                    </button>
                  ))}
                </div>
                {/* Provider detail */}
                {currentProvider && (
                  <div className="settings-surface rounded-xl p-5">
                    <ProviderDetail
                      provider={currentProvider}
                      onUpdate={(updated) => setProviders(prev => ({ ...prev, [updated.name]: updated }))}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDeleteDialog
          agent={pendingDelete}
          onConfirm={() => { handleAgentDelete(pendingDelete.id); setPendingDelete(null) }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  )
}
