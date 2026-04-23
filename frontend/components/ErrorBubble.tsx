'use client'

import { AlertTriangle, Copy, RotateCcw, Undo2 } from 'lucide-react'
import type { AgentRunErrorEvent } from '../lib/agents'

export type { AgentRunErrorEvent }

interface ErrorBubbleProps {
  error: AgentRunErrorEvent
  retryDisabled?: boolean
  restoreDisabled?: boolean
  alternateAgents?: { id: string; name: string }[]
  onRetry?: () => void
  onRestore?: () => void
  onCopy?: () => void
  onTryAnotherAgent?: (agentId: string) => void
}

export function ErrorBubble({
  error,
  retryDisabled = false,
  restoreDisabled = false,
  alternateAgents = [],
  onRetry,
  onRestore,
  onCopy,
  onTryAnotherAgent,
}: ErrorBubbleProps) {
  const accent =
    error.code === 'AGENT_TIMEOUT' && error.timeoutPhase === 'idle'
      ? 'var(--danger)'
      : error.code === 'AGENT_TIMEOUT'
      ? 'var(--warning)'
      : error.code === 'AGENT_STOPPED'
      ? 'var(--ink-soft)'
      : error.code === 'AGENT_PROVIDER_ERROR'
      ? 'var(--provider-opencode)'
      : 'var(--danger)'

  return (
    <div
      className="rounded-2xl border px-4 py-3.5 shadow-sm"
      style={{
        borderColor: `color-mix(in srgb, ${accent} 24%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${accent} 10%, transparent)`,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{
            backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
            color: accent,
          }}
        >
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-bold text-ink">{error.title}</span>
            <span className="text-[11px] text-ink-soft">{error.agentName}</span>
            {error.code === 'AGENT_TIMEOUT' && error.timeoutPhase === 'idle' && (
              <span className="tone-danger-panel rounded-full border px-2 py-0.5 text-[10px] font-semibold">
                已保留部分输出
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{error.message}</p>
          <p className="mt-2 text-[10px] text-ink-soft/70 font-mono">TraceId: {error.traceId}</p>

          <div className="mt-3 flex flex-wrap gap-2">
            {error.retryable && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                disabled={retryDisabled}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                重试
              </button>
            )}
            {error.originalUserContent && onRestore && (
              <button
                type="button"
                onClick={onRestore}
                disabled={restoreDisabled}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Undo2 className="h-3.5 w-3.5" />
                找回输入
              </button>
            )}
            {error.originalUserContent && onCopy && (
              <button
                type="button"
                onClick={onCopy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-muted"
              >
                <Copy className="h-3.5 w-3.5" />
                复制问题
              </button>
            )}
          </div>
          {error.originalUserContent && alternateAgents.length > 0 && onTryAnotherAgent && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-ink-soft">换个专家试试</span>
              {alternateAgents.slice(0, 3).map(agent => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => onTryAnotherAgent(agent.id)}
                  className="inline-flex items-center rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-ink transition-colors hover:bg-surface-muted"
                >
                  @{agent.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
