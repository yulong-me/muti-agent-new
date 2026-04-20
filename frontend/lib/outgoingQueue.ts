import type { Agent, OutgoingQueueItem } from './agents'

type QueueAgentStatus = Pick<Agent, 'status'>

interface CreateOutgoingQueueItemArgs {
  content: string
  toAgentId: string
  toAgentName: string
  createdAt?: number
  idFactory?: () => string
}

function defaultIdFactory(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `q-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function isRoomBusy(args: {
  streamingCount: number
  agents: QueueAgentStatus[]
}): boolean {
  return args.streamingCount > 0 || args.agents.some(agent => agent.status === 'thinking' || agent.status === 'waiting')
}

export function createOutgoingQueueItem(args: CreateOutgoingQueueItemArgs): OutgoingQueueItem {
  return {
    id: (args.idFactory ?? defaultIdFactory)(),
    content: args.content,
    toAgentId: args.toAgentId,
    toAgentName: args.toAgentName,
    createdAt: args.createdAt ?? Date.now(),
    status: 'queued',
  }
}

export function getNextQueuedOutgoingItem(items: OutgoingQueueItem[]): OutgoingQueueItem | null {
  return items.find(item => item.status === 'queued') ?? null
}

export function markOutgoingQueueItemDispatching(items: OutgoingQueueItem[], itemId: string): OutgoingQueueItem[] {
  return items.map(item => item.id === itemId ? { ...item, status: 'dispatching' } : item)
}

export function removeOutgoingQueueItem(items: OutgoingQueueItem[], itemId: string): OutgoingQueueItem[] {
  return items.filter(item => item.id !== itemId)
}

export function findRecallableOutgoingQueueItem(items: OutgoingQueueItem[]): OutgoingQueueItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].status === 'queued') {
      return items[index]
    }
  }
  return null
}

export function recallOutgoingQueueItem(items: OutgoingQueueItem[], itemId: string): {
  recalledItem: OutgoingQueueItem | null
  items: OutgoingQueueItem[]
} {
  const recallable = findRecallableOutgoingQueueItem(items)
  if (!recallable || recallable.id !== itemId) {
    return { recalledItem: null, items }
  }
  return {
    recalledItem: recallable,
    items: removeOutgoingQueueItem(items, itemId),
  }
}
