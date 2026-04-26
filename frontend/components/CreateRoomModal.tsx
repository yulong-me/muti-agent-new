'use client'

import { useState, useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { X, Play, BrainCircuit, Search, ChevronDown } from 'lucide-react'
import { DirectoryPicker } from './DirectoryPicker'
import { API_URL } from '@/lib/api'
import { resolveEffectiveAgentModel } from '@/lib/agentModels'
import { buildSettingsHref } from '../lib/settingsTabs'
import { debug, info, warn } from '@/lib/logger'

const API = API_URL;

interface AgentConfig {
  id: string
  name: string
  roleLabel: string
  role: 'MANAGER' | 'WORKER' | 'USER'
  provider: 'claude-code' | 'opencode'
  providerOpts: { thinking?: boolean; [key: string]: unknown }
  systemPrompt: string
  enabled: boolean
  tags: string[]
}

type ProviderReadinessStatus = 'ready' | 'cli_missing' | 'untested' | 'test_failed'

interface ProviderReadiness {
  provider: string
  label: string
  cliPath: string
  cliAvailable: boolean
  status: ProviderReadinessStatus
  message: string
  resolvedPath?: string
}

interface RoomPreflightIssue {
  type: string
  provider?: string
  label?: string
  cliPath?: string
  agentIds: string[]
  agentNames: string[]
  message: string
}

interface RoomPreflightResult {
  ok: boolean
  blockers: RoomPreflightIssue[]
  warnings: RoomPreflightIssue[]
}

const PROVIDER_LABELS: Record<string, string> = {
  'claude-code': 'Claude',
  'opencode': 'OpenCode',
}

const PROVIDER_READINESS_META: Record<ProviderReadinessStatus, { label: string; className: string }> = {
  ready: { label: 'Ready', className: 'tone-success-pill border' },
  cli_missing: { label: 'CLI 未配置', className: 'tone-danger-panel border' },
  untested: { label: '待测试', className: 'tone-warning-pill border' },
  test_failed: { label: '测试失败', className: 'tone-warning-pill border' },
}

const DOMAIN_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  '圆桌论坛': { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
  '软件开发': { bg: '#DBEAFE', text: '#1E40AF', border: '#93C5FD' },
  '人物视角': { bg: '#F3F4F6', text: '#374151', border: '#D1D5DB' },
  '需求': { bg: '#FCE7F3', text: '#9D174D', border: '#F9A8D4' },
  '架构': { bg: '#E0F2FE', text: '#075985', border: '#7DD3FC' },
  '实现': { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  'review': { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5' },
  '测试': { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
  '历史': { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
  '科技': { bg: '#DBEAFE', text: '#1E40AF', border: '#93C5FD' },
  '财经': { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  '哲学': { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
}
const DEFAULT_TAG_COLOR = { bg: '#F3F4F6', text: '#374151', border: '#D1D5DB' }

function getTagStyle(tag: string) {
  return DOMAIN_COLORS[tag] ?? DEFAULT_TAG_COLOR
}

const AGENT_COLORS = [
  '#C43A2F', '#7C3AED', '#0E8345', '#1F3A8A', '#475569',
  '#2563EB', '#B5832A', '#0F766E', '#4338CA', '#64748B',
]
function agentColor(name: string): string {
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length] ?? '#888'
}

export default function CreateRoomModal({
  isOpen,
  onClose,
  initialTopic,
  initialSceneId,
  initialWorkerIds,
}: {
  isOpen: boolean
  onClose: () => void
  initialTopic?: string
  initialSceneId?: string
  initialWorkerIds?: string[]
}) {
  const [allAgents, setAllAgents] = useState<AgentConfig[]>([])
  const [loadingAgents, setLoadingAgents] = useState(true)
  const [topic, setTopic] = useState(initialTopic ?? '')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialWorkerIds ?? []))
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [workspacePath, setWorkspacePath] = useState('')
  const [searchText, setSearchText] = useState('')
  const [errors, setErrors] = useState<{ topic?: string; agents?: string }>({})
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [scenes, setScenes] = useState<Array<{ id: string; name: string; description?: string }>>([])
  const [sceneId, setSceneId] = useState(initialSceneId ?? 'roundtable-forum')
  const [loadingScenes, setLoadingScenes] = useState(false)
  const [providerReadiness, setProviderReadiness] = useState<Record<string, ProviderReadiness>>({})
  const [loadingProviderReadiness, setLoadingProviderReadiness] = useState(false)
  const [preflightWarnings, setPreflightWarnings] = useState<RoomPreflightIssue[]>([])
  const router = useRouter()
  const pathname = usePathname()
  const topicRef = useRef<HTMLInputElement>(null)
  const agentGridRef = useRef<HTMLDivElement>(null)

  const workers = allAgents.filter(a => a.role === 'WORKER' && a.enabled)
  const sceneAgentTag = scenes.find(s => s.id === sceneId)?.name ?? null
  const sceneFilterTag = sceneAgentTag && workers.some(worker => worker.tags.includes(sceneAgentTag))
    ? sceneAgentTag
    : null
  const hasInitialWorkerPreset = (initialWorkerIds?.length ?? 0) > 0
  const shouldKeepInitialWorkerPreset = hasInitialWorkerPreset && sceneId === initialSceneId
  const sceneFilterHint = sceneId === 'software-development'
    ? '已默认筛选双架构、实现、审查核心角色。创建时必须包含主架构师、挑战架构师、实现工程师、Reviewer。'
    : sceneFilterTag
      ? `已默认筛选 ${sceneFilterTag} 相关专家，可切换为全部。`
      : shouldKeepInitialWorkerPreset
        ? '已带入该场景的默认专家组，可继续调整。'
      : ''
  const minimumWorkerCount = sceneId === 'roundtable-forum' ? 3 : sceneId === 'software-development' ? 4 : 1
  const minimumWorkerError = sceneId === 'roundtable-forum'
    ? '圆桌论坛至少选择 3 位专家'
    : sceneId === 'software-development'
      ? '软件开发至少选择 4 位核心专家（主架构师、挑战架构师、实现工程师、Reviewer）'
    : '请至少选择 1 位专家'
  const selectedWorkers = workers.filter(a => selected.has(a.id))
  const selectedProviderNames = [...new Set(selectedWorkers.map(worker => worker.provider))]
  const selectedProviderReadiness = selectedProviderNames
    .map(provider => providerReadiness[provider])
    .filter((readiness): readiness is ProviderReadiness => Boolean(readiness))
  const selectedCliBlockers = selectedWorkers.filter(worker => providerReadiness[worker.provider]?.status === 'cli_missing')
  const providerBlockerMessage = selectedCliBlockers.length > 0
    ? `Provider CLI 未准备好：${[...new Set(selectedCliBlockers.map(worker => providerReadiness[worker.provider]?.label ?? worker.provider))].join('、')}`
    : ''

  useEffect(() => {
    if (!isOpen) return
    debug('ui:room_create:modal_open')
    fetch(`${API}/api/agents`)
      .then(r => r.json())
      .then((data: AgentConfig[]) => {
        setAllAgents(data)
        setLoadingAgents(false)
        debug('ui:room_create:agents_loaded', { count: data.length })
      })
      .catch((err) => {
        warn('ui:room_create:agents_load_failed', { error: err })
        setLoadingAgents(false)
      })
    // F016: fetch scenes
    setLoadingScenes(true)
    fetch(`${API}/api/scenes`)
      .then(r => r.json())
      .then((data: Array<{ id: string; name: string; description?: string }>) => {
        setScenes(data)
        setLoadingScenes(false)
        debug('ui:room_create:scenes_loaded', { count: data.length })
      })
      .catch((err) => {
        warn('ui:room_create:scenes_load_failed', { error: err })
        setLoadingScenes(false)
      })
    setLoadingProviderReadiness(true)
    fetch(`${API}/api/providers/readiness`)
      .then(r => r.json())
      .then((data: Record<string, ProviderReadiness>) => {
        setProviderReadiness(data)
        setLoadingProviderReadiness(false)
        debug('ui:room_create:provider_readiness_loaded', { count: Object.keys(data).length })
      })
      .catch((err) => {
        warn('ui:room_create:provider_readiness_failed', { error: err })
        setLoadingProviderReadiness(false)
      })
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      setSelected(new Set())
      setActiveTag(null)
      setWorkspacePath('')
      setTopic('')
      setSearchText('')
      setErrors({})
      setPreflightWarnings([])
      setWorkspaceOpen(false)
      setSceneId('roundtable-forum')
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    setActiveTag(sceneFilterTag)
    if (!shouldKeepInitialWorkerPreset) {
      setSelected(new Set())
    }
    setErrors(prev => ({ ...prev, agents: undefined }))
  }, [isOpen, sceneFilterTag, shouldKeepInitialWorkerPreset])

  useEffect(() => {
    if (!isOpen) return
    setTopic(initialTopic ?? '')
    setSceneId(initialSceneId ?? 'roundtable-forum')
    setSelected(new Set(initialWorkerIds ?? []))
    setErrors({})
    setPreflightWarnings([])
    setSearchText('')
  }, [initialTopic, initialSceneId, initialWorkerIds, isOpen])

  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  function toggleAgent(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleManageScenes() {
    debug('ui:room_create:manage_scenes')
    onClose()
    router.push(buildSettingsHref('scene', pathname))
  }

  function handleManageProviders() {
    debug('ui:room_create:manage_providers')
    onClose()
    router.push(buildSettingsHref('provider', pathname))
  }

  async function handleSubmit() {
    const newErrors: { topic?: string; agents?: string } = {}
    if (selectedWorkers.length < minimumWorkerCount) {
      newErrors.agents = minimumWorkerError
    }
    if (selectedCliBlockers.length > 0) {
      newErrors.agents = providerBlockerMessage || 'Provider CLI 未准备好'
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      if (newErrors.agents) agentGridRef.current?.focus()
      return
    }
    setSubmitting(true)
    setErrors({})
    info('ui:room_create:submit', {
      topicLength: topic.trim().length,
      workerCount: selectedWorkers.length,
      hasWorkspace: Boolean(workspacePath.trim()),
      sceneId,
    })
    try {
      const preflightResponse = await fetch(`${API}/api/rooms/preflight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workerIds: workers.filter(a => selected.has(a.id)).map(a => a.id),
          sceneId,
        }),
      })
      const preflight = await preflightResponse.json().catch(() => null) as RoomPreflightResult | null
      if (preflight && Array.isArray(preflight.blockers) && Array.isArray(preflight.warnings)) {
        setPreflightWarnings(preflight.warnings ?? [])
        if (!preflight.ok) {
          const msg = preflight.blockers.map(blocker => blocker.message).join('；') || 'Provider CLI 未准备好'
          setErrors({ agents: msg })
          warn('ui:room_create:preflight_blocked', {
            blockerCount: preflight.blockers.length,
            warningCount: preflight.warnings.length,
            sceneId,
          })
          return
        }
      }

      const res = await fetch(`${API}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim() || `未命名讨论 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
          workerIds: workers.filter(a => selected.has(a.id)).map(a => a.id),
          ...(workspacePath.trim() ? { workspacePath: workspacePath.trim() } : {}),
          sceneId, // F016
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const msg = (err as { error?: string }).error ?? '创建失败'
        if (msg.includes('topic') || msg.includes('主题')) {
          setErrors({ topic: msg })
          topicRef.current?.focus()
        } else {
          setErrors({ agents: msg })
        }
        warn('ui:room_create:submit_failed', {
          status: res.status,
          error: msg,
          workerCount: selectedWorkers.length,
          sceneId,
        })
        return
      }
      const room = await res.json()
      info('ui:room_create:success', {
        roomId: room.id,
        workerCount: selectedWorkers.length,
        sceneId,
        hasWorkspace: Boolean(workspacePath.trim()),
      })
      onClose()
      router.push(`/room/${room.id}`, { scroll: false })
    } catch (err) {
      warn('ui:room_create:network_failed', { error: err, sceneId })
      setErrors({ agents: '网络错误，请重试' })
    } finally {
      setSubmitting(false)
    }
  }

  const filteredWorkers = workers.filter(a => {
    const matchTag = !activeTag || a.tags.includes(activeTag)
    const matchSearch = !searchText ||
      a.name.toLowerCase().includes(searchText.toLowerCase()) ||
      a.roleLabel.toLowerCase().includes(searchText.toLowerCase()) ||
      a.tags.some(tag => tag.toLowerCase().includes(searchText.toLowerCase()))
    return matchTag && matchSearch
  })

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label="关闭"
        className="fixed inset-0 z-50 bg-[color:var(--overlay-scrim)]"
        onClick={onClose}
        onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') onClose() }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="发起新讨论"
        className="fixed inset-0 z-50 flex items-stretch justify-center p-4 pointer-events-none"
      >
        <div className="app-window-shell rounded-3xl w-full max-w-4xl flex flex-col custom-scrollbar pointer-events-auto overflow-hidden">

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">

            {/* Header */}
            <div className="flex items-start justify-between px-6 md:px-8 pt-6 md:pt-8 pb-5 border-b border-line shrink-0">
              <div>
                <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
                  <BrainCircuit className="w-6 h-6 text-accent" aria-hidden/> 发起新讨论
                </h1>
                <p className="text-ink-soft mt-1 text-[14px]">选择专家，开启多智能体协作讨论</p>
              </div>
              <button onClick={onClose} aria-label="关闭" className="p-2 text-ink-soft hover:text-ink hover:bg-surface-muted rounded-full transition-colors">
                <X className="w-5 h-5" aria-hidden/>
              </button>
            </div>

            {/* Discussion Topic — elevated hierarchy */}
            <div className="px-6 md:px-8 pt-6 mb-1">
              <p className="text-[11px] font-bold text-accent uppercase tracking-widest mb-2">讨论主题</p>
              <input
                ref={topicRef}
                type="text"
                value={topic}
                onChange={e => { setTopic(e.target.value); setErrors(prev => ({ ...prev, topic: undefined })) }}
                placeholder="例如：比较 Claude Code 和 OpenCode 的协作策略…"
                className={`w-full bg-surface border rounded-xl px-4 py-3 text-[14px] text-ink placeholder:text-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all ${
                  errors.topic ? 'border-[color:var(--danger)] ring-1 ring-[color:var(--danger)]/40' : 'border-line'
                }`}
                maxLength={100}
              />
              {errors.topic && <p className="tone-danger-text mt-1.5 text-xs">{errors.topic}</p>}
            </div>

            {/* F016: Scene Selector */}
            <div className="px-6 md:px-8 pt-4 mb-1">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[11px] font-bold text-accent uppercase tracking-widest">讨论场景</p>
                <button
                  type="button"
                  onClick={handleManageScenes}
                  className="text-[11px] font-semibold text-accent hover:underline"
                >
                  管理场景
                </button>
              </div>
              <select
                value={sceneId}
                onChange={e => setSceneId(e.target.value)}
                disabled={loadingScenes}
                className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all appearance-none cursor-pointer"
              >
                {scenes.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.description ? ` — ${s.description}` : ''}
                  </option>
                ))}
              </select>
              {loadingScenes && <p className="text-[11px] text-ink-soft mt-1">加载场景中…</p>}
              {!loadingScenes && sceneFilterHint && (
                <p className="text-[11px] text-ink-soft mt-1">
                  {sceneFilterHint}
                  {sceneId === 'roundtable-forum' ? ' 圆桌论坛强制 3 人及以上。' : ''}
                </p>
              )}
            </div>

            {/* Expert Section Header */}
            <div className="px-6 md:px-8 pt-4 mb-1">
              <p className="text-[11px] font-bold text-accent uppercase tracking-widest mb-2">选择专家</p>
            </div>

            {/* Search + Tag Filter */}
            <div className="px-6 md:px-8 mb-3 space-y-2">
              {/* Search input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-soft pointer-events-none" />
                <input
                  type="text"
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  placeholder="搜索专家姓名或角色…"
                  className="w-full bg-surface border border-line rounded-xl pl-9 pr-4 py-2.5 text-[13px] text-ink placeholder:text-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                />
              </div>
              {/* Tag pills */}
              {!loadingAgents && workers.length > 0 && (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="按领域筛选">
                  <button
                    type="button"
                    onClick={() => setActiveTag(null)}
                    className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-all ${
                      activeTag === null
                        ? 'bg-ink text-bg border-ink shadow-sm'
                        : 'bg-surface text-ink-soft border-line hover:border-accent/40 hover:bg-surface-muted'
                    }`}
                  >
                    全部
                  </button>
                  {[...new Set(workers.flatMap(a => a.tags))].map(tag => {
                    const dc = getTagStyle(tag)
                    const isActive = activeTag === tag
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setActiveTag(isActive ? null : tag)}
                        className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-all ${
                          isActive ? '' : 'bg-surface text-ink-soft border-line hover:border-accent/40 hover:bg-surface-muted'
                        }`}
                        style={isActive ? { backgroundColor: dc.bg, color: dc.text, borderColor: dc.border } : {}}
                        aria-pressed={isActive}
                      >
                        {tag}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Expert Grid */}
            <div ref={agentGridRef} tabIndex={-1} className="px-6 md:px-8 pb-3">
              {loadingAgents ? (
                <div className="text-center py-8 text-ink-soft text-sm">加载 Agent 配置…</div>
              ) : filteredWorkers.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-ink-soft text-sm mb-3">
                    {(activeTag || searchText) ? '未找到匹配的专家' : '该领域暂无专家'}
                  </p>
                  {(activeTag || searchText) && (
                    <button
                      type="button"
                      onClick={() => { setActiveTag(null); setSearchText('') }}
                      className="text-[13px] text-accent hover:underline"
                    >
                      清除筛选
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-5 gap-2">
                  {filteredWorkers.map(ag => {
                    const isSelected = selected.has(ag.id)
                    const color = agentColor(ag.name)
                    const domainTag = ag.tags[0]
                    const effectiveModel = resolveEffectiveAgentModel(ag.provider, ag.providerOpts, {})
                    const readiness = providerReadiness[ag.provider]
                    const readinessMeta = readiness ? PROVIDER_READINESS_META[readiness.status] : null
                    return (
                      <button
                        key={ag.id}
                        type="button"
                        onClick={() => { toggleAgent(ag.id); setErrors(prev => ({ ...prev, agents: undefined })) }}
                        className={`flex min-h-[118px] flex-col items-center p-3 rounded-xl border transition-all text-left ${
                          isSelected ? 'border-accent bg-accent/5 shadow-sm' : 'border-line bg-surface hover:border-accent/40 hover:bg-surface-muted'
                        }`}
                        aria-pressed={isSelected}
                      >
                        <div className="relative">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold mb-1.5 shadow-sm" style={{ backgroundColor: color }}>
                            {ag.name.slice(0, 1)}
                          </div>
                          {isSelected && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-accent rounded-full flex items-center justify-center shadow">
                              <CheckIcon />
                            </div>
                          )}
                        </div>
                        <p className="w-full truncate text-center text-[13px] font-bold text-ink">{ag.name}</p>
                        <p className="mt-0.5 w-full truncate text-center text-[10px] text-ink-soft">{ag.roleLabel}</p>
                        <p className="mt-0.5 w-full truncate text-center text-[9px] text-ink-soft/80 font-mono">
                          {PROVIDER_LABELS[ag.provider]}{effectiveModel ? ` · ${effectiveModel}` : ''}
                        </p>
                        {readinessMeta && readiness.status !== 'ready' && (
                          <span className={`mt-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${readinessMeta.className}`}>
                            {readinessMeta.label}
                          </span>
                        )}
                        {domainTag && (
                          <span className="mt-1.5 max-w-full truncate text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider" style={{ backgroundColor: getTagStyle(domainTag).bg, color: getTagStyle(domainTag).text }}>
                            {domainTag}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
              {providerBlockerMessage && (
                <div className="tone-danger-panel mt-3 rounded-xl border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[12px] font-semibold">
                      {providerBlockerMessage}
                    </p>
                    <button
                      type="button"
                      onClick={handleManageProviders}
                      className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-bold text-bg transition-opacity hover:opacity-90"
                    >
                      去设置 Provider
                    </button>
                  </div>
                </div>
              )}
              {preflightWarnings.length > 0 && !providerBlockerMessage && (
                <div className="tone-warning-pill mt-3 rounded-xl border px-3 py-2 text-[12px] font-semibold">
                  {preflightWarnings.map(warning => warning.message).join('；')}
                </div>
              )}
              {errors.agents && <p className="tone-danger-text mt-2 text-xs">{errors.agents}</p>}
            </div>

            {/* Collapsible Workspace Section */}
            <div className="px-6 md:px-8 pb-4">
              <button
                type="button"
                onClick={() => setWorkspaceOpen(o => !o)}
                className="flex items-center gap-2 text-[12px] text-ink-soft hover:text-ink transition-colors"
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${workspaceOpen ? 'rotate-180' : ''}`} aria-hidden/>
                工作目录（可选）
              </button>
              {workspaceOpen && (
                <div className="mt-2 p-4 bg-surface-muted rounded-2xl border border-line">
                  <DirectoryPicker
                    value={workspacePath}
                    onChange={setWorkspacePath}
                    placeholder="/Users/yulong/work/my-project"
                    inputLabel="工作目录"
                  />
                  <p className="text-[11px] text-ink-soft/60 mt-1.5">留空则使用默认临时工作区，agent 将在该目录下读写文件</p>
                </div>
              )}
            </div>

          </div>

          {/* Sticky Footer: Config Summary + CTA */}
          <div className="shrink-0 border-t border-line px-6 md:px-8 py-4 bg-surface">

            {/* Config Summary */}
            <div className="mb-3">
              <p className="text-[11px] font-bold text-accent uppercase tracking-widest mb-2">配置摘要</p>
              <div className="flex flex-wrap gap-2">
                {selectedWorkers.length > 0 ? selectedWorkers.map(ag => (
                  <span key={ag.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] bg-surface-muted border border-line">
                    <span className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: agentColor(ag.name) }}>
                      {ag.name.slice(0, 1)}
                    </span>
                    <span className="text-ink">{ag.name}</span>
                  </span>
                )) : (
                  <span className="text-[12px] text-ink-soft italic">
                    {selectedWorkers.length < minimumWorkerCount ? minimumWorkerError : '尚未选择专家'}
                  </span>
                )}
              </div>
              {selectedProviderReadiness.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedProviderReadiness.map(readiness => {
                    const meta = PROVIDER_READINESS_META[readiness.status]
                    return (
                      <span key={readiness.provider} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.className}`}>
                        {readiness.label} · {meta.label}
                      </span>
                    )
                  })}
                  {loadingProviderReadiness && <span className="text-[11px] text-ink-soft">检查 Provider 中…</span>}
                </div>
              )}
            </div>

            {/* CTA */}
            <button
              type="button"
              className="w-full bg-ink text-bg font-bold py-4 rounded-xl hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-md active:scale-[0.99] disabled:active:scale-100"
              onClick={handleSubmit}
              disabled={submitting || selectedWorkers.length < minimumWorkerCount || selectedCliBlockers.length > 0}
            >
              <Play className="w-4 h-4 fill-current" aria-hidden/>
              {submitting ? '创建中…' : '创建讨论'}
            </button>

          </div>
        </div>
      </div>
    </>
  )
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 5L4.5 7.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
