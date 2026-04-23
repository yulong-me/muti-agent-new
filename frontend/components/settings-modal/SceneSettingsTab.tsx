'use client'

import { useEffect, useState } from 'react'
import { BrainCircuit, Copy, Edit2, Loader2, Plus, Save, Trash2 } from 'lucide-react'

import { API_URL } from '@/lib/api'
import { info, warn } from '@/lib/logger'

import type { SceneConfig } from './types'
import { fmtErr } from './utils'

const API = API_URL

function SceneCreateForm({ onCreated }: { onCreated: (scene: SceneConfig) => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', prompt: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function handleCreate() {
    if (!form.name.trim()) {
      setError('名称必填')
      return
    }
    if (!form.prompt.trim()) {
      setError('Prompt模板必填')
      return
    }
    setSaving(true)
    info('ui:settings:scene_create', { name: form.name.trim() })
    fetch(`${API}/api/scenes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }).then(async response => {
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || '创建失败')
      }
      return await response.json() as SceneConfig
    }).then(created => {
      onCreated(created)
      setForm({ name: '', description: '', prompt: '' })
      setOpen(false)
      setError('')
      info('ui:settings:scene_create_success', { sceneId: created.id, name: created.name })
    }).catch(error => {
      warn('ui:settings:scene_create_failed', { name: form.name.trim(), error })
      setError(fmtErr(error, '创建失败'))
    }).finally(() => {
      setSaving(false)
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full py-3 text-[13px] font-bold text-ink-soft border border-dashed border-line rounded-xl hover:border-accent/50 hover:text-accent transition-colors flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" aria-hidden />
        新建场景
      </button>
    )
  }

  return (
    <div className="settings-surface rounded-xl p-5 space-y-3">
      <p className="text-[13px] font-bold text-ink flex items-center gap-1.5">
        <BrainCircuit className="w-4 h-4 text-accent" aria-hidden />
        新建 Scene
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">名称</label>
          <input
            value={form.name}
            onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))}
            placeholder="辩论 / 设计评审 / 头脑风暴"
            autoComplete="off"
            className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">描述</label>
          <input
            value={form.description}
            onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))}
            placeholder="可选，用于列表展示"
            autoComplete="off"
            className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">Prompt 模板</label>
        <textarea
          value={form.prompt}
          onChange={event => setForm(previous => ({ ...previous, prompt: event.target.value }))}
          rows={4}
          placeholder="【场景模式：xxx】&#10;定义该场景下所有 agent 的行为约束…"
          autoComplete="off"
          className="w-full settings-input rounded-xl px-3 py-2 text-[12px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none font-mono placeholder:text-ink-soft/40"
        />
      </div>
      {error && <p className="tone-danger-panel rounded-xl border px-3 py-1.5 text-[12px]">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={() => { setOpen(false); setError('') }} className="px-4 py-1.5 text-[12px] text-ink-soft hover:text-ink hover:bg-surface-muted rounded-xl transition-colors">取消</button>
        <button type="button" onClick={handleCreate} disabled={saving} className="px-4 py-1.5 text-[12px] font-bold bg-accent text-white rounded-xl hover:bg-accent-deep disabled:opacity-50 transition-all flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" aria-hidden />
          {saving ? '创建中…' : '创建'}
        </button>
      </div>
    </div>
  )
}

function SceneRow({
  scene,
  onCreated,
  onUpdate,
  onDelete,
}: {
  scene: SceneConfig
  onCreated: (scene: SceneConfig) => void
  onUpdate: (scene: SceneConfig) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: scene.name, description: scene.description ?? '', prompt: scene.prompt })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [duplicateError, setDuplicateError] = useState('')

  const canEditPrompt = scene.canEditPrompt && !scene.builtin
  const canEditName = scene.canEditName && canEditPrompt
  const canDelete = scene.canDelete && !scene.builtin

  useEffect(() => {
    if (!editing) {
      setForm({ name: scene.name, description: scene.description ?? '', prompt: scene.prompt })
    }
  }, [editing, scene])

  async function handleSave() {
    setSaveError('')
    setSaving(true)
    try {
      const payload: Record<string, string> = {
        description: form.description,
        prompt: form.prompt,
      }
      if (canEditName) payload.name = form.name
      const response = await fetch(`${API}/api/scenes/${encodeURIComponent(scene.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || '保存失败')
      }
      const updated = await response.json() as SceneConfig
      onUpdate(updated)
      setEditing(false)
      info('ui:settings:scene_saved', { sceneId: scene.id, name: updated.name })
    } catch (error) {
      warn('ui:settings:scene_save_failed', { sceneId: scene.id, error })
      setSaveError(fmtErr(error, '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const response = await fetch(`${API}/api/scenes/${encodeURIComponent(scene.id)}`, { method: 'DELETE' })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || '删除失败')
      }
      onDelete(scene.id)
      info('ui:settings:scene_deleted', { sceneId: scene.id, name: scene.name })
    } catch (error) {
      warn('ui:settings:scene_delete_failed', { sceneId: scene.id, error })
      alert(fmtErr(error, '删除失败'))
      setDeleting(false)
    }
  }

  async function handleDuplicateBuiltin() {
    setDuplicateError('')
    setDuplicating(true)
    try {
      const response = await fetch(`${API}/api/scenes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${scene.name} 副本`,
          description: scene.description ?? '',
          prompt: scene.prompt,
        }),
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || '复制失败')
      }
      const created = await response.json() as SceneConfig
      onCreated(created)
      info('ui:settings:scene_duplicated', {
        sourceSceneId: scene.id,
        createdSceneId: created.id,
        sourceBuiltin: scene.builtin,
      })
    } catch (error) {
      warn('ui:settings:scene_duplicate_failed', { sceneId: scene.id, error })
      setDuplicateError(fmtErr(error, '复制失败'))
    } finally {
      setDuplicating(false)
    }
  }

  return (
    <div className="settings-surface rounded-xl p-5">
      {editing && canEditPrompt ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] font-bold text-ink">
            编辑场景
            <span className="text-ink-soft font-normal ml-1">编辑中…</span>
          </p>
          {canEditName && (
            <div>
              <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">名称</label>
              <input
                value={form.name}
                onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))}
                autoComplete="off"
                className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
          )}
          <div>
            <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">描述</label>
            <input
              value={form.description}
              onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))}
              autoComplete="off"
              className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">Prompt 模板</label>
            <textarea
              value={form.prompt}
              onChange={event => setForm(previous => ({ ...previous, prompt: event.target.value }))}
              rows={4}
              autoComplete="off"
              className="w-full settings-input rounded-xl px-3 py-2 text-[12px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none font-mono"
            />
          </div>
          {saveError && <p className="tone-danger-panel rounded-xl border px-3 py-1.5 text-[12px]">{saveError}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setEditing(false)} className="px-4 py-1.5 text-[12px] text-ink-soft hover:text-ink hover:bg-surface-muted rounded-xl transition-colors">取消</button>
            <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-[12px] font-bold bg-accent text-white rounded-xl hover:bg-accent-deep disabled:opacity-50 transition-all flex items-center gap-1.5">
              <Save className="w-3.5 h-3.5" aria-hidden />
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                <BrainCircuit className="w-4 h-4 text-accent" aria-hidden />
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
              {canEditPrompt ? (
                <button type="button" onClick={() => setEditing(true)} aria-label="编辑" className="p-1.5 text-ink-soft hover:text-ink hover:bg-surface-muted rounded-md transition-colors">
                  <Edit2 className="w-3.5 h-3.5" aria-hidden />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleDuplicateBuiltin}
                  disabled={duplicating}
                  aria-label="复制为自定义场景"
                  className="p-1.5 text-ink-soft hover:text-accent hover:bg-surface-muted rounded-md transition-colors disabled:opacity-50"
                  title="复制为自定义场景"
                >
                  {duplicating ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Copy className="w-3.5 h-3.5" aria-hidden />}
                </button>
              )}
              {canDelete && (
                <button type="button" onClick={handleDelete} disabled={deleting} aria-label="删除" className="tone-danger-icon rounded-md p-1.5 transition-colors">
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Trash2 className="w-3.5 h-3.5" aria-hidden />}
                </button>
              )}
            </div>
          </div>
          <div className="bg-surface-muted rounded-xl px-3 py-2 border border-line">
            <p className="text-[10px] font-bold text-ink-soft uppercase mb-1">Prompt</p>
            <p className="text-[11px] text-ink font-mono whitespace-pre-wrap">
              {scene.prompt.slice(0, 120)}
              {scene.prompt.length > 120 ? '…' : ''}
            </p>
          </div>
          {scene.builtin ? (
            <div className="rounded-xl border border-line bg-surface px-3 py-2 text-[11px] text-ink-soft">
              内置场景为只读真相源，不能直接修改。需要调整提示词时，请先复制为自定义场景，再编辑副本。
            </div>
          ) : null}
          {duplicateError ? <p className="tone-danger-panel rounded-xl border px-3 py-1.5 text-[12px]">{duplicateError}</p> : null}
        </div>
      )}
    </div>
  )
}

export function SceneSettingsTab({
  scenes,
  onCreated,
  onUpdate,
  onDelete,
}: {
  scenes: SceneConfig[]
  onCreated: (scene: SceneConfig) => void
  onUpdate: (scene: SceneConfig) => void
  onDelete: (id: string) => void
}) {
  return (
    <>
      <SceneCreateForm onCreated={onCreated} />
      <div className="flex flex-col gap-3">
        {scenes.map(scene => (
          <SceneRow key={scene.id} scene={scene} onCreated={onCreated} onUpdate={onUpdate} onDelete={onDelete} />
        ))}
      </div>
    </>
  )
}
