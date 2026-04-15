'use client'

import { useEffect, useRef } from 'react'
import { AGENT_COLORS, DEFAULT_AGENT_COLOR, type Agent } from '../lib/agents'
import { AgentAvatar } from './AgentAvatar'

export interface QueuedMention {
  agentId: string
  agentName: string
  mentionedBy: 'user' | 'manager'
  status: 'queued' | 'thinking' | 'done'
}

interface MentionQueueProps {
  queue: QueuedMention[]
  agents: Agent[]
  /** 正在流式输出的 agentId（来自 streamingMessagesRef） */
  streamingAgentIds: Set<string>
}

export default function MentionQueue({ queue, agents, streamingAgentIds }: MentionQueueProps) {
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Auto-remove 'done' entries after 3s (cleanup stale timers)
  useEffect(() => {
    return () => {
      timersRef.current.forEach(t => clearTimeout(t))
    }
  }, [])

  if (queue.length === 0) return null

  return (
    <div className="px-4 md:px-8 py-2 bg-surface/80 backdrop-blur-sm rounded-xl border border-line shadow-sm">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-semibold text-ink-soft uppercase tracking-wider shrink-0">
          发言队列
        </span>
        {queue.map(item => {
          const colors = AGENT_COLORS[item.agentName] || DEFAULT_AGENT_COLOR
          const isStreaming = streamingAgentIds.has(item.agentId)

          return (
            <div
              key={item.agentId}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] font-medium transition-all"
              style={{
                backgroundColor: isStreaming ? `${colors.bg}15` : 'transparent',
                borderColor: isStreaming ? `${colors.bg}40` : colors.bg + '30',
                color: isStreaming ? colors.bg : '#6b7280',
              }}
            >
              {/* Status dot */}
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  isStreaming
                    ? 'bg-emerald-500 animate-pulse shadow-[0_0_4px_rgba(16,185,129,0.5)]'
                    : 'bg-gray-400'
                }`}
              />
              <AgentAvatar src={colors.avatar} alt={`${item.agentName} 头像`} size={16} className="w-4 h-4 rounded-full shrink-0" />
              <span className="whitespace-nowrap">
                {item.agentName}
                {isStreaming ? ' · 发言中' : ' · 等待中'}
              </span>
              {item.mentionedBy === 'manager' && (
                <span className="text-[9px] opacity-60">主持人提名</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
