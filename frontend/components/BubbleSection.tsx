'use client'

import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { ChevronRight, ChevronDown, BrainCircuit } from 'lucide-react'
import { mdComponents } from '../lib/agents'

interface BubbleSectionProps {
  label: string
  icon: 'brain' | 'output'
  content: string
  isStreaming: boolean
  agentColor: string
}

export const BubbleSection = memo(function BubbleSection({
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
})
