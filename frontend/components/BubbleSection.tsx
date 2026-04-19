'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { ChevronRight, ChevronDown, BrainCircuit } from 'lucide-react'
import { AGENT_COLORS, DEFAULT_AGENT_COLOR, extractMentions, mdComponents, type Message } from '../lib/agents'
import { AgentAvatar } from './AgentAvatar'

/** 将 hex 色值转为带 alpha 的 rgba 字符串（参考 clowder-ai hexToRgba） */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.substring(0, 2), 16)
  const g = parseInt(clean.substring(2, 4), 16)
  const b = parseInt(clean.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

interface BubbleSectionProps {
  label: string
  icon: 'brain' | 'output'
  content: string
  isStreaming: boolean
  agentColor: string
}

export function BubbleSection({
  label,
  icon,
  content,
  isStreaming,
  agentColor,
}: BubbleSectionProps) {
  // Issue-3: thinking defaults collapsed; output defaults expanded; no auto-expand on streaming
  const [isExpanded, setIsExpanded] = useState(icon === 'output')
  const effectiveExpanded = isExpanded
  const lineCount = content.split('\n').length
  const isEmpty = !content.trim()

  const expandIcon = (
    <div
      className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded-[4px] transition-colors"
      style={{ backgroundColor: `${agentColor}20`, color: agentColor }}
    >
      {effectiveExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
    </div>
  )

  const statusText = isEmpty
    ? '等待输出…'
    : isStreaming
    ? icon === 'brain'
      ? `${lineCount} 行 · 输出中（折叠）`
      : `${lineCount} 行 · 输出中`
    : effectiveExpanded
    ? `${lineCount} 行`
    : `${lineCount} 行 · 点击展开`

  const streamingCursor = isStreaming ? (
    <span className="inline-block w-1.5 h-3.5 bg-current animate-pulse ml-1.5 rounded-sm opacity-60 align-middle" />
  ) : null

  if (isEmpty && !isStreaming) return null

  return (
    <div className={icon === 'brain' ? 'mb-3' : 'mb-1'}>
      <button
        onClick={() => setIsExpanded(e => !e)}
        aria-expanded={effectiveExpanded}
        className="flex items-center gap-2 text-xs font-medium w-full group/section hover:opacity-80 transition-opacity px-2 py-1 rounded-lg"
        style={{ color: agentColor, backgroundColor: `${agentColor}10` }}
      >
        {expandIcon}
        <span className="opacity-90 tracking-wide flex items-center gap-1.5">
          {icon === 'brain' && <BrainCircuit className="w-3 h-3" />}
          {label}
        </span>
        <span className="text-[11px] opacity-50 ml-1 font-normal tracking-wider">{statusText}</span>
        {streamingCursor}
      </button>

      {effectiveExpanded && (
        <div
          className={`mt-2 ml-2 pl-3.5 border-l-2 text-[14px] leading-relaxed ${
            icon === 'brain'
              ? 'font-mono text-ink-soft bg-surface-muted/50 py-2.5 px-3 rounded-r-lg text-[13px] overflow-x-auto'
              : 'text-ink py-0.5 overflow-x-auto'
          }`}
          style={{ borderColor: `${agentColor}40` }}
        >
          {icon === 'output' ? (
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={mdComponents}>{content}</ReactMarkdown>
          ) : (
            <span className="whitespace-pre-wrap opacity-80">{content}</span>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Single message bubble (USER or AGENT) ────────────────────────────────────

interface MessageBubbleProps {
  msg: Message
  isStreaming: boolean
  agentColor: string
}

export function MessageBubble({ msg, isStreaming, agentColor }: MessageBubbleProps) {
  const isUser = msg.agentRole === 'USER'
  const isSystem = msg.type === 'system'

  // F007: 系统消息居中通知（如 "xxx 加入了讨论"）
  if (isSystem) {
    return (
      <div className="flex justify-center mb-3">
        <div className="text-xs px-4 py-2 rounded-lg bg-surface/60 border border-line text-ink-soft max-w-[85%] text-center">
          💬 <span className="font-medium text-ink">{msg.agentName}</span> {msg.content}
        </div>
      </div>
    )
  }

  // Agent bubble: tinted background + semi-transparent border（参考 clowder-ai）
  const agentBubbleBg = hexToRgba(agentColor, 0.08)
  const agentBubbleBorder = hexToRgba(agentColor, 0.28)

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className="w-9 h-9 rounded-full flex-shrink-0 shadow-sm overflow-hidden ring-2"
           style={{ backgroundColor: isUser ? agentColor : 'transparent', boxShadow: isUser ? undefined : `0 0 0 2px ${agentBubbleBorder}` }}>
        <AgentAvatar name={msg.agentName} color={agentColor} size={36} className="w-full h-full" />
      </div>

      {/* Bubble */}
      <div className={`max-w-[75%] min-w-0 flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold" style={{ color: isUser ? agentColor : undefined }}>
            {msg.agentName}
          </span>
          {isStreaming && (
            <span className="text-[10px] text-ink-soft/60 font-mono">流式中</span>
          )}
        </div>

        <div
          className={`border px-4 py-3 text-[14px] leading-relaxed transition-transform hover:-translate-y-0.5 overflow-x-auto ${
            isUser
              ? 'bg-accent/10 text-ink rounded-2xl rounded-br-sm'
              : 'text-ink rounded-2xl rounded-tl-sm'
          }`}
          style={
            isUser
              ? { borderColor: hexToRgba(agentColor, 0.25) }
              : { backgroundColor: agentBubbleBg, borderColor: agentBubbleBorder }
          }
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkBreaks]}
            components={mdComponents}
          >
            {msg.content || (isStreaming ? '' : '（无内容）')}
          </ReactMarkdown>
        </div>

        {/* @mentions */}
        {extractMentions(msg.content).length > 0 && (
          <div className="flex items-center gap-1.5 text-xs font-medium flex-wrap" style={{ color: agentColor }}>
            <span className="opacity-50 mr-0.5">@点名</span>
            {extractMentions(msg.content).map((name) => (
              <span
                key={name}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold"
                style={{ backgroundColor: `${agentColor}20`, color: agentColor }}
              >
                {name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function getAgentColor(name: string): string {
  return AGENT_COLORS[name]?.bg || DEFAULT_AGENT_COLOR.bg
}
