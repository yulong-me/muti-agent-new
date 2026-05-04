'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleHelp, GitBranch, Loader2, Plus, RefreshCw, UsersRound, X } from 'lucide-react'

import { API_URL } from '@/lib/api'
import type { TeamListItem } from '@/lib/agents'
import { CustomSelect } from '@/components/ui/CustomSelect'
import type { ProviderName, ReadOnlySkill, SkillConfig } from './types'

const API = API_URL
const PROVIDER_OPTIONS: Array<{ value: ProviderName; label: string }> = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'codex', label: 'Codex CLI' },
]
const LONG_TEXT_MODAL_THRESHOLD = 120

type TeamMemberSnapshot = NonNullable<TeamListItem['activeVersion']['memberSnapshots']>[number]
type TeamMemberSkillRef = NonNullable<TeamMemberSnapshot['skillRefs']>[number]
type SkillPickerSource = TeamMemberSkillRef['source']

interface SkillPickerOption {
  key: string
  source: SkillPickerSource
  id?: string
  name: string
  description: string
  sourcePath?: string
  providerCompat: ProviderName[]
}

interface TeamSettingsPatch {
  name?: string
  description?: string
  version?: {
    name?: string
    description?: string
    memberSnapshots?: TeamMemberSnapshot[]
    workflowPrompt?: string
    routingPolicy?: Record<string, unknown>
    teamMemory?: string[]
    maxA2ADepth?: number
  }
}

function getFirstText(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function formatRoutingRule(rule: unknown): string {
  if (typeof rule === 'string') return rule.trim()
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return ''

  const item = rule as Record<string, unknown>
  const trigger = getFirstText(item, ['when', 'condition', 'trigger', 'input', 'if', 'on'])
  const target = getFirstText(item, ['memberRole', 'role', 'member', 'agent', 'target', 'to', 'owner', 'routeTo', 'assignee'])
  const action = getFirstText(item, ['action', 'behavior', 'instruction'])

  if (trigger && target) return `${trigger} -> ${target}`
  if (trigger && action) return `${trigger}: ${action}`
  if (target && action) return `${target}: ${action}`

  const values = Object.values(item)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim())
  if (values.length >= 2) return `${values[0]} -> ${values[1]}`
  return values[0] ?? ''
}

function formatRoutingPolicy(policy?: Record<string, unknown>): string[] {
  if (!policy) return []
  const candidateLists = [policy.rules, policy.routes, policy.routingRules, policy.conditions]
  for (const candidate of candidateLists) {
    if (!Array.isArray(candidate)) continue
    const rules = candidate.map(formatRoutingRule).filter(Boolean)
    if (rules.length > 0) return rules
  }
  return []
}

function splitLines(value: string): string[] {
  return value.split('\n').map(item => item.trim()).filter(Boolean)
}

function skillSourceLabel(source: SkillPickerSource): string {
  if (source === 'managed') return '系统维护'
  if (source === 'global') return '系统扫描'
  return 'Workspace'
}

function skillRefKey(ref: TeamMemberSkillRef): string {
  if (ref.source === 'managed') return `managed:${ref.id ?? ref.name}`
  return `${ref.source}:${ref.sourcePath ?? ref.name}`
}

function optionToSkillRef(option: SkillPickerOption): TeamMemberSkillRef {
  if (option.source === 'managed') {
    return { source: 'managed', id: option.id, name: option.name }
  }
  return { source: option.source, name: option.name, sourcePath: option.sourcePath }
}

function skillIdsFromRefs(refs: TeamMemberSkillRef[]): string[] {
  return refs
    .filter(ref => ref.source === 'managed' && typeof ref.id === 'string' && ref.id.trim())
    .map(ref => ref.id as string)
}

function getMemberSkillRefs(member: TeamMemberSnapshot, skills: SkillConfig[]): TeamMemberSkillRef[] {
  if (member.skillRefs?.length) return member.skillRefs
  return (member.skillIds ?? []).map(skillId => {
    const skill = skills.find(item => item.id === skillId)
    return {
      source: 'managed',
      id: skillId,
      name: skill?.name ?? skillId,
    }
  })
}

function isSkillOptionCompatibleWithProvider(option: SkillPickerOption, provider: ProviderName): boolean {
  return option.providerCompat.includes(provider)
}

