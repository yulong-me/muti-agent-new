'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, Play, BrainCircuit } from 'lucide-react'

const API = 'http://localhost:7001'

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

const PROVIDER_COLORS: Record<string, string> = {
  'claude-code': 'var(--accent)',
  'opencode': '#7C3AED',
}

const PROVIDER_LABELS: Record<string, string> = {
  'claude-code': 'Claude',
  'opencode': 'OpenCode',
}

const DOMAIN_COLORS: Record<string, { bg: string; text: string; border: string }> = {
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
  '#D97706', '#059669', '#DC2626', '#4D7C0F', '#9F1239',
  '#2563EB', '#7C3AED', '#0284C7', '#0D9488', '#EA580C',
]
function agentColor(name: string): string {
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length] ?? '#888'
}

export default function CreateRoomModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  const [agents, setAgents] = useState<AgentConfig[]>([])
  const [loadingAgents, setLoadingAgents] = useState(true)
  const topic = '自由讨论'
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  useEffect(() => {
    if (!isOpen) return
    fetch(`${API}/api/agents`)
      .then(r => r.json())
      .then((data: AgentConfig[]) => {
        setAgents(data.filter(a => a.role !== 'MANAGER' && a.enabled))
        setLoadingAgents(false)
      })
      .catch(() => setLoadingAgents(false))
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      setSelected(new Set())
      setActiveTag(null)
      setError('')
    }
  }, [isOpen])

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

  async function handleSubmit() {
    if (selected.size < 1) return
    setSubmitting(true)
    setError('')
    const selectedAgents = agents.filter(a => selected.has(a.id))
    try {
      const res = await fetch(`${API}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          agents: selectedAgents.map(a => a.id),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError((err as { error?: string }).error ?? '创建失败')
        return
      }
      const room = await res.json()
      onClose()
      router.push(`/room/${room.id}`)
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const filteredAgents = activeTag ? agents.filter(a => a.tags.includes(activeTag)) : agents
  const selectedAgents = agents.filter(a => selected.has(a.id))

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label="关闭"
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') onClose() }}
      />
      <div
        role="dialog"
        aria-modal
        aria-label="发起新讨论"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
      >
        <div className="bg-bg rounded-3xl shadow-2xl p-6 md:p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-line custom-scrollbar pointer-events-auto">

          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
                <BrainCircuit className="w-6 h-6 text-accent" aria-hidden/> 发起新讨论
              </h1>
              <p className="text-ink-soft mt-1 text-[14px]">选择 Agent，开启多智能体协作讨论</p>
            </div>
            <button onClick={onClose} aria-label="关闭" className="p-2 text-ink-soft hover:text-ink hover:bg-surface rounded-full transition-colors">
              <X className="w-5 h-5" aria-hidden/>
            </button>
          </div>

          {/* Tag Filter Bar */}
          {!loadingAgents && agents.length > 0 && (() => {
            const availableTags = [...new Set(agents.flatMap(a => a.tags))]
            return (
              <div className="flex flex-wrap gap-2 mb-5" role="group" aria-label="按领域筛选">
                <button
                  type="button"
                  onClick={() => setActiveTag(null)}
                  className={`px-4 py-1.5 rounded-full text-[12px] font-bold border transition-all ${
                    activeTag === null
                      ? 'bg-ink text-bg border-ink shadow-sm'
                      : 'bg-surface text-ink-soft border-line hover:border-ink/40'
                  }`}
                >
                  全部
                </button>
                {availableTags.map(tag => {
                  const dc = getTagStyle(tag)
                  const isActive = activeTag === tag
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setActiveTag(isActive ? null : tag)}
                      className={`px-4 py-1.5 rounded-full text-[12px] font-bold border transition-all ${
                        isActive
                          ? 'shadow-sm'
                          : 'bg-surface text-ink-soft border-line hover:border-ink/40'
                      }`}
                      style={isActive ? { backgroundColor: dc.bg, color: dc.text, borderColor: dc.border } : {}}
                      aria-pressed={isActive}
                    >
                      {tag}
                    </button>
                  )
                })}
              </div>
            )
          })()}

        {/* Agent Grid */}
        {loadingAgents ? (
          <div className="text-center py-10 text-ink-soft text-sm">加载 Agent 配置...</div>
        ) : filteredAgents.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-ink-soft text-sm mb-3">该领域暂无 Agent</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
            {filteredAgents.map(ag => {
              const isSelected = selected.has(ag.id)
              const color = agentColor(ag.name)
              const domainTag = ag.tags[0] // first tag is the domain
              return (
                <button
                  key={ag.id}
                  type="button"
                  onClick={() => toggleAgent(ag.id)}
                  className={`flex flex-col items-center p-4 rounded-2xl border-2 transition-all text-left ${
                    isSelected
                      ? 'border-accent bg-accent/5 shadow-sm'
                      : 'border-line bg-surface hover:border-accent/40'
                  }`}
                  aria-pressed={isSelected}
                >
                  <div className="relative">
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold mb-2 shadow-sm"
                      style={{ backgroundColor: color }}
                    >
                      {ag.name.slice(0, 1)}
                    </div>
                    {isSelected && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-accent rounded-full flex items-center justify-center shadow">
                        <CheckIcon />
                      </div>
                    )}
                  </div>
                  <p className="text-[14px] font-bold text-ink">{ag.name}</p>
                  <p className="text-[11px] text-ink-soft mt-0.5">{ag.roleLabel}</p>
                  {domainTag && (
                    <span
                      className="mt-2 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider"
                      style={{ backgroundColor: getTagStyle(domainTag).bg, color: getTagStyle(domainTag).text }}
                    >
                      {domainTag}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Selected */}
        <div className="mb-5 bg-surface p-4 rounded-2xl border border-line">
          <p className="text-[13px] font-bold text-ink mb-3 uppercase tracking-wide">
            已选 {selected.size} 位 Agent{selected.size < 1 ? '（至少选 1 位）' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {selectedAgents.map(ag => {
              const color = agentColor(ag.name)
              return (
                <div
                  key={ag.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-bg border"
                  style={{ borderColor: color + '40' }}
                >
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: color }}>
                    {ag.name.slice(0, 1)}
                  </div>
                  <span className="font-bold text-[13px]" style={{ color }}>{ag.name}</span>
                  <button type="button" onClick={() => toggleAgent(ag.id)} aria-label={`移除 ${ag.name}`} className="ml-1 opacity-50 hover:opacity-100 text-ink-soft"><X className="w-3.5 h-3.5" aria-hidden/></button>
                </div>
              )
            })}
            {selected.size === 0 && (
              <p className="text-[13px] text-ink-soft italic">点击上方卡片选择 Agent</p>
            )}
          </div>
        </div>

{error && <p className="text-xs text-red-500 mb-4 px-2">{error}</p>}

        <button
          type="button"
          className="w-full bg-ink text-bg font-bold py-4 rounded-xl hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-md active:scale-[0.99] disabled:active:scale-100"
          onClick={handleSubmit}
          disabled={submitting || selected.size < 1}
        >
          <Play className="w-4 h-4 fill-current" aria-hidden/>
          {submitting ? '创建中...' : '加入讨论'}
        </button>
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
