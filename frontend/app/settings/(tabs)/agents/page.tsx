'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Edit2, Trash2, CheckCircle2, ChevronLeft, Save, X, Plus } from 'lucide-react'

const API = 'http://localhost:7001'

type ProviderName = 'claude-code' | 'opencode'

interface AgentConfig {
  id: string
  name: string
  roleLabel: string
  role: 'MANAGER' | 'WORKER'
  provider: ProviderName
  providerOpts: {
    thinking?: boolean
    [key: string]: unknown
  }
  systemPrompt: string
  enabled: boolean
  tags: string[]
}

const PROVIDER_LABELS: Record<ProviderName, string> = {
  'claude-code': 'Claude Code',
  'opencode': 'OpenCode',
}

const PROVIDER_COLORS: Record<ProviderName, string> = {
  'claude-code': 'text-accent bg-accent/10 border-accent/20',
  'opencode': 'text-purple-500 bg-purple-500/10 border-purple-500/20',
}

// ── Inline edit row ─────────────────────────────────────────────────────────

function AgentRow({
  agent,
  onSave,
  onDelete,
  saving,
}: {
  agent: AgentConfig
  onSave: (updated: AgentConfig) => void
  onDelete: (id: string) => void
  saving: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<AgentConfig>(agent)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!editing) setForm(agent)
  }, [agent, editing])

  function field<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function opt(key: string, value: unknown) {
    setForm(f => ({ ...f, providerOpts: { ...f.providerOpts, [key]: value } }))
  }

  function handleSave() {
    onSave(form)
    setEditing(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleCancel() {
    setEditing(false)
    setForm(agent)
  }

  const isHost = agent.role === 'MANAGER'
  const providerColorClass = PROVIDER_COLORS[agent.provider]

  if (!editing) {
    return (
      <tr className="border-b border-line hover:bg-surface-muted/50 transition-colors group">
        <td className="px-5 py-4">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0 shadow-sm"
              style={{ backgroundColor: isHost ? '#EA580C' : '#4F46E5' }}
            >
              {agent.name.slice(0, 1)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-ink text-[14px]">{agent.name}</span>
                {isHost && (
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-orange-500/10 border border-orange-500/20 text-orange-600 font-bold uppercase tracking-wider">
                    主持人
                  </span>
                )}
              </div>
              <span className="text-[12px] text-ink-soft">{agent.roleLabel || '—'}</span>
            </div>
          </div>
        </td>
        <td className="px-5 py-4">
          <span className={`text-[11px] px-2.5 py-1 rounded-md font-bold uppercase tracking-wider border ${providerColorClass}`}>
            {agent.provider}
          </span>
        </td>
        <td className="px-5 py-4">
          <div className="flex flex-wrap gap-1.5">
            {agent.tags.map(tag => (
              <span key={tag} className="text-[11px] px-2 py-0.5 rounded-md bg-surface border border-line text-ink-soft">
                {tag}
              </span>
            ))}
            {agent.tags.length === 0 && <span className="text-[12px] text-ink-soft italic">—</span>}
          </div>
        </td>
        <td className="px-5 py-4">
          {agent.providerOpts.thinking !== false ? (
            <span className="text-[12px] text-ink-soft font-medium flex items-center gap-1.5">🧠 开启</span>
          ) : (
            <span className="text-[12px] text-ink-soft opacity-50">—</span>
          )}
        </td>
        <td className="px-5 py-4 max-w-[280px]">
          <span className="text-[12px] text-ink-soft font-mono line-clamp-2 leading-relaxed bg-surface px-2 py-1 rounded-md border border-line/50">
            {agent.systemPrompt || '—'}
          </span>
        </td>
        <td className="px-5 py-4 text-right">
          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {saved && <span className="text-[11px] text-emerald-500 font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> 已保存</span>}
            {isHost ? (
              <span className="text-[12px] text-ink-soft italic mr-2">—</span>
            ) : (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="p-1.5 text-ink-soft hover:text-ink hover:bg-surface rounded-md transition-colors"
                  title="编辑"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onDelete(agent.id)}
                  className="p-1.5 text-ink-soft hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-b border-line bg-surface/80">
      <td colSpan={6} className="px-5 py-5">
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0"
              style={{ backgroundColor: isHost ? '#EA580C' : '#4F46E5' }}
            >
              {agent.name.slice(0, 1)}
            </div>
            <span className="font-bold text-ink text-[15px]">{agent.name} <span className="text-ink-soft text-[13px] font-normal ml-2">正在编辑...</span></span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            <div>
              <label className="block text-[12px] font-bold text-ink-soft uppercase tracking-wider mb-2">Provider</label>
              <div className="flex flex-col gap-2">
                {(Object.keys(PROVIDER_LABELS) as ProviderName[]).map(p => (
                  <label key={p} className="flex items-center gap-2 cursor-pointer p-2 rounded-lg border border-line hover:bg-surface-muted transition-colors">
                    <input
                      type="radio"
                      name={`provider-edit-${agent.id}`}
                      value={p}
                      checked={form.provider === p}
                      onChange={() => field('provider', p)}
                      className="accent-accent"
                    />
                    <span className="text-[13px] font-medium text-ink">{PROVIDER_LABELS[p]}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-bold text-ink-soft uppercase tracking-wider mb-2">
                标签 (逗号分隔)
              </label>
              <input
                type="text"
                value={form.tags.join(', ')}
                onChange={e => field('tags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                placeholder="科技, AI, 前端"
                className="w-full bg-bg border border-line rounded-lg px-3 py-2 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-[12px] font-bold text-ink-soft uppercase tracking-wider mb-2">推理过程</label>
              <button
                onClick={() => opt('thinking', !form.providerOpts.thinking)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50 focus:ring-offset-2 focus:ring-offset-bg ${form.providerOpts.thinking ? 'bg-accent' : 'bg-line'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.providerOpts.thinking ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <div>
              <label className="block text-[12px] font-bold text-ink-soft uppercase tracking-wider mb-2">角色标签</label>
              <input
                type="text"
                value={form.roleLabel}
                onChange={e => field('roleLabel', e.target.value)}
                placeholder="研究员"
                className="w-full bg-bg border border-line rounded-lg px-3 py-2 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent"
              />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-bold text-ink-soft uppercase tracking-wider mb-2">System Prompt</label>
            <textarea
              value={form.systemPrompt}
              onChange={e => field('systemPrompt', e.target.value)}
              rows={3}
              className="w-full bg-bg border border-line rounded-lg px-3 py-3 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent resize-none font-mono"
              placeholder="你是一个专业的…"
            />
          </div>
          <div className="flex gap-3 justify-end mt-2">
            <button
              onClick={handleCancel}
              className="px-5 py-2.5 text-[14px] font-medium text-ink-soft hover:text-ink hover:bg-surface-muted rounded-xl transition-colors flex items-center gap-2"
            >
              <X className="w-4 h-4" /> 取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2.5 text-[14px] font-bold bg-ink text-bg rounded-xl hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-2 shadow-sm active:scale-[0.99]"
            >
              <Save className="w-4 h-4" /> {saving ? '保存中…' : '保存更改'}
            </button>
          </div>
        </div>
      </td>
    </tr>
  )
}

function AddAgentForm({ onAdded }: { onAdded: () => void }) {
  const [form, setForm] = useState({ id: '', name: '', roleLabel: '', provider: 'claude-code' as ProviderName, systemPrompt: '', tags: [] as string[] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function handleAdd() {
    if (!form.id || !form.name) { setError('ID 和名称必填'); return }
    setSaving(true)
    setError('')
    fetch(`${API}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, role: 'WORKER', providerOpts: { thinking: true }, enabled: true }),
    }).then(async r => {
      const data = await r.json()
      if (!r.ok) { setError((data as { error?: string }).error ?? '创建失败'); setSaving(false); return }
      setForm({ id: '', name: '', roleLabel: '', provider: 'claude-code', systemPrompt: '', tags: [] })
      setSaving(false)
      onAdded()
    }).catch(e => { setError(String(e)); setSaving(false) })
  }

  return (
    <div className="bg-surface rounded-2xl border border-dashed border-line p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Plus className="w-5 h-5 text-accent" />
        <h2 className="text-[16px] font-bold text-ink">新增 Agent</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5">
        <div>
          <label className="block text-[12px] font-bold text-ink-soft uppercase tracking-wider mb-2">ID（英文唯一标识）</label>
          <input value={form.id} onChange={e => setForm(f => ({ ...f, id: e.target.value }))}
            className="w-full bg-bg border border-line rounded-lg px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent" placeholder="my-agent" />
        </div>
        <div>
          <label className="block text-[12px] font-bold text-ink-soft uppercase tracking-wider mb-2">名称</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full bg-bg border border-line rounded-lg px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent" placeholder="小明" />
        </div>
        <div>
          <label className="block text-[12px] font-bold text-ink-soft uppercase tracking-wider mb-2">角色标签</label>
          <input value={form.roleLabel} onChange={e => setForm(f => ({ ...f, roleLabel: e.target.value }))}
            className="w-full bg-bg border border-line rounded-lg px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent" placeholder="研究员" />
        </div>
        <div>
          <label className="block text-[12px] font-bold text-ink-soft uppercase tracking-wider mb-2">Provider</label>
          <select value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value as ProviderName }))}
            className="w-full bg-bg border border-line rounded-lg px-3 py-2.5 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent">
            {(Object.keys(PROVIDER_LABELS) as ProviderName[]).map(p => (
              <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-[12px] font-bold text-ink-soft uppercase tracking-wider mb-2">System Prompt</label>
        <textarea value={form.systemPrompt} onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
          rows={3} className="w-full bg-bg border border-line rounded-lg px-3 py-3 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent resize-none font-mono" placeholder="你是一个专业的…" />
      </div>
      {error && <p className="text-[13px] text-red-500 font-medium bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}
      <div className="flex justify-end pt-2">
        <button onClick={handleAdd} disabled={saving}
          className="px-6 py-3 text-[14px] font-bold bg-accent text-white rounded-xl hover:bg-accent-deep disabled:opacity-50 transition-all shadow-sm active:scale-[0.99] flex items-center gap-2">
          <Plus className="w-4 h-4" /> {saving ? '创建中…' : '创建 Agent'}
        </button>
      </div>
    </div>
  )
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  function load() {
    setLoading(true)
    fetch(`${API}/api/agents`)
      .then(r => r.json())
      .then((data: AgentConfig[]) => { setAgents(data); setLoading(false) })
      .catch(e => { console.error(e); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  function handleSave(updated: AgentConfig) {
    setSaving(true)
    fetch(`${API}/api/agents/${updated.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).then(async r => {
      const data = await r.json()
      setAgents(prev => prev.map(a => a.id === data.id ? data : a))
      setSaving(false)
    }).catch(e => { console.error(e); setSaving(false) })
  }

  function handleDelete(id: string) {
    if (!confirm('确认删除该 Agent？')) return
    fetch(`${API}/api/agents/${id}`, { method: 'DELETE' })
      .then(r => { if (r.ok) { setAgents(prev => prev.filter(a => a.id !== id)); router.refresh() } })
      .catch(e => console.error(e))
  }

  return (
    <div className="max-w-[1200px] mx-auto py-8 px-4 md:px-8">
      <div className="mb-8 flex items-center gap-4">
        <button onClick={() => router.push('/')} className="p-2 rounded-full bg-surface border border-line text-ink-soft hover:text-ink transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-ink">Agent 配置</h1>
          <p className="text-[14px] text-ink-soft mt-1">管理系统中所有 Agent 的底层 provider 和模型参数</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-40">
          <span className="text-ink-soft animate-pulse font-medium text-[14px]">加载中…</span>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="bg-surface rounded-2xl shadow-sm border border-line overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-line bg-surface-muted/50">
                    <th className="px-5 py-4 text-[12px] font-bold text-ink-soft uppercase tracking-wider">名称</th>
                    <th className="px-5 py-4 text-[12px] font-bold text-ink-soft uppercase tracking-wider">Provider</th>
                    <th className="px-5 py-4 text-[12px] font-bold text-ink-soft uppercase tracking-wider">标签</th>
                    <th className="px-5 py-4 text-[12px] font-bold text-ink-soft uppercase tracking-wider">推理</th>
                    <th className="px-5 py-4 text-[12px] font-bold text-ink-soft uppercase tracking-wider">System Prompt</th>
                    <th className="px-5 py-4 text-right text-[12px] font-bold text-ink-soft uppercase tracking-wider">操作</th>
                  </tr>
                </thead>
                <tbody className="bg-bg">
                  {agents.map(agent => (
                    <AgentRow
                      key={agent.id}
                      agent={agent}
                      onSave={handleSave}
                      onDelete={handleDelete}
                      saving={saving}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <AddAgentForm onAdded={load} />
        </div>
      )}
    </div>
  )
}
