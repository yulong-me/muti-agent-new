'use client'

import { Clock3, CornerDownLeft, X } from 'lucide-react'

import type { OutgoingQueueItem } from '../lib/agents'

interface OutgoingMessageQueueProps {
  items: OutgoingQueueItem[]
  recallableItemId: string | null
  inputHasDraft: boolean
  onCancel: (itemId: string) => void
  onRecall: (itemId: string) => void
}

function truncateContent(content: string): string {
  return content.length > 72 ? `${content.slice(0, 72)}…` : content
}

export function OutgoingMessageQueue({
  items,
  recallableItemId,
  inputHasDraft,
  onCancel,
  onRecall,
}: OutgoingMessageQueueProps) {
  if (items.length === 0) return null

  return (
    <div className="app-islands-item rounded-2xl border border-line bg-surface/85 px-4 py-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
          待发队列
        </span>
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] text-ink-soft">
          {items.length} 条
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item, index) => {
          const isDispatching = item.status === 'dispatching'
          const isRecallable = item.id === recallableItemId
          return (
            <div
              key={item.id}
              className="flex items-start gap-3 rounded-xl border border-line/80 bg-bg/60 px-3 py-2"
            >
              <div className="mt-0.5 w-5 shrink-0 text-right text-[11px] font-semibold text-ink-soft/70">
                {index + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-ink">
                    @{item.toAgentName}
                  </span>
                  {isDispatching && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600">
                      <Clock3 className="h-3 w-3 animate-pulse" />
                      发送中…
                    </span>
                  )}
                </div>
                <p className="break-all text-[12px] leading-relaxed text-ink">
                  {truncateContent(item.content)}
                </p>
              </div>
              {!isDispatching && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onCancel(item.id)}
                    className="rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-red-50 hover:text-red-500"
                    title="取消此条队列消息"
                    aria-label="取消此条队列消息"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  {isRecallable && (
                    <button
                      type="button"
                      onClick={() => onRecall(item.id)}
                      disabled={inputHasDraft}
                      className="rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-blue-50 hover:text-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                      title={inputHasDraft ? '输入框里还有草稿，先处理当前内容' : '撤回到输入框'}
                      aria-label="撤回到输入框"
                    >
                      <CornerDownLeft className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
