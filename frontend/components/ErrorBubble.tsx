'use client'

import { AlertTriangle, Copy, RotateCcw, Undo2 } from 'lucide-react'
import type { AgentRunErrorEvent } from '../lib/agents'

export type { AgentRunErrorEvent }

interface ErrorBubbleProps {
  error: AgentRunErrorEvent
  retryDisabled?: boolean
  restoreDisabled?: boolean
  onRetry?: () => void
  onRestore?: () => void
  onCopy?: () => void
}

export function ErrorBubble({
  error,
  retryDisabled = false,
  restoreDisabled = false,
  onRetry,
  onRestore,
  onCopy,
}: ErrorBubbleProps) {
  const accent =
    error.code === 'AGENT_TIMEOUT'
      ? '#D97706'
      : error.code === 'AGENT_PROVIDER_ERROR'
      ? '#7C3AED'
      : '#DC2626'

  return (
    <div
      className="rounded-2xl border px-4 py-3.5 shadow-sm"
      style={{ borderColor: `${accent}40`, backgroundColor: `${accent}12` }}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `${accent}22`, color: accent }}
        >
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-bold text-ink">{error.title}</span>
            <span className="text-[11px] text-ink-soft">{error.agentName}</span>
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
        </div>
      </div>
    </div>
  )
}
