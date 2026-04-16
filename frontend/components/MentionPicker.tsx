'use client'

import { AGENT_COLORS, DEFAULT_AGENT_COLOR, type Agent } from '../lib/agents'
import { AgentAvatar } from './AgentAvatar'

interface MentionPickerProps {
  agents: Agent[]
  query: string
  highlightIndex: number
  onSelect: (name: string) => void
  onHighlight: (index: number) => void
}

export default function MentionPicker({ agents, query, highlightIndex, onSelect, onHighlight }: MentionPickerProps) {
  const filtered = query
    ? agents.filter(a => a.name.toLowerCase().includes(query.toLowerCase()))
    : agents

  if (filtered.length === 0) return null

  return (
    <div
      data-mention-picker="1"
      className="absolute z-50 bg-surface backdrop-blur-xl border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden"
      style={{ left: 0, bottom: 'calc(100% + 6px)', minWidth: 220, maxWidth: 280 }}
    >
      <div className="px-3 py-1.5 bg-white/[0.04] border-b border-white/[0.06]">
        <span className="text-[10px] font-semibold text-ink-soft uppercase tracking-wider">选择专家</span>
      </div>
      <div className="max-h-48 overflow-y-auto custom-scrollbar">
        {filtered.map((agent, i) => {
          const colors = AGENT_COLORS[agent.name] || DEFAULT_AGENT_COLOR
          const isHighlighted = i === highlightIndex
          return (
            <button
              key={agent.id}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                isHighlighted ? 'bg-accent/10' : 'hover:bg-surface-muted/60'
              }`}
              onMouseEnter={() => onHighlight(i)}
              onClick={() => onSelect(agent.name)}
              aria-label={`选择专家 ${agent.name}`}
            >
              <div className="w-7 h-7 rounded-full flex-shrink-0 shadow-sm overflow-hidden">
                <AgentAvatar src={colors.avatar} alt={`${agent.name} 头像`} size={28} className="w-full h-full" />
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
