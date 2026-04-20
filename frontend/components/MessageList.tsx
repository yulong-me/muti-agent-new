'use client'

import { memo, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { ChevronDown, BrainCircuit, Wrench, Copy, Maximize2 } from 'lucide-react'
import {
  AGENT_COLORS,
  DEFAULT_AGENT_COLOR,
  TIME_FORMATTER,
  extractMentions,
  mdComponents,
  type Agent,
  type DiscussionState,
  type Message,
  type ToolCall,
} from '../lib/agents'
import { BubbleSection } from './BubbleSection'
import { AgentAvatar } from './AgentAvatar'
import { ErrorBubble, type AgentRunErrorEvent } from './ErrorBubble'
import { BubbleErrorBoundary } from './BubbleErrorBoundary'

const userMarkdownComponents = {
  ...mdComponents,
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0 text-ink">{children}</p>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 opacity-90 hover:opacity-100 text-accent">{children}</a>
  ),
}

interface MessageListProps {
  roomId?: string
  messages: Message[]
  agents: Agent[]
  state: DiscussionState
  sending: boolean
  messageErrorMap: Record<string, AgentRunErrorEvent>
  orphanErrors: AgentRunErrorEvent[]
  showScrollBtn: boolean
  containerRef: RefObject<HTMLDivElement>
  endRef: RefObject<HTMLDivElement>
  onScroll: () => void
  onScrollToBottom: () => void
  onPrefillMention: (agent: Agent) => void
  onRetryFailedMessage: (error: AgentRunErrorEvent) => void
  onRestoreFailedInput: (content?: string) => void
  onCopyFailedPrompt: (content?: string) => void
  onTryAnotherAgent: (error: AgentRunErrorEvent, nextAgentId: string) => void
}

interface MessageBubbleProps {
  msg: Message
  agentNames: string[]
  agentNameSet: Set<string>
  agentById: Map<string, Agent>
  state: DiscussionState
  sending: boolean
  runError?: AgentRunErrorEvent
  hoveredToolCall: string | null
  expandedToolCall: string | null
  hoverTimerRef: MutableRefObject<number | null>
  onHoverToolCall: (key: string | null) => void
  onToggleExpandedToolCall: (key: string | null) => void
  onRetryFailedMessage: (error: AgentRunErrorEvent) => void
  onRestoreFailedInput: (content?: string) => void
  onCopyFailedPrompt: (content?: string) => void
  onTryAnotherAgent: (error: AgentRunErrorEvent, nextAgentId: string) => void
}

