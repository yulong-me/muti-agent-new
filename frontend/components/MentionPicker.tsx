'use client'

import { useRef, useEffect } from 'react'
import { AGENT_COLORS, DEFAULT_AGENT_COLOR, type Agent } from '../lib/agents'
import { AgentAvatar } from './AgentAvatar'

interface MentionPickerProps {
  agents: Agent[]
  highlightIndex: number
  onSelect: (name: string) => void
  onHighlight: (index: number) => void
}

export default function MentionPicker({ agents, highlightIndex, onSelect, onHighlight }: MentionPickerProps) {
  // Scroll highlighted item into view whenever highlight changes
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      const el = document.querySelector(`[data-mention-picker] [role="option"][aria-selected="true"]`) as HTMLButtonElement | null
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 0)
    return () => { if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current) }
  }, [highlightIndex])

  return (
    <div
      data-mention-picker="1"
      className="absolute z-50 bg-[#1a1a2e] backdrop-blur-sm border border-white/[0.12] rounded-xl shadow-2xl overflow-hidden"
      style={{ left: 0, bottom: 'calc(100% + 6px)', minWidth: 220, maxWidth: 280 }}
      role="listbox"
      aria-label="专家候选列表"
    >
      <div className="px-3 py-1.5 bg-white/[0.06] border-b border-white/[0.08]">
        <span className="text-[10px] font-semibold text-ink-soft uppercase tracking-wider">选择专家</span>
      </div>
      <div className="max-h-48 overflow-y-auto custom-scrollbar scroll-smooth">
        {agents.length === 0 && (
          <div className="px-3 py-3 text-[12px] text-ink-soft">
            未找到匹配专家
          </div>
        )}
        {agents.map((agent, i) => {
          const colors = AGENT_COLORS[agent.name] || DEFAULT_AGENT_COLOR
          const isHighlighted = i === highlightIndex
          return (
            <button
              key={agent.id}
              type="button"
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                isHighlighted ? 'bg-accent/10' : 'hover:bg-white/[0.06]'
              }`}
              onMouseEnter={() => onHighlight(i)}
              onClick={() => onSelect(agent.name)}
              aria-label={`选择专家 ${agent.name}`}
              aria-selected={isHighlighted}
              role="option"
            >
              <div className="w-7 h-7 rounded-full flex-shrink-0 shadow-sm overflow-hidden">
                <AgentAvatar name={agent.name} color={colors.bg} textColor={colors.text} size={28} className="w-full h-full" />
              </div>
              <div className="min-w-0">
                <p className={`text-[13px] font-bold truncate ${isHighlighted ? 'text-accent' : 'text-ink'}`}>{agent.name}</p>
                <p className="text-[11px] text-ink-soft truncate">{agent.domainLabel}</p>
              </div>
              {isHighlighted && (
                <span className="ml-auto text-[10px] text-accent/60 font-mono shrink-0">↵</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
