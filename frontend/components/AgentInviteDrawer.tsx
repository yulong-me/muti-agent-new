'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Search } from 'lucide-react'
import { getAgentAvatar } from './BubbleSection'
import { AgentAvatar } from './AgentAvatar'
import { API_URL } from '@/lib/api'

const API = API_URL;

interface AgentItem {
  id: string
  name: string
  roleLabel: string
  tags: string[]
}

interface AgentInviteDrawerProps {
  roomId: string
  currentAgentIds: string[]   // configId 列表
  onClose: () => void
  onInvited: (agentId: string) => void
}

/** 从 agents 列表过滤：排除已在 room 的，排除 host */
function useAgentList(excludeIds: string[]) {
  const [agents, setAgents] = useState<AgentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const excludeSet = new Set(excludeIds)
    fetch(`${API}/api/agents`)
      .then(r => r.json())
      .then((data: AgentItem[]) => {
        setAgents(data.filter(a => !excludeSet.has(a.id) && a.id !== 'host'))
      })
      .catch(() => setError('无法加载专家列表'))
      .finally(() => setLoading(false))
  }, [excludeIds.join(',')])

  return { agents, loading, error }
}

export function AgentInviteDrawer({ roomId, currentAgentIds, onClose, onInvited }: AgentInviteDrawerProps) {
  const [query, setQuery] = useState('')
  const [invitingId, setInvitingId] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { agents, loading, error } = useAgentList(currentAgentIds)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const filtered = agents.filter(a =>
    a.name.includes(query) ||
    a.roleLabel.includes(query) ||
    a.tags.some(t => t.includes(query))
  )

  const handleInvite = useCallback(async (agentId: string) => {
    setInvitingId(agentId)
    setInviteError(null)
    try {
      const res = await fetch(`${API}/api/rooms/${roomId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      })
      if (!res.ok) {
        const data = await res.json()
        setInviteError(data.error || '邀请失败')
        return
      }
      setDone(agentId)
      onInvited(agentId)
      // 不自动关闭，用户可继续邀请多个专家
    } catch {
      setInviteError('网络错误')
    } finally {
      setInvitingId(null)
    }
  }, [roomId, onInvited, onClose])

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-xl -webkit-backdrop-blur-xl" onClick={onClose} />

      {/* 弹窗 */}
      
      <div className="relative z-10 app-window-shell rounded-2xl w-full max-w-md flex flex-col overflow-hidden"
           style={{ maxHeight: '70vh' }}
           role="dialog"
           aria-modal="true"
           aria-labelledby="agent-invite-title">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] flex-shrink-0">
          <h2 id="agent-invite-title" className="text-base font-bold text-ink">邀请专家入群</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-ink-soft hover:text-ink hover:bg-white/[0.06] rounded-lg transition-colors"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 搜索框 */}
        <div className="px-4 py-3 border-b border-white/[0.06] flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-soft" />
            <label htmlFor="agent-invite-search" className="sr-only">搜索专家</label>
            <input
              id="agent-invite-search"
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索专家…"
              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-[14px] text-ink placeholder:text-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
            />
          </div>
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto px-2 py-2 min-h-0">
          {inviteError && (
            <div className="px-3 py-2 mb-1 text-xs text-red-400 bg-red-500/10 rounded-lg">{inviteError}</div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-8">
              <span className="text-xs text-ink-soft animate-pulse">加载中…</span>
            </div>
          )}

          {error && (
            <div className="px-3 py-2 text-xs text-red-400">{error}</div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <span className="text-xs text-ink-soft">无匹配专家</span>
            </div>
          )}

          {!loading && filtered.map(agent => {
            const avatar = getAgentAvatar(agent.name)
            const isDone = done === agent.id
            const isInviting = invitingId === agent.id
            return (
              <div
                key={agent.id}
                className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/[0.04] transition-colors"
              >
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full flex-shrink-0 shadow-sm overflow-hidden">
                  <AgentAvatar src={avatar} alt={`${agent.name} 头像`} size={36} className="w-full h-full" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold text-ink">{agent.name}</div>
                  <div className="text-[12px] text-ink-soft truncate">{agent.roleLabel}</div>
                </div>

                {/* 按钮 */}
                <button
                  type="button"
                  onClick={() => handleInvite(agent.id)}
                  disabled={isInviting || isDone}
                  className={`px-4 py-1.5 rounded-xl text-xs font-medium transition-colors flex-shrink-0 ${
                    isDone
                      ? 'bg-emerald-500/20 text-emerald-400 cursor-default'
                      : isInviting
                        ? 'bg-accent/50 text-white cursor-wait'
                        : 'bg-accent hover:bg-accent-deep text-white'
                  }`}
                >
                  {isDone ? '已邀请' : isInviting ? '邀请中…' : '邀请'}
                </button>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/[0.06] flex-shrink-0 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl border border-white/[0.08] text-ink-soft text-sm font-medium transition-colors hover:bg-white/[0.06] hover:text-ink"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