export const MessageList = memo(function MessageList({
  roomId,
  messages,
  agents,
  state,
  sending,
  messageErrorMap,
  orphanErrors,
  showScrollBtn,
  containerRef,
  endRef,
  onScroll,
  onScrollToBottom,
  onPrefillMention,
  onRetryFailedMessage,
  onRestoreFailedInput,
  onCopyFailedPrompt,
  onTryAnotherAgent,
}: MessageListProps) {
  const [hoveredToolCall, setHoveredToolCall] = useState<string | null>(null)
  const [expandedToolCall, setExpandedToolCall] = useState<string | null>(null)
  const hoverTimerRef = useRef<number | null>(null)

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => a.timestamp - b.timestamp),
    [messages],
  )
  const agentNames = useMemo(() => agents.map(a => a.name), [agents])
  const agentNameSet = useMemo(() => new Set(agentNames), [agentNames])
  const agentById = useMemo(() => new Map(agents.map(agent => [agent.id, agent])), [agents])

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6 scroll-smooth custom-scrollbar" ref={containerRef} onScroll={onScroll}>
      {sortedMessages.map(msg => (
        <MessageBubble
          key={msg.id}
          msg={msg}
          agentNames={agentNames}
          agentNameSet={agentNameSet}
          agentById={agentById}
          state={state}
          sending={sending}
          runError={messageErrorMap[msg.id] ?? msg.runError}
          hoveredToolCall={hoveredToolCall}
          expandedToolCall={expandedToolCall}
          hoverTimerRef={hoverTimerRef}
          onHoverToolCall={setHoveredToolCall}
          onToggleExpandedToolCall={setExpandedToolCall}
          onRetryFailedMessage={onRetryFailedMessage}
          onRestoreFailedInput={onRestoreFailedInput}
          onCopyFailedPrompt={onCopyFailedPrompt}
          onTryAnotherAgent={onTryAnotherAgent}
        />
      ))}

      {orphanErrors.map(roomError => (
        <div key={roomError.traceId} className="mb-6">
          <ErrorBubble
            error={roomError}
            retryDisabled={sending}
            restoreDisabled={false}
            onRetry={() => onRetryFailedMessage(roomError)}
            onRestore={() => onRestoreFailedInput(roomError.originalUserContent)}
            onCopy={() => onCopyFailedPrompt(roomError.originalUserContent)}
            alternateAgents={agents
              .filter(agent => agent.role === 'WORKER' && agent.id !== (roomError.toAgentId ?? roomError.agentId))
              .map(agent => ({ id: agent.id, name: agent.name }))}
            onTryAnotherAgent={(nextAgentId) => onTryAnotherAgent(roomError, nextAgentId)}
          />
        </div>
      ))}

      {messages.length === 0 && roomId && (
        <div className="flex flex-col items-center justify-center min-h-44 text-center text-ink-soft gap-3 px-4">
          <BrainCircuit className="w-8 h-8 opacity-70" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-ink">从 @一位专家 开始</p>
            <p className="text-xs max-w-md leading-relaxed">
              每条消息都需要明确收件人。软件开发任务建议先找架构师拆需求和计划，再进入实现与 review。
            </p>
          </div>
          {agents.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {agents.slice(0, 4).map(agent => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => onPrefillMention(agent)}
                  className="px-3 py-1.5 rounded-lg border border-line bg-surface text-xs font-medium text-ink hover:border-accent hover:text-accent transition-colors"
                >
                  @{agent.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div ref={endRef} />
      {showScrollBtn && (
        <button
          onClick={onScrollToBottom}
          className="sticky bottom-4 left-1/2 -translate-x-1/2 bg-accent text-white px-4 py-2 rounded-full text-xs font-medium shadow-lg hover:bg-accent-deep transition-colors flex items-center gap-1.5 z-10"
        >
          <ChevronDown className="w-3.5 h-3.5" /> 回到底部
        </button>
      )}
    </div>
  )
})

const MessageBubble = memo(function MessageBubble({
  msg,
  agentNames,
  agentNameSet,
  agentById,
  state,
  sending,
  runError,
  hoveredToolCall,
  expandedToolCall,
  hoverTimerRef,
  onHoverToolCall,
  onToggleExpandedToolCall,
  onRetryFailedMessage,
  onRestoreFailedInput,
  onCopyFailedPrompt,
  onTryAnotherAgent,
}: MessageBubbleProps) {
  const isUser = msg.agentRole === 'USER'
  const isSystem = msg.type === 'system'
  const isStreaming = !isUser && !isSystem && (msg.type === 'streaming' || msg.duration_ms === undefined)
  const hasToolCalls = Boolean(msg.toolCalls?.length)
  const hasOutput = Boolean(msg.content.trim() || msg.thinking?.trim() || hasToolCalls)
  const agentColor = AGENT_COLORS[msg.agentName]?.bg || DEFAULT_AGENT_COLOR.bg
  const formattedTime = TIME_FORMATTER.format(new Date(msg.timestamp))

  const validMentions = useMemo(() => {
    if (isUser) return []
    return extractMentions(msg.content, agentNames).filter(name => agentNameSet.has(name))
  }, [agentNameSet, agentNames, isUser, msg.content])
  const alternateAgents = useMemo(
    () => runError
      ? Array.from(agentById.values())
          .filter(agent => agent.role === 'WORKER' && agent.id !== (runError.toAgentId ?? runError.agentId))
          .map(agent => ({ id: agent.id, name: agent.name }))
      : [],
    [agentById, runError],
  )

  if (isUser) {
    const toRecipient = msg.toAgentId ? agentById.get(msg.toAgentId) : null
    const toColors = toRecipient ? AGENT_COLORS[toRecipient.name] || DEFAULT_AGENT_COLOR : null
    return (
      <div className="flex justify-end gap-3 mb-6 items-start">
        <div className="w-full max-w-[85%] lg:max-w-[90%]">
          <div className="flex justify-end items-center gap-2 mb-1.5">
            <span className="text-[11px] text-ink-soft">
              {formattedTime}
            </span>
            {isStreaming && <span className="text-[11px] text-accent animate-pulse font-medium">● 回答中</span>}
            <span className="text-[12px] font-bold px-2 py-0.5 rounded-md bg-accent/20 text-accent">你</span>
            {toRecipient && toColors && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ backgroundColor: `${toColors.bg}15`, color: toColors.bg }}>
                <span>→</span>
                <AgentAvatar name={toRecipient.name} color={toColors.bg} textColor={toColors.text} size={12} className="w-3 h-3 rounded-full" />
                {toRecipient.name}
              </span>
            )}
          </div>
          <div className="rounded-2xl rounded-tr-sm px-4 py-3.5 bg-surface border border-line shadow-sm">
            <BubbleErrorBoundary agentName={msg.agentName}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={userMarkdownComponents}
              >
                {msg.content}
              </ReactMarkdown>
            </BubbleErrorBoundary>
          </div>
        </div>
      </div>
    )
  }

  if (isSystem) {
    return (
      <div className="flex justify-center mb-3">
        <div className="text-xs px-4 py-2 rounded-lg bg-surface/60 border border-line text-ink-soft max-w-[85%] text-center">
          {msg.content}
        </div>
      </div>
    )
  }

  if (runError && !hasOutput) {
    return (
      <div className="group flex gap-3 mb-6 items-start">
        <div className="w-8 h-8 rounded-full flex-shrink-0 shadow-sm mt-1 overflow-hidden">
          <AgentAvatar name={msg.agentName} color={agentColor} size={32} className="w-full h-full" />
        </div>
        <div className="w-full max-w-[85%] lg:max-w-[90%]">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[13px] font-bold px-2 py-0.5 rounded-md" style={{ backgroundColor: `${agentColor}20`, color: agentColor }}>
              {msg.agentName}
            </span>
            <span className="text-[11px] text-ink-soft">
              {formattedTime}
            </span>
          </div>
          <ErrorBubble
            error={runError}
            retryDisabled={sending}
            restoreDisabled={false}
            onRetry={() => onRetryFailedMessage(runError)}
            onRestore={() => onRestoreFailedInput(runError.originalUserContent)}
            onCopy={() => onCopyFailedPrompt(runError.originalUserContent)}
            alternateAgents={alternateAgents}
            onTryAnotherAgent={(nextAgentId) => onTryAnotherAgent(runError, nextAgentId)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="group flex gap-3 mb-6 items-start">
      <div className="w-8 h-8 rounded-full flex-shrink-0 shadow-sm mt-1 overflow-hidden">
        <AgentAvatar name={msg.agentName} color={agentColor} size={32} className="w-full h-full" />
      </div>
      <div className="w-full max-w-[85%] lg:max-w-[90%]">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[13px] font-bold px-2 py-0.5 rounded-md" style={{ backgroundColor: `${agentColor}20`, color: agentColor }}>
            {msg.agentName}
          </span>
          <span className="text-[11px] text-ink-soft">
            {formattedTime}
          </span>
          {isStreaming && (
            <span className="text-[11px] text-emerald-500 font-medium flex items-center gap-1">
              <span className="animate-pulse">● 回答中</span>
            </span>
          )}
        </div>
        <div className="rounded-2xl rounded-tl-sm px-4 py-3.5 bg-surface border border-line shadow-sm">
          <BubbleErrorBoundary agentName={msg.agentName}>
            <BubbleSection label="思考过程" icon="brain" content={msg.thinking ?? ''} isStreaming={isStreaming} agentColor={agentColor} />
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <ToolCalls
                msgId={msg.id}
                toolCalls={msg.toolCalls}
                agentColor={agentColor}
                hoveredToolCall={hoveredToolCall}
                expandedToolCall={expandedToolCall}
                hoverTimerRef={hoverTimerRef}
                onHoverToolCall={onHoverToolCall}
                onToggleExpandedToolCall={onToggleExpandedToolCall}
              />
            )}
            <BubbleSection label="回复" icon="output" content={msg.content} isStreaming={isStreaming} agentColor={agentColor} />
            {validMentions.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs font-medium flex-wrap" style={{ color: agentColor }}>
                <span className="opacity-50 mr-0.5">@点名</span>
                {validMentions.map(name => (
                  <span key={name} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ backgroundColor: `${agentColor}20`, color: agentColor }}>
                    {name}
                  </span>
                ))}
              </div>
            )}
          </BubbleErrorBoundary>
          {runError && (
            <div className="mt-3">
              <ErrorBubble
                error={runError}
                retryDisabled={sending}
                restoreDisabled={false}
                onRetry={() => onRetryFailedMessage(runError)}
                onRestore={() => onRestoreFailedInput(runError.originalUserContent)}
                onCopy={() => onCopyFailedPrompt(runError.originalUserContent)}
                alternateAgents={alternateAgents}
                onTryAnotherAgent={(nextAgentId) => onTryAnotherAgent(runError, nextAgentId)}
              />
            </div>
          )}
        </div>
        {!isStreaming && msg.duration_ms && state === 'DONE' && (
          <div className="mt-1.5 px-3 py-1.5 bg-surface border border-line rounded-lg text-[11px] text-ink-soft flex flex-wrap gap-x-4 gap-y-1 max-w-fit">
            <span>⏱ {(msg.duration_ms / 1000).toFixed(1)}s</span>
            {msg.total_cost_usd && <span>💰 ${msg.total_cost_usd.toFixed(4)}</span>}
            {msg.input_tokens && <span>📥 {msg.input_tokens}</span>}
            {msg.output_tokens && <span>📤 {msg.output_tokens}</span>}
          </div>
        )}
      </div>
    </div>
  )
})

