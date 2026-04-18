'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { X, Bot, Server, CheckCircle2, Trash2, Edit2, Save, Plus, Loader2, Play, XCircle, BrainCircuit } from 'lucide-react'
import { API_URL } from '@/lib/api'

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

const PROVIDER_LABELS: Record<ProviderName, string> = {
  'claude-code': 'Claude Code', 'opencode': 'OpenCode',
}
const PROVIDER_COLORS: Record<ProviderName, string> = {
  'claude-code': 'text-accent bg-accent/10 border-accent/20',
  'opencode': 'text-purple-500 bg-purple-500/10 border-purple-500/20',
}

// ── Agent Row ──────────────────────────────────────────────────────────────────

function AgentRow({ agent, onSave, onDeleteRequest, saving }: {
  agent: AgentConfig; onSave: (a: AgentConfig) => Promise<void>; onDeleteRequest: (agent: AgentConfig) => void; saving: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<AgentConfig>(agent)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => { if (!editing) setForm(agent) }, [agent, editing])

  function field<K extends keyof AgentConfig>(k: K, v: AgentConfig[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }
  function opt(k: string, v: unknown) {
    setForm(f => ({ ...f, providerOpts: { ...f.providerOpts, [k]: v } }))
  }
  async function handleSave() {
    setSaveError('')
    try {
      await onSave(form)
      setEditing(false); setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveError((err as Error).message || '保存失败')
    }
  }
  function handleCancel() {
    setEditing(false); setForm(agent); setSaveError('')
  }

  const isHost = agent.role === 'MANAGER'
  const pc = PROVIDER_COLORS[agent.provider]

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
            </div>
          </div>
        </td>
        <td className="px-4 py-3.5">
          <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider border ${pc}`}>{agent.provider}</span>
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
      <td colSpan={5} className="px-4 py-4">
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
    fetch(`${API}/api/providers/${provider.name}/test`, { method: 'POST' })
      .then(r => r.json())
      .then((r: ProviderConfig['lastTestResult']) => { setResult(r); setTesting(false) })
      .catch(e => { setResult({ success: false, error: e.message }); setTesting(false) })
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
    } catch (err) {
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
    }).catch(e => { setError(fmtErr(e, '创建失败')) }).finally(() => { setSaving(false) })
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
    } catch (err) {
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
    } catch (err) {
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

// ── Main Modal ────────────────────────────────────────────────────────────────

export default function SettingsModal({ isOpen, onClose, initialTab = 'agent' }: { isOpen: boolean; onClose: () => void; initialTab?: 'agent' | 'provider' | 'scene' }) {
  const [tab, setTab] = useState<'agent' | 'provider' | 'scene'>(initialTab)
  const [agents, setAgents] = useState<AgentConfig[]>([])
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({})
  const [scenes, setScenes] = useState<SceneConfig[]>([])
  const [selProvider, setSelProvider] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingScenes, setLoadingScenes] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<AgentConfig | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState({ id: '', name: '', roleLabel: '', provider: 'claude-code' as ProviderName, systemPrompt: '', tags: [] as string[] })
  const [addError, setAddError] = useState('')
  const router = useRouter()
  const backdropRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    Promise.all([
      fetch(`${API}/api/agents`).then(r => r.json()),
      fetch(`${API}/api/providers`).then(r => r.json()),
      fetch(`${API}/api/scenes`).then(r => r.json()),
    ]).then(([ag, pr, sc]) => {
      setAgents(ag)
      setProviders(pr)
      setScenes(sc)
      if (!selProvider && Object.keys(pr).length > 0) setSelProvider(Object.keys(pr)[0])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [isOpen])

  function handleAgentSave(updated: AgentConfig): Promise<void> {
    setSaving(true)
    return fetch(`${API}/api/agents/${updated.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      .then(async res => {
        const a = await res.json() as AgentConfig & {error?: string}
        if (!res.ok) throw new Error(a.error ?? '保存失败')
        setAgents(prev => prev.map(x => x.id === a.id ? a : x)); setSaving(false)
      }).catch(e => { console.error(e); setSaving(false); throw e })
  }
  function handleAgentDelete(id: string) {
    fetch(`${API}/api/agents/${id}`, { method: 'DELETE' })
      .then(r => { if (r.ok) setAgents(prev => prev.filter(a => a.id !== id)) })
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
    fetch(`${API}/api/agents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...addForm, role: 'WORKER', providerOpts: { thinking: true }, enabled: true }) })
      .then(r => {
        if (!r.ok) return r.json().then(err => { throw new Error(err.error || `HTTP ${r.status}`) })
        return r.json()
      })
      .then(a => {
        setAgents(prev => [...prev, a]); setAddForm({ id: '', name: '', roleLabel: '', provider: 'claude-code', systemPrompt: '', tags: [] }); setAddOpen(false); setAddError(''); setSaving(false)
      })
      .catch(e => { setAddError(e.message); setSaving(false) })
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
                        <th className="px-4 py-3 text-[11px] font-bold text-ink-soft uppercase">标签</th>
                        <th className="px-4 py-3 text-[11px] font-bold text-ink-soft uppercase">推理</th>
                        <th className="px-4 py-3 text-[11px] font-bold text-ink-soft uppercase text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agents.map(a => <AgentRow key={a.id} agent={a} onSave={handleAgentSave} onDeleteRequest={setPendingDelete} saving={saving}/>)}
                    </tbody>
                  </table>
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
