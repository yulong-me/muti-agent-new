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
    <div className="bg-nav-bg border-t border-line px-4 md:px-8 py-4 flex flex-col gap-3">
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