interface ToolCallsProps {
  msgId: string
  toolCalls: ToolCall[]
  agentColor: string
  hoveredToolCall: string | null
  expandedToolCall: string | null
  hoverTimerRef: MutableRefObject<number | null>
  onHoverToolCall: (key: string | null) => void
  onToggleExpandedToolCall: (key: string | null) => void
}

const ToolCalls = memo(function ToolCalls({
  msgId,
  toolCalls,
  agentColor,
  hoveredToolCall,
  expandedToolCall,
  hoverTimerRef,
  onHoverToolCall,
  onToggleExpandedToolCall,
}: ToolCallsProps) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 text-xs font-medium mb-2 px-2 py-1 rounded-lg" style={{ color: agentColor, backgroundColor: `${agentColor}10` }}>
        <Wrench className="w-3 h-3" />
        <span>工具调用</span>
        <span className="text-[11px] opacity-50 font-normal tracking-wider">{toolCalls.length} 次</span>
      </div>
      <div className="ml-2 pl-3.5 border-l-2 font-mono text-[13px] flex flex-wrap gap-2 items-center" style={{ borderColor: `${agentColor}40` }}>
        {toolCalls.map((tool, i) => {
          const key = `${msgId}-${tool.callId ?? i}`
          const isHovered = hoveredToolCall === key
          const isExpanded = expandedToolCall === key
          return (
            <div key={tool.callId ?? i} className="relative">
              <span
                className="text-[11px] font-bold px-2 py-1 rounded cursor-help whitespace-nowrap"
                style={{ backgroundColor: `${agentColor}20`, color: agentColor }}
                onMouseEnter={() => {
                  if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current)
                  onHoverToolCall(key)
                }}
                onMouseLeave={() => {
                  hoverTimerRef.current = window.setTimeout(() => onHoverToolCall(null), 100)
                }}
              >
                {tool.toolName}
              </span>
              {isHovered && (
                <div
                  className="absolute z-[9999] left-0 top-full mt-1 w-80 bg-black/80 border border-line rounded-lg shadow-xl text-xs select-text backdrop-blur-sm"
                  onMouseEnter={() => {
                    if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current)
                    onHoverToolCall(key)
                  }}
                  onMouseLeave={() => onHoverToolCall(null)}
                >
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                    <span className="font-medium text-white/80">{tool.toolName}</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => onToggleExpandedToolCall(isExpanded ? null : key)}
                        className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                        title={isExpanded ? '收起' : '全屏'}
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => navigator.clipboard.writeText(JSON.stringify(tool.toolInput, null, 2))}
                        className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                        title="复制全部"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <pre className={`text-[11px] text-white/90 whitespace-pre-wrap break-all p-3 ${isExpanded ? 'max-h-none overflow-y-visible' : 'max-h-48 overflow-y-auto'}`}>{JSON.stringify(tool.toolInput, null, 2)}</pre>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})
