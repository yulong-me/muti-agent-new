'use client'

import { useEffect, useState } from 'react'
import { BrainCircuit, Edit2, Loader2, Plus, Save, Trash2 } from 'lucide-react'

import { API_URL } from '@/lib/api'
import { info, warn } from '@/lib/logger'

import { DirectoryPicker } from '../DirectoryPicker'
import type { ReadOnlySkill, SkillConfig } from './types'
import { fmtErr } from './utils'

const API = API_URL

function SkillCreateForm({ onCreated }: { onCreated: (skill: SkillConfig) => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', content: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate() {
    if (!form.name.trim()) {
      setError('名称必填')
      return
    }
    setSaving(true)
    setError('')
    info('ui:settings:skill_create', { name: form.name.trim() })
    try {
      const response = await fetch(`${API}/api/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || '创建失败')
      }
      const created = await response.json() as SkillConfig
      onCreated(created)
      setForm({ name: '', description: '', content: '' })
      setOpen(false)
      info('ui:settings:skill_create_success', { name: created.name })
    } catch (error) {
      warn('ui:settings:skill_create_failed', { name: form.name.trim(), error })
      setError(fmtErr(error, '创建失败'))
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
        <Plus className="w-4 h-4" aria-hidden />
        手动创建
      </button>
    )
  }

  return (
    <div className="settings-surface rounded-xl p-5 space-y-3">
      <p className="text-[13px] font-bold text-ink flex items-center gap-1.5">
        <BrainCircuit className="w-4 h-4 text-accent" aria-hidden />
        手动创建 Skill
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">名称</label>
          <input
            value={form.name}
            onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))}
            placeholder="request-review"
            className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">描述</label>
          <input
            value={form.description}
            onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))}
            placeholder="什么时候该使用这个 skill"
            className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">SKILL.md</label>
        <textarea
          value={form.content}
          onChange={event => setForm(previous => ({ ...previous, content: event.target.value }))}
          rows={8}
          placeholder="留空则自动生成基础模板"
          className="w-full settings-input rounded-xl px-3 py-2 text-[12px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none font-mono"
        />
      </div>
      {error && <p className="text-[12px] text-red-400 bg-red-500/10 px-3 py-1.5 rounded-xl">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={() => setOpen(false)} className="px-4 py-1.5 text-[12px] text-ink-soft hover:text-ink hover:bg-white/5 rounded-xl transition-colors">取消</button>
        <button type="button" onClick={handleCreate} disabled={saving} className="px-4 py-1.5 text-[12px] font-bold bg-accent text-white rounded-xl hover:bg-accent-deep disabled:opacity-50 transition-all flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" aria-hidden />
          {saving ? '创建中…' : '创建'}
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
      const response = await fetch(`${API}/api/skills/import-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath: sourcePath.trim() }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || '导入失败')
      }
      const imported = await response.json() as SkillConfig
      onImported(imported)
      setSourcePath('')
      setOpen(false)
      info('ui:settings:skill_import_success', { name: imported.name, sourcePath: sourcePath.trim() })
    } catch (error) {
      warn('ui:settings:skill_import_failed', { sourcePath: sourcePath.trim(), error })
      setError(fmtErr(error, '导入失败'))
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
        <Plus className="w-4 h-4" aria-hidden />
        导入文件夹
      </button>
    )
  }

  return (
    <div className="settings-surface rounded-xl p-5 space-y-3">
      <p className="text-[13px] font-bold text-ink flex items-center gap-1.5">
        <Plus className="w-4 h-4 text-accent" aria-hidden />
        导入 Skill 文件夹
      </p>
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
          <Save className="w-3.5 h-3.5" aria-hidden />
          {saving ? '导入中…' : '导入'}
        </button>
      </div>
    </div>
  )
}

function SkillRow({
  skill,
  onUpdate,
  onDelete,
}: {
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
  }, [editing, skill])

  async function handleSave() {
    setSaving(true)
    setSaveError('')
    try {
      const response = await fetch(`${API}/api/skills/${encodeURIComponent(skill.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || '保存失败')
      }
      const updated = await response.json() as SkillConfig
      onUpdate(updated)
      setEditing(false)
      info('ui:settings:skill_saved', { name: skill.name, enabled: updated.enabled })
    } catch (error) {
      warn('ui:settings:skill_save_failed', { name: skill.name, error })
      setSaveError(fmtErr(error, '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const response = await fetch(`${API}/api/skills/${encodeURIComponent(skill.name)}`, { method: 'DELETE' })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || '删除失败')
      }
      onDelete(skill.id)
      info('ui:settings:skill_deleted', { name: skill.name })
    } catch (error) {
      warn('ui:settings:skill_delete_failed', { name: skill.name, error })
      alert(fmtErr(error, '删除失败'))
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
                onChange={event => setForm(previous => ({ ...previous, enabled: event.target.checked }))}
                className="accent-accent"
              />
              启用
            </label>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">描述</label>
            <input
              value={form.description}
              onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))}
              className="w-full settings-input rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-soft uppercase mb-1.5">SKILL.md</label>
            <textarea
              value={form.content}
              onChange={event => setForm(previous => ({ ...previous, content: event.target.value }))}
              rows={10}
              className="w-full settings-input rounded-xl px-3 py-2 text-[12px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none font-mono"
            />
          </div>
          {saveError && <p className="text-[12px] text-red-400 bg-red-500/10 px-3 py-1.5 rounded-xl">{saveError}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setEditing(false)} className="px-4 py-1.5 text-[12px] text-ink-soft hover:text-ink hover:bg-white/5 rounded-xl transition-colors">取消</button>
            <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-[12px] font-bold bg-accent text-white rounded-xl hover:bg-accent-deep disabled:opacity-50 transition-all flex items-center gap-1.5">
              <Save className="w-3.5 h-3.5" aria-hidden />
              {saving ? '保存中…' : '保存'}
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
                <Edit2 className="w-3.5 h-3.5" aria-hidden />
              </button>
              <button type="button" onClick={handleDelete} disabled={deleting} aria-label="删除" className="p-1.5 text-ink-soft hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors">
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Trash2 className="w-3.5 h-3.5" aria-hidden />}
              </button>
            </div>
          </div>
          <div className="bg-white/[0.03] rounded-xl px-3 py-2 border border-white/[0.05]">
            <p className="text-[10px] font-bold text-ink-soft uppercase mb-1">Preview</p>
            <p className="text-[11px] text-ink font-mono whitespace-pre-wrap">
              {skill.content.slice(0, 180)}
              {skill.content.length > 180 ? '…' : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export function SkillSettingsTab({
  skills,
  globalSkills,
  onCreated,
  onImported,
  onUpdate,
  onDelete,
}: {
  skills: SkillConfig[]
  globalSkills: ReadOnlySkill[]
  onCreated: (skill: SkillConfig) => void
  onImported: (skill: SkillConfig) => void
  onUpdate: (skill: SkillConfig) => void
  onDelete: (id: string) => void
}) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SkillCreateForm onCreated={onCreated} />
        <SkillImportForm onImported={onImported} />
      </div>
      <div className="space-y-3">
        {skills.length === 0 ? (
          <div className="settings-surface rounded-xl p-5 text-[12px] text-ink-soft">还没有 managed skills。创建后就可以给 Agent 和 Room 绑定。</div>
        ) : skills.map(skill => (
          <SkillRow key={skill.id} skill={skill} onUpdate={onUpdate} onDelete={onDelete} />
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
  )
}
