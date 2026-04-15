'use client'

import { AGENT_COLORS, DEFAULT_AGENT_COLOR, type Agent, type Message, type DiscussionState } from '../lib/agents'
import { AgentAvatar } from './AgentAvatar'

interface AgentPanelProps {
  roomId?: string
  agents: Agent[]
  messages: Message[]
  state: DiscussionState
}

function AgentCard({ agent, messages }: { agent: Agent; messages: Message[] }) {
  const colors = AGENT_COLORS[agent.name] || DEFAULT_AGENT_COLOR

  const activeMsg =
    messages.find(m => m.agentRole === agent.role && m.agentName === agent.name && (m.type === 'streaming' || m.duration_ms === undefined))
    || messages.filter(m => m.agentRole === agent.role && m.agentName === agent.name).sort((a, b) => b.timestamp - a.timestamp)[0]

  return (
    <div className="bg-bg border border-line rounded-xl p-3 shadow-sm">
      <div className="flex items-center gap-3 mb-2.5">
        <div className="w-8 h-8 rounded-full flex-shrink-0 shadow-sm overflow-hidden">
          <AgentAvatar src={colors.avatar} alt={`${agent.name} 头像`} size={32} className="w-full h-full" />
        </div>
        <div>
          <p className="text-[14px] font-bold leading-none mb-1 text-ink">{agent.name}</p>
          <p className="text-[11px] text-ink-soft leading-none">
            {agent.role === 'MANAGER' ? '主持人' : agent.domainLabel}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 bg-surface-muted px-2 py-1 rounded-md max-w-fit">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            agent.status === 'thinking' || agent.status === 'waiting'
              ? 'bg-emerald-500 animate-pulse shadow-[0_0_4px_rgba(16,185,129,0.5)]'
              : 'bg-ink-soft/40'
          }`}
        />
        <span className="text-[11px] font-medium text-ink-soft">
          {agent.status === 'thinking' ? '工作中' : agent.status === 'waiting' ? '等待中' : '空闲'}
        </span>
      </div>

      {/* Active message ID for debugging */}
      {activeMsg && (
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(activeMsg.id)}
          title="点击复制消息 ID"
          className="mt-1 flex items-center gap-1 text-[10px] text-ink-soft/50 hover:text-accent transition-colors cursor-pointer group font-mono"
        >
          <span>ID:</span>
          <span className="truncate max-w-[100px] group-hover:text-accent">{activeMsg.id.slice(0, 8)}…</span>
          <span className="opacity-40">📋</span>
        </button>
      )}
    </div>
  )
}

export function AgentPanel({
  roomId,
  agents,
  messages,
  state,
}: AgentPanelProps) {
  return (
    <div className="app-islands-panel hidden lg:flex w-[260px] bg-surface border-l border-line flex-col z-20">
      <div className="p-5 border-b border-line space-y-1.5">
        {roomId && (
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(roomId)}
            title="点击复制对话 ID"
            className="flex items-center gap-1.5 text-[11px] text-ink-soft hover:text-accent transition-colors cursor-pointer group w-full"
          >
            <span className="opacity-60 group-hover:opacity-100 shrink-0">ID:</span>
            <span className="font-mono truncate group-hover:text-accent">{roomId.slice(0, 8)}…</span>
            <span className="text-[10px] opacity-40 ml-auto">📋</span>
          </button>
        )}
        <h2 className="text-[15px] font-bold text-ink pt-1">参与 Agent</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
        {agents.map(agent => (
          <AgentCard key={agent.id} agent={agent} messages={messages} />
        ))}
        {agents.length === 0 && (
          <p className="text-[12px] text-ink-soft text-center mt-6">选择讨论室后显示参与者</p>
        )}
      </div>
    </div>
  )
}
