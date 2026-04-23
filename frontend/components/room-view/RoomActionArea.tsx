'use client'

import type { RefObject } from 'react'
import { Download } from 'lucide-react'

import type { Agent, DiscussionState, OutgoingQueueItem } from '@/lib/agents'
import { OutgoingMessageQueue } from '../OutgoingMessageQueue'
import { RoomComposer, type RoomComposerHandle } from '../RoomComposer'

interface RoomActionAreaProps {
  roomId?: string
  state: DiscussionState
  report: string
  onDownload: () => void
  busyAgents: Agent[]
  stoppingAgentIds: Set<string>
  onStopAgent: (agent: Agent) => Promise<void> | void
  outgoingQueue: OutgoingQueueItem[]
  recallableQueueItemId: string | null
  composerDraft: string
  sending: boolean
  sendError: string | null
  agents: Agent[]
  lastActiveWorkerId: string | null
  composerRef: RefObject<RoomComposerHandle | null>
  onCancelQueuedItem: (itemId: string) => void
  onRecallQueuedItem: (itemId: string) => void
  onSend: (content: string) => Promise<boolean>
  onSendError: (message: string, timeoutMs?: number) => void
  onDraftChange: (draft: string) => void
  onRecipientSelected: (agentId: string | null) => void
}

export function RoomActionArea({
  roomId,
  state,
  report,
  onDownload,
  busyAgents,
  stoppingAgentIds,
  onStopAgent,
  outgoingQueue,
  recallableQueueItemId,
  composerDraft,
  sending,
  sendError,
  agents,
  lastActiveWorkerId,
  composerRef,
  onCancelQueuedItem,
  onRecallQueuedItem,
  onSend,
  onSendError,
  onDraftChange,
  onRecipientSelected,
}: RoomActionAreaProps) {
  return (
    <div className="bg-nav-bg backdrop-blur-xl border-t border-line px-4 md:px-8 py-4 flex flex-col gap-3">
      {state === 'DONE' ? (
        <button
          type="button"
          className="w-full bg-ink text-bg font-semibold py-3.5 rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2 shadow-sm"
          onClick={onDownload}
        >
          <Download className="w-4 h-4" /> 下载讨论报告
        </button>
      ) : roomId ? (
        <>
          {busyAgents.length > 0 && (
            <div className="app-islands-item rounded-2xl border border-line bg-surface/85 px-4 py-3 shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
                  正在回答
                </span>
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] text-ink-soft">
                  {busyAgents.length} 位
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {busyAgents.map(agent => {
                  const stopping = stoppingAgentIds.has(agent.id)
                  return (
                    <div
                      key={agent.id}
                      className="inline-flex items-center gap-2 rounded-xl border border-line/80 bg-bg/60 px-3 py-2"
                    >
                      <span className="inline-flex items-center gap-2 text-[12px] font-medium text-ink">
                        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        {agent.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => { void onStopAgent(agent) }}
                        disabled={stopping}
                        className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-ink transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {stopping ? '停止中…' : '停止'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          <OutgoingMessageQueue
            items={outgoingQueue}
            recallableItemId={recallableQueueItemId}
            inputHasDraft={composerDraft.trim().length > 0}
            onCancel={onCancelQueuedItem}
            onRecall={onRecallQueuedItem}
          />
          <RoomComposer
            ref={composerRef as RefObject<RoomComposerHandle>}
            roomId={roomId}
            agents={agents}
            lastActiveWorkerId={lastActiveWorkerId}
            sending={sending}
            queueMode={busyAgents.length > 0}
            sendError={sendError}
            onSend={onSend}
            onSendError={onSendError}
            onDraftChange={onDraftChange}
            onRecipientSelected={onRecipientSelected}
          />
        </>
      ) : null}
    </div>
  )
}
