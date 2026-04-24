'use client'

import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, Clock3 } from 'lucide-react'
import type { InvocationUsage } from '../lib/agents'
import { formatCompactTokenCount, formatLatencyMs, formatUsd, getProviderBadgeClass, getProviderSwatchClass } from '../lib/telemetry'

interface MetadataBadgeProps {
  usage?: InvocationUsage
}

export function MetadataBadge({ usage }: MetadataBadgeProps) {
  if (!usage) return null

  const providerLabel = usage.provider ?? usage.model
  const providerTitle = usage.provider && usage.model
    ? `${usage.provider} · ${usage.model}`
    : usage.provider ?? usage.model

  const metricSegments: Array<{
    key: string
    value: string
    icon: ReactNode
    title?: string
  }> = []

  if (typeof usage?.inputTokens === 'number' && usage.inputTokens > 0) {
    metricSegments.push({
      key: 'input',
      title: `Input ${formatCompactTokenCount(usage.inputTokens)}`,
      value: formatCompactTokenCount(usage.inputTokens),
      icon: <ArrowDown className="h-3 w-3 text-ink-soft/72" />,
    })
  }

  if (typeof usage?.outputTokens === 'number' && usage.outputTokens > 0) {
    metricSegments.push({
      key: 'output',
      title: `Output ${formatCompactTokenCount(usage.outputTokens)}`,
      value: formatCompactTokenCount(usage.outputTokens),
      icon: <ArrowUp className="h-3 w-3 text-ink-soft/72" />,
    })
  }

  if (typeof usage?.latencyMs === 'number' && usage.latencyMs > 0) {
    metricSegments.push({
      key: 'latency',
      title: formatLatencyMs(usage.latencyMs),
      value: formatLatencyMs(usage.latencyMs),
      icon: <Clock3 className="h-3 w-3 text-ink-soft/72" />,
    })
  }

  if (typeof usage?.costUsd === 'number' && usage.costUsd > 0) {
    metricSegments.push({
      key: 'cost',
      value: formatUsd(usage.costUsd),
      icon: <span className="text-[9px] font-bold text-ink-soft/72">$</span>,
    })
  }

  if (!providerLabel && metricSegments.length === 0) return null

  return (
    <div className="mt-2.5 flex max-w-full flex-wrap items-center gap-2 text-[10px] sm:text-[11px]">
      {providerLabel ? (
        <span
          title={providerTitle}
          className={`inline-flex max-w-[9rem] items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-semibold shadow-[0_6px_18px_rgba(0,0,0,0.08)] sm:max-w-[10rem] sm:text-[11px] ${getProviderBadgeClass(usage.provider ?? usage.model)}`}
        >
          <span className={`provider-orb flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full ${getProviderSwatchClass(usage.provider ?? usage.model)}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-white/85" />
          </span>
          <span className="truncate">{providerLabel}</span>
        </span>
      ) : null}

      {metricSegments.length > 0 ? (
        <div
          className="inline-flex min-w-0 max-w-full items-center overflow-hidden rounded-full border border-line bg-surface text-ink-soft shadow-[0_6px_18px_rgba(0,0,0,0.08)]"
          style={{
            background: 'linear-gradient(180deg, color-mix(in srgb, var(--surface) 96%, var(--panel)) 0%, color-mix(in srgb, var(--surface-muted) 82%, var(--panel)) 100%)',
          }}
        >
          {metricSegments.map((segment, index) => (
            <span
              key={segment.key}
              title={segment.title}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 ${index > 0 ? 'border-l border-line/80' : ''}`}
            >
              <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-surface-muted shadow-sm">
                {segment.icon}
              </span>
              <span className="truncate font-medium tabular-nums text-ink-soft">{segment.value}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