function fallbackMembers(team?: TeamListItem): TeamMemberSnapshot[] {
  if (!team) return []
  if (team.activeVersion.memberSnapshots?.length) return team.activeVersion.memberSnapshots
  return team.members.map(member => ({
    id: member.id,
    name: member.name,
    roleLabel: member.roleLabel,
    provider: member.provider as ProviderName,
    providerOpts: {},
    systemPrompt: '',
  }))
}

function EditableText({
  value,
  placeholder = '点击编辑',
  multiline = false,
  monospace = false,
  longTextDialogTitle,
  className = '',
  onSave,
}: {
  value: string
  placeholder?: string
  multiline?: boolean
  monospace?: boolean
  longTextDialogTitle?: string
  className?: string
  onSave: (value: string) => Promise<void> | void
}) {
  const [editing, setEditing] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const useDialogEditor = Boolean(longTextDialogTitle && multiline && value.length > LONG_TEXT_MODAL_THRESHOLD)

  useEffect(() => {
    if (!editing && !dialogOpen) setDraft(value)
  }, [dialogOpen, editing, value])

  async function commit() {
    const wasDialogOpen = dialogOpen
    setEditing(false)
    const next = draft.trimEnd()
    if (next === value) {
      setDialogOpen(false)
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(next)
      setDialogOpen(false)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1200)
    } catch (err) {
      if (!wasDialogOpen) setDraft(value)
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  function cancelDialogEdit() {
    setDraft(value)
    setDialogOpen(false)
    setError('')
  }

  if (editing) {
    const inputClass = `w-full rounded-lg border border-accent/40 bg-surface px-2 py-1.5 text-[12px] text-ink outline-none ring-2 ring-accent/10 ${monospace ? 'font-mono' : ''} ${className}`
    return multiline ? (
      <textarea
        autoFocus
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        rows={4}
        className={`${inputClass} resize-y`}
      />
    ) : (
      <input
        autoFocus
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        className={inputClass}
      />
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (useDialogEditor) {
            setDialogOpen(true)
          } else {
            setEditing(true)
          }
        }}
        className={`min-h-7 w-full rounded-lg px-2 py-1.5 text-left text-[12px] leading-5 text-ink transition-colors hover:bg-surface focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20 ${monospace ? 'font-mono' : ''} ${className}`}
      >
        <span className={value ? `${useDialogEditor ? 'line-clamp-4' : 'whitespace-pre-line'}` : 'text-ink-faint'}>
          {value || placeholder}
        </span>
        {useDialogEditor && (
          <span className="mt-1 block text-[11px] font-medium text-accent">内容较长，点击弹窗编辑</span>
        )}
      </button>
      {dialogOpen && (
        <div className="fixed inset-0 layer-nested-modal flex items-center justify-center bg-[color:var(--overlay-scrim)] px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={longTextDialogTitle}
            className="flex max-h-[min(42rem,calc(100vh-48px))] w-full max-w-3xl flex-col rounded-2xl border border-line bg-surface shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h3 className="text-[14px] font-bold text-ink">{longTextDialogTitle}</h3>
              <button
                type="button"
                onClick={cancelDialogEdit}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
                aria-label="关闭编辑弹窗"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 p-4">
              <textarea
                autoFocus
                value={draft}
                onChange={event => setDraft(event.target.value)}
                className={`h-[min(28rem,calc(100vh-15rem))] w-full resize-none rounded-xl border border-line bg-surface-muted px-3 py-2 text-[13px] leading-6 text-ink outline-none transition-colors focus:border-accent/60 focus:ring-2 focus:ring-accent/20 ${monospace ? 'font-mono' : ''}`}
              />
              {error && (
                <p role="alert" className="mt-2 text-[12px] text-[color:var(--danger)]">
                  {error}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <button
                type="button"
                onClick={cancelDialogEdit}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px] font-bold text-ink transition-colors hover:bg-surface-muted"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => { void commit() }}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[12px] font-bold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}
      {(saving || saved || error) && (
        <p
          aria-live="polite"
          className={`mt-1 flex items-center gap-1 text-[11px] ${error ? 'text-[color:var(--danger)]' : 'text-ink-faint'}`}
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          {error || (saving ? '保存中...' : '已保存')}
        </p>
      )}
    </div>
  )
}

function FieldHelp({ label, text }: { label: string; text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={`${label} 填写说明`}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-faint transition-colors hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      >
        <CircleHelp className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full layer-tooltip mt-1 hidden w-64 -translate-x-1/2 rounded-lg border border-line bg-surface px-3 py-2 text-[11px] font-normal leading-5 text-ink-soft shadow-xl group-focus-within:block group-hover:block"
      >
        {text}
      </span>
    </span>
  )
}

function FieldLabel({ children, help }: { children: string; help?: string }) {
  return (
    <p className="flex items-center gap-1 px-2 text-[11px] font-bold text-ink-faint">
      <span>{children}</span>
      {help && <FieldHelp label={children} text={help} />}
    </p>
  )
}

export function TeamSettingsTab({
  teams,
  skills,
  globalSkills,
  onUpdated,
}: {
  teams: TeamListItem[]
  skills: SkillConfig[]
  globalSkills: ReadOnlySkill[]
  onUpdated: (team: TeamListItem) => void
}) {
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [localTeams, setLocalTeams] = useState<TeamListItem[]>(teams)
  const [currentTeamProvider, setCurrentTeamProvider] = useState<ProviderName>('opencode')
  const [providerSaving, setProviderSaving] = useState(false)
  const [providerStatus, setProviderStatus] = useState('')
  const [providerError, setProviderError] = useState('')
  const [skillPickerMemberId, setSkillPickerMemberId] = useState<string | null>(null)

  useEffect(() => setLocalTeams(teams), [teams])

  useEffect(() => {
    setSkillPickerMemberId(null)
  }, [selectedTeamId])

  useEffect(() => {
    if (selectedTeamId && localTeams.some(team => team.id === selectedTeamId)) return
    setSelectedTeamId(localTeams[0]?.id ?? '')
  }, [selectedTeamId, localTeams])

  const selectedTeam = useMemo(
    () => localTeams.find(team => team.id === selectedTeamId) ?? localTeams[0],
    [selectedTeamId, localTeams],
  )
  const activeVersion = selectedTeam?.activeVersion
  const routingRules = formatRoutingPolicy(activeVersion?.routingPolicy)
  const routingRulesText = routingRules.join('\n')
  const teamMemory = activeVersion?.teamMemory ?? []
  const members = fallbackMembers(selectedTeam)
  const skillOptions = useMemo<SkillPickerOption[]>(() => [
    ...skills
      .filter(skill => skill.enabled)
      .map(skill => ({
        key: `managed:${skill.id}`,
        source: 'managed' as const,
        id: skill.id,
        name: skill.name,
        description: skill.description,
        providerCompat: skill.providerCompat,
      })),
    ...globalSkills.map(skill => ({
      key: `${skill.sourceType}:${skill.sourcePath}`,
      source: skill.sourceType,
      name: skill.name,
      description: skill.description,
      sourcePath: skill.sourcePath,
      providerCompat: skill.providerCompat ?? PROVIDER_OPTIONS.map(option => option.value),
    })),
  ], [globalSkills, skills])

  async function onSaveTeamSettings(teamId: string, patch: TeamSettingsPatch) {
    const response = await fetch(`${API}/api/teams/${teamId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const data = await response.json().catch(() => ({})) as TeamListItem & { error?: string }
    if (!response.ok) throw new Error(data.error ?? '保存失败')
    setLocalTeams(previous => previous.map(team => team.id === data.id ? data : team))
    onUpdated(data)
  }

  function saveSelected(patch: TeamSettingsPatch) {
    if (!selectedTeam) return Promise.resolve()
    return onSaveTeamSettings(selectedTeam.id, patch)
  }

  function saveMembers(nextMembers: TeamMemberSnapshot[]) {
    return saveSelected({ version: { memberSnapshots: nextMembers } })
  }

  function updateMember(memberId: string, update: Partial<TeamMemberSnapshot>) {
    const nextMembers = members.map(member => member.id === memberId ? { ...member, ...update } : member)
    return saveMembers(nextMembers)
  }

  function onSelectMemberSkill(member: TeamMemberSnapshot, optionKey: string) {
    const option = skillOptions.find(item => item.key === optionKey)
    if (!option) return Promise.resolve()
    const currentRefs = getMemberSkillRefs(member, skills)
    const nextRefs = Array.from(new Map(
      [...currentRefs, optionToSkillRef(option)].map(ref => [skillRefKey(ref), ref]),
    ).values())
    setSkillPickerMemberId(null)
    return updateMember(member.id, {
      skillIds: skillIdsFromRefs(nextRefs),
      skillRefs: nextRefs,
    })
  }

  function onRemoveMemberSkill(member: TeamMemberSnapshot, refKey: string) {
    const nextRefs = getMemberSkillRefs(member, skills).filter(ref => skillRefKey(ref) !== refKey)
    return updateMember(member.id, {
      skillIds: skillIdsFromRefs(nextRefs),
      skillRefs: nextRefs,
    })
  }

  async function applyProviderToCurrentTeam() {
    if (!selectedTeam) return
    setProviderSaving(true)
    setProviderStatus('')
    setProviderError('')
    try {
      await saveMembers(members.map(member => ({ ...member, provider: currentTeamProvider })))
      setProviderStatus('已应用到当前 Team')
      window.setTimeout(() => setProviderStatus(''), 1600)
    } catch (err) {
      setProviderError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setProviderSaving(false)
    }
  }

  if (localTeams.length === 0) {
    return (
      <section className="rounded-2xl border border-line bg-surface-muted p-6 text-center">
        <p className="text-[15px] font-bold text-ink">Team 设置</p>
        <p className="mt-2 text-[13px] text-ink-soft">还没有可用 Team。</p>
      </section>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(14rem,18rem)_1fr]">
      <aside className="rounded-2xl border border-line bg-surface-muted p-3">
        <div className="mb-3 flex items-center gap-2 px-2">
          <UsersRound className="h-4 w-4 text-accent" aria-hidden />
          <h2 className="text-[14px] font-bold text-ink">Team 设置</h2>
        </div>
        <div className="space-y-1">
          {localTeams.map(team => {
            const selected = team.id === selectedTeam?.id
            return (
              <button
                key={team.id}
                type="button"
                onClick={() => setSelectedTeamId(team.id)}
                className={`w-full rounded-xl px-3 py-2 text-left transition-colors ${
                  selected ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft hover:bg-surface hover:text-ink'
                }`}
              >
                <span className="block truncate text-[13px] font-bold">{team.name}</span>
                <span className="mt-1 block truncate text-[11px] text-ink-faint">
                  v{team.activeVersion.versionNumber} · {team.members.length} 位成员
                </span>
              </button>
            )
          })}
        </div>
      </aside>

      {selectedTeam && activeVersion && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface-muted p-4">
            <h3 className="text-[13px] font-bold text-ink">Team 信息</h3>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <EditableText
                  value={selectedTeam.name}
                  className="text-[18px] font-bold"
                  onSave={value => saveSelected({ name: value, version: { name: value } })}
                />
                <EditableText
                  value={selectedTeam.description ?? ''}
                  placeholder="点击补充 Team 说明"
                  multiline
                  className="mt-1 max-w-3xl text-[13px] leading-6 text-ink-soft"
                  onSave={value => saveSelected({ description: value, version: { description: value } })}
                />
              </div>
              <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-bold text-ink-soft">
                <GitBranch className="h-3.5 w-3.5" aria-hidden />
                当前版本 v{activeVersion.versionNumber}
              </span>
            </div>
          </div>

          <section className="space-y-3">
            <h3 className="text-[13px] font-bold text-ink">Team 分工</h3>
            <div className="grid gap-4 xl:grid-cols-2">
              <section className="rounded-2xl border border-line bg-surface-muted p-4">
                <h4 className="text-[13px] font-bold text-ink">协作方式</h4>
                <EditableText
                  value={activeVersion.workflowPrompt || ''}
                  placeholder="点击配置协作方式"
                  multiline
                  className="mt-3 max-h-80 overflow-y-auto border border-line bg-surface p-3 text-ink-soft custom-scrollbar"
                  onSave={value => saveSelected({ version: { workflowPrompt: value } })}
                />
              </section>

              <section className="rounded-2xl border border-line bg-surface-muted p-4">
                <h4 className="text-[13px] font-bold text-ink">分工规则</h4>
                <EditableText
                  value={routingRulesText}
                  placeholder="每行一条，例如：需求不清 -> 需求澄清成员"
                  multiline
                  className="mt-3 border border-line bg-surface p-3 text-ink-soft"
                  onSave={value => saveSelected({ version: { routingPolicy: { rules: splitLines(value) } } })}
                />
                {routingRules.length > 0 && (
                  <ul className="mt-3 space-y-2 text-[12px] leading-5 text-ink-soft">
                    {routingRules.map((rule, index) => (
                      <li key={`${rule}-${index}`} className="flex gap-2">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                        <span>{rule}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <section className="rounded-2xl border border-line bg-surface-muted p-4">
              <h4 className="text-[13px] font-bold text-ink">长期记忆</h4>
              <EditableText
                value={teamMemory.join('\n')}
                placeholder="每行一条长期记忆"
                multiline
                className="mt-3 border border-line bg-surface p-3 text-ink-soft"
                onSave={value => saveSelected({ version: { teamMemory: splitLines(value) } })}
              />
            </section>
          </section>

          <section className="rounded-2xl border border-line bg-surface-muted p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-[13px] font-bold text-ink">Team 成员</h3>
                <p className="mt-1 text-[12px] text-ink-soft">{members.length} 位成员</p>
              </div>
              <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-[minmax(0,1fr)_auto]">
                <CustomSelect<ProviderName>
                  value={currentTeamProvider}
                  onChange={setCurrentTeamProvider}
                  options={PROVIDER_OPTIONS}
                  ariaLabel="选择当前 Team 执行工具"
                  className="min-w-44"
                  buttonClassName="h-9 rounded-lg px-3 py-2 text-[12px]"
                />
                <button
                  type="button"
                  disabled={providerSaving}
                  onClick={() => void applyProviderToCurrentTeam()}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-accent px-3 text-[12px] font-bold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {providerSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  )}
                  应用到当前 Team
                </button>
              </div>
            </div>
            {(providerStatus || providerError) && (
              <p className={`mt-2 text-[11px] ${providerError ? 'text-[color:var(--danger)]' : 'text-ink-faint'}`}>
                {providerError || providerStatus}
              </p>
            )}
            <div className="mt-3 grid gap-2 xl:grid-cols-2">
              {members.map(member => (
                <div key={member.id} className="rounded-xl border border-line bg-surface px-3 py-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <div className="min-w-0">
                      <FieldLabel help="成员名称：给这个成员起一个好识别的名字，例如 信息搜集专员、风险审查员。">成员名称</FieldLabel>
                      <EditableText
                        value={member.name}
                        placeholder="成员名称"
                        className="font-bold"
                        onSave={value => updateMember(member.id, { name: value })}
                      />
                    </div>
                    <div className="sm:w-44">
                      <FieldLabel help="执行工具：选择这个成员实际调用哪个 CLI 工具，例如 OpenCode 或 Codex CLI。">执行工具</FieldLabel>
                      <CustomSelect<ProviderName>
                        value={member.provider}
                        onChange={provider => void updateMember(member.id, { provider })}
                        options={PROVIDER_OPTIONS}
                        ariaLabel={`选择 ${member.name} 的执行工具`}
                        buttonClassName="h-8 rounded-lg bg-surface-muted px-2 py-1 text-[12px]"
                      />
                    </div>
                  </div>
                  <div className="mt-2">
                    <div>
                      <FieldLabel help="角色分工：一句话说明它在 Team 里的身份，例如 信息搜集、方案设计、审查把关。">角色分工</FieldLabel>
                      <EditableText
                        value={member.roleLabel}
                        placeholder="角色分工"
                        onSave={value => updateMember(member.id, { roleLabel: value })}
                      />
                    </div>
                  </div>
                  <div className="relative mt-2">
                    <FieldLabel help="Skill：从系统维护或系统扫描到的 Skill 中选择这个成员运行时需要的能力包。">Skill</FieldLabel>
                    <div className="mt-1 flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface-muted px-2 py-1.5">
                      {getMemberSkillRefs(member, skills).length === 0 ? (
                        <span className="text-[12px] text-ink-faint">未配置 Skill</span>
                      ) : (
                        getMemberSkillRefs(member, skills).map(ref => {
                          const refKey = skillRefKey(ref)
                          return (
                            <span
                              key={refKey}
                              className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-soft"
                            >
                              <span className="truncate">{ref.name}</span>
                              <span className="rounded bg-surface-muted px-1 text-[10px] font-bold text-ink-faint">{skillSourceLabel(ref.source)}</span>
                              <button
                                type="button"
                                onClick={() => void onRemoveMemberSkill(member, refKey)}
                                className="inline-flex h-4 w-4 items-center justify-center rounded text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink"
                                aria-label={`移除 ${member.name} 的 ${ref.name} Skill`}
                              >
                                <X className="h-3 w-3" aria-hidden />
                              </button>
                            </span>
                          )
                        })
                      )}
                      <button
                        type="button"
                        onClick={() => setSkillPickerMemberId(current => current === member.id ? null : member.id)}
                        className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink-soft transition-colors hover:border-accent/40 hover:text-accent"
                        aria-label={`给 ${member.name} 添加 Skill`}
                        title="添加 Skill"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                    {skillPickerMemberId === member.id && (
                      <div className="absolute left-0 right-0 top-full layer-dropdown mt-1 rounded-xl border border-line bg-surface p-2 shadow-xl">
                        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">可用 Skill</p>
                        <div className="max-h-56 overflow-y-auto custom-scrollbar">
                          {skillOptions.filter(option => (
                            isSkillOptionCompatibleWithProvider(option, member.provider)
                            && !new Set(getMemberSkillRefs(member, skills).map(skillRefKey)).has(option.key)
                          )).length === 0 ? (
                            <p className="px-2 py-3 text-[12px] text-ink-soft">没有可添加的 Skill</p>
                          ) : (
                            skillOptions
                              .filter(option => (
                                isSkillOptionCompatibleWithProvider(option, member.provider)
                                && !new Set(getMemberSkillRefs(member, skills).map(skillRefKey)).has(option.key)
                              ))
                              .map(option => (
                                <button
                                  key={option.key}
                                  type="button"
                                  onClick={() => void onSelectMemberSkill(member, option.key)}
                                  className="flex w-full flex-col rounded-lg px-2 py-2 text-left text-ink transition-colors hover:bg-surface-muted"
                                >
                                  <span className="flex min-w-0 items-center gap-2">
                                    <span className="truncate text-[13px] font-semibold">{option.name}</span>
                                    <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-bold text-ink-faint">{skillSourceLabel(option.source)}</span>
                                  </span>
                                  {option.description && (
                                    <span className="mt-0.5 line-clamp-2 text-[11px] text-ink-faint">{option.description}</span>
                                  )}
                                </button>
                              ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mt-2">
                    <FieldLabel help="负责什么：写清楚它主要产出什么，例如 搜集资料、写方案、做审查。">负责什么</FieldLabel>
                    <EditableText
                      value={member.responsibility ?? ''}
                      placeholder="负责什么"
                      multiline
                      longTextDialogTitle="编辑负责什么"
                      className="text-ink-soft"
                      onSave={value => updateMember(member.id, { responsibility: value })}
                    />
                  </div>
                  <div className="mt-2">
                    <FieldLabel help="什么时候用它：写清楚什么情况下该找它，例如 用户要查资料时。">什么时候用它</FieldLabel>
                    <EditableText
                      value={member.whenToUse ?? ''}
                      placeholder="什么时候用它"
                      multiline
                      longTextDialogTitle="编辑什么时候用它"
                      className="text-ink-soft"
                      onSave={value => updateMember(member.id, { whenToUse: value })}
                    />
                  </div>
                  <div className="mt-2">
                    <FieldLabel help="详细工作说明：给执行工具看的完整工作要求，适合写边界、步骤、输出格式和注意事项。">详细工作说明，高级</FieldLabel>
                    <EditableText
                      value={member.systemPrompt}
                      placeholder="详细工作说明，高级"
                      multiline
                      monospace
                      longTextDialogTitle="编辑详细工作说明"
                      className="text-ink-soft"
                      onSave={value => updateMember(member.id, { systemPrompt: value })}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </section>
      )}
    </div>
  )
}
