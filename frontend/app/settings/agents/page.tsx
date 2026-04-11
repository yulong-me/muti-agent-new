'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const API = 'http://localhost:7001'

type ProviderName = 'claude-code' | 'opencode'

interface AgentConfig {
  id: string
  name: string
  roleLabel: string
  role: 'HOST' | 'AGENT'
  provider: ProviderName
  providerOpts: {
    model?: string
    thinking?: boolean
    [key: string]: unknown
  }
  systemPrompt: string
  enabled: boolean
}

const PROVIDER_LABELS: Record<ProviderName, string> = {
  'claude-code': 'Claude Code',
  'opencode': 'OpenCode',
}

const PROVIDER_COLORS: Record<ProviderName, string> = {
  'claude-code': 'text-blue-600 bg-blue-50',
  'opencode': 'text-purple-600 bg-purple-50',
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

  const isHost = agent.role === 'HOST'
  const providerColorClass = PROVIDER_COLORS[agent.provider]

  if (!editing) {
    return (
      <tr className="border-b border-apple-border hover:bg-apple-bg transition-colors">
        {/* Name + avatar */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
              style={{ backgroundColor: isHost ? '#FF9500' : '#0071E3' }}
            >
              {agent.name.slice(0, 1)}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-apple-text text-sm">{agent.name}</span>
                {isHost && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-orange-50 border border-orange-200 text-orange-600">
                    主持人
                  </span>
                )}
              </div>
              <span className="text-xs text-apple-secondary">{agent.roleLabel || '—'}</span>
            </div>
          </div>
        </td>
        {/* Provider */}
        <td className="px-4 py-3">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${providerColorClass}`}>
            {agent.provider}
          </span>
        </td>
        {/* Model */}
        <td className="px-4 py-3">
          <span className="text-xs font-mono text-apple-secondary">
            {agent.providerOpts.model || '—'}
          </span>
        </td>
        {/* Thinking */}
        <td className="px-4 py-3">
          {agent.providerOpts.thinking !== false ? (
            <span className="text-xs text-apple-secondary">🧠 开</span>
          ) : (
            <span className="text-xs text-apple-secondary">—</span>
          )}
        </td>
        {/* System prompt */}
        <td className="px-4 py-3 max-w-[240px]">
          <span className="text-xs text-apple-secondary font-mono line-clamp-2">
            {agent.systemPrompt || '—'}
          </span>
        </td>
        {/* Actions */}
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-xs text-apple-green">已保存</span>}
            {isHost ? (
              <span className="text-xs text-apple-secondary italic">—</span>
            ) : (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="text-xs text-apple-primary hover:underline"
                >
                  编辑
                </button>
                <button
                  onClick={() => onDelete(agent.id)}
                  className="text-xs text-red-500 hover:underline"
                >
                  删除
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
    )
  }

  // Edit mode — spans full width as a form row
  return (
    <tr className="border-b border-apple-border bg-apple-bg/50">
      <td colSpan={6} className="px-4 py-4">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
              style={{ backgroundColor: isHost ? '#FF9500' : '#0071E3' }}
            >
              {agent.name.slice(0, 1)}
            </div>
            <span className="font-medium text-apple-text text-sm">{agent.name}</span>
            <span className="text-xs text-apple-secondary">编辑中…</span>
          </div>
          <div className="grid grid-cols-4 gap-4">
            {/* Provider */}
            <div>
              <label className="block text-xs font-medium text-apple-secondary mb-1">Provider</label>
              <div className="flex flex-col gap-1">
                {(Object.keys(PROVIDER_LABELS) as ProviderName[]).map(p => (
                  <label key={p} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name={`provider-edit-${agent.id}`}
                      value={p}
                      checked={form.provider === p}
                      onChange={() => field('provider', p)}
                      className="accent-apple-primary"
                    />
                    <span className="text-sm text-apple-text">{PROVIDER_LABELS[p]}</span>
                  </label>
                ))}
              </div>
            </div>
            {/* Model */}
            <div>
              <label className="block text-xs font-medium text-apple-secondary mb-1">
                模型 {form.provider === 'opencode' ? '(provider/model)' : '(可选)'}
              </label>
              <input
                type="text"
                value={form.providerOpts.model ?? ''}
                onChange={e => opt('model', e.target.value)}
                placeholder={form.provider === 'opencode' ? 'google/gemini-2-0-flash' : ''}
                className="w-full border border-apple-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-apple-primary/30 focus:border-apple-primary"
              />
            </div>
            {/* Thinking */}
            <div>
              <label className="block text-xs font-medium text-apple-secondary mb-1">推理过程</label>
              <button
                onClick={() => opt('thinking', !form.providerOpts.thinking)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.providerOpts.thinking ? 'bg-apple-primary' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.providerOpts.thinking ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            {/* roleLabel */}
            <div>
              <label className="block text-xs font-medium text-apple-secondary mb-1">角色标签</label>
              <input
                type="text"
                value={form.roleLabel}
                onChange={e => field('roleLabel', e.target.value)}
                placeholder="研究员"
                className="w-full border border-apple-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-apple-primary/30 focus:border-apple-primary"
              />
            </div>
          </div>
          {/* System prompt */}
          <div>
            <label className="block text-xs font-medium text-apple-secondary mb-1">System Prompt</label>
            <textarea
              value={form.systemPrompt}
              onChange={e => field('systemPrompt', e.target.value)}
              rows={2}
              className="w-full border border-apple-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-apple-primary/30 focus:border-apple-primary resize-none font-mono"
              placeholder="你是一个专业的…"
            />
          </div>
          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleCancel}
              className="px-4 py-1.5 text-sm text-apple-secondary hover:text-apple-text transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 text-sm bg-apple-primary text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </td>
    </tr>
  )
}

// ── Add new agent form ───────────────────────────────────────────────────────

function AddAgentForm({ onAdded }: { onAdded: () => void }) {
  const [form, setForm] = useState({ id: '', name: '', roleLabel: '', provider: 'claude-code' as ProviderName, systemPrompt: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function handleAdd() {
    if (!form.id || !form.name) { setError('ID 和名称必填'); return }
    setSaving(true)
    setError('')
    fetch(`${API}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, role: 'AGENT', providerOpts: { thinking: true }, enabled: true }),
    }).then(async r => {
      const data = await r.json()
      if (!r.ok) { setError((data as { error?: string }).error ?? '创建失败'); setSaving(false); return }
      setForm({ id: '', name: '', roleLabel: '', provider: 'claude-code', systemPrompt: '' })
      setSaving(false)
      onAdded()
    }).catch(e => { setError(String(e)); setSaving(false) })
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-dashed border-apple-border p-5 space-y-3">
      <p className="text-sm font-semibold text-apple-text">新增 Agent</p>
      <div className="grid grid-cols-4 gap-3">
        <div>
          <label className="block text-xs text-apple-secondary mb-1">ID（英文唯一标识）</label>
          <input value={form.id} onChange={e => setForm(f => ({ ...f, id: e.target.value }))}
            className="w-full border border-apple-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-apple-primary/30 focus:border-apple-primary" placeholder="my-agent" />
        </div>
        <div>
          <label className="block text-xs text-apple-secondary mb-1">名称</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full border border-apple-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-apple-primary/30 focus:border-apple-primary" placeholder="小明" />
        </div>
        <div>
          <label className="block text-xs text-apple-secondary mb-1">角色标签</label>
          <input value={form.roleLabel} onChange={e => setForm(f => ({ ...f, roleLabel: e.target.value }))}
            className="w-full border border-apple-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-apple-primary/30 focus:border-apple-primary" placeholder="研究员" />
        </div>
        <div>
          <label className="block text-xs text-apple-secondary mb-1">Provider</label>
          <select value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value as ProviderName }))}
            className="w-full border border-apple-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-apple-primary/30 focus:border-apple-primary bg-white">
            {(Object.keys(PROVIDER_LABELS) as ProviderName[]).map(p => (
              <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs text-apple-secondary mb-1">System Prompt</label>
        <textarea value={form.systemPrompt} onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
          rows={2} className="w-full border border-apple-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-apple-primary/30 focus:border-apple-primary resize-none font-mono" placeholder="你是一个专业的…" />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end">
        <button onClick={handleAdd} disabled={saving}
          className="px-4 py-2 text-sm bg-apple-primary text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity">
          {saving ? '创建中…' : '创建 Agent'}
        </button>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

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
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-apple-text mb-1">Agent 配置</h1>
        <p className="text-sm text-apple-secondary">管理系统中所有 Agent 的底层 provider 和模型参数</p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-apple-secondary text-sm">加载中…</div>
      ) : (
        <div className="space-y-4">
          {/* Table */}
          <div className="bg-white rounded-2xl shadow-sm border border-apple-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-apple-border bg-apple-bg">
                    <th className="px-4 py-3 text-left text-xs font-medium text-apple-secondary uppercase tracking-wider">名称</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-apple-secondary uppercase tracking-wider">Provider</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-apple-secondary uppercase tracking-wider">模型</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-apple-secondary uppercase tracking-wider">推理</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-apple-secondary uppercase tracking-wider">System Prompt</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-apple-secondary uppercase tracking-wider">操作</th>
                  </tr>
                </thead>
                <tbody>
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

          {/* Add form */}
          <AddAgentForm onAdded={load} />
        </div>
      )}
    </>
  )
}
