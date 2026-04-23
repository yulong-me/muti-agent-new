'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react'

import {
  extractUserMentionsFromAgents,
  type Agent,
  type AgentRunErrorEvent,
  type OutgoingQueueItem,
} from '@/lib/agents'
import { rewriteMessageForDifferentAgent } from '@/lib/errorRecovery'
import {
  createOutgoingQueueItem,
  findRecallableOutgoingQueueItem,
  getNextQueuedOutgoingItem,
  isRoomBusy as computeIsRoomBusy,
  markOutgoingQueueItemDispatching,
  recallOutgoingQueueItem,
  removeOutgoingQueueItem,
} from '@/lib/outgoingQueue'
import { error as logError, info, telemetry, warn } from '@/lib/logger'
import type { RoomComposerHandle } from '../RoomComposer'
import { API_URL } from '@/lib/api'

const API = API_URL

interface UseRoomMessagingOptions {
  roomId?: string
  agents: Agent[]
  streamingAgentIds: Set<string>
  composerRef: RefObject<RoomComposerHandle | null>
  queuedDispatchPendingRef: MutableRefObject<boolean>
  resetA2ADepth: () => void
}

export function useRoomMessaging({
  roomId,
  agents,
  streamingAgentIds,
  composerRef,
  queuedDispatchPendingRef,
  resetA2ADepth,
}: UseRoomMessagingOptions) {
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [stoppingAgentIds, setStoppingAgentIds] = useState<Set<string>>(new Set())
  const [outgoingQueue, setOutgoingQueue] = useState<OutgoingQueueItem[]>([])
  const [composerDraft, setComposerDraft] = useState('')

  const agentsRef = useRef<Agent[]>(agents)
  const streamingAgentIdsRef = useRef<Set<string>>(new Set(streamingAgentIds))
  const outgoingQueueRef = useRef<OutgoingQueueItem[]>([])
  const dispatchingQueueItemIdRef = useRef<string | null>(null)
  const isDrainingQueueRef = useRef(false)
  const sendErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const roomBusy = useMemo(() => computeIsRoomBusy({
    streamingCount: streamingAgentIds.size,
    agents,
  }), [agents, streamingAgentIds])
  const busyAgents = useMemo(
    () => agents.filter(agent =>
      streamingAgentIds.has(agent.id) ||
      agent.status === 'thinking' ||
      agent.status === 'waiting',
    ),
    [agents, streamingAgentIds],
  )
  const recallableQueueItemId = useMemo(
    () => findRecallableOutgoingQueueItem(outgoingQueue)?.id ?? null,
    [outgoingQueue],
  )

  useEffect(() => {
    agentsRef.current = agents
  }, [agents])

  useEffect(() => {
    streamingAgentIdsRef.current = new Set(streamingAgentIds)
  }, [streamingAgentIds])

  useEffect(() => {
    const busyIds = new Set(busyAgents.map(agent => agent.id))
    setStoppingAgentIds(previous => {
      const next = new Set(Array.from(previous).filter(id => busyIds.has(id)))
      if (next.size === previous.size && Array.from(next).every(id => previous.has(id))) {
        return previous
      }
      return next
    })
  }, [busyAgents])

  useEffect(() => {
    setSending(false)
    setSendError(null)
    setStoppingAgentIds(new Set())
    setOutgoingQueue([])
    setComposerDraft('')
    outgoingQueueRef.current = []
    dispatchingQueueItemIdRef.current = null
    isDrainingQueueRef.current = false
    queuedDispatchPendingRef.current = false
    if (sendErrorTimerRef.current !== null) {
      clearTimeout(sendErrorTimerRef.current)
      sendErrorTimerRef.current = null
    }
  }, [queuedDispatchPendingRef, roomId])

  const showSendError = useCallback((message: string, timeoutMs = 4000) => {
    if (sendErrorTimerRef.current !== null) {
      clearTimeout(sendErrorTimerRef.current)
    }
    setSendError(message)
    sendErrorTimerRef.current = setTimeout(() => {
      setSendError(null)
      sendErrorTimerRef.current = null
    }, timeoutMs)
  }, [])

  useEffect(() => {
    return () => {
      if (sendErrorTimerRef.current !== null) {
        clearTimeout(sendErrorTimerRef.current)
      }
    }
  }, [])

  const postPreparedContent = useCallback(async ({
    content,
    recipientId,
    targetName,
    source,
  }: {
    content: string
    recipientId: string
    targetName: string
    source: 'direct' | 'queue'
  }): Promise<{ ok: true } | { ok: false; status: number; errorText: string }> => {
    if (!roomId) {
      return { ok: false, status: 400, errorText: 'missing room id' }
    }
    telemetry('ui:msg:send', {
      roomId,
      source,
      contentLength: content.length,
      contentSnippet: content.length > 80 ? `${content.slice(0, 80)}…` : content,
      toAgentId: recipientId,
      toAgentName: targetName,
    })
    const response = await fetch(`${API}/api/rooms/${roomId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, toAgentId: recipientId }),
    })
    if (response.ok) {
      resetA2ADepth()
      return { ok: true }
    }
    return {
      ok: false,
      status: response.status,
      errorText: await response.text(),
    }
  }, [resetA2ADepth, roomId])

  const enqueuePreparedMessage = useCallback((content: string, toAgentId: string, toAgentName: string) => {
    const item = createOutgoingQueueItem({ content, toAgentId, toAgentName })
    setOutgoingQueue(previous => {
      const next = [...previous, item]
      outgoingQueueRef.current = next
      return next
    })
  }, [])

  const cancelQueuedItem = useCallback((itemId: string) => {
    if (dispatchingQueueItemIdRef.current === itemId) return
    setOutgoingQueue(previous => {
      const next = removeOutgoingQueueItem(previous, itemId)
      outgoingQueueRef.current = next
      return next
    })
  }, [])

  const recallQueuedItem = useCallback((itemId: string) => {
    if (composerRef.current?.hasDraft()) {
      showSendError('输入框里还有草稿，先处理当前内容再撤回队列消息')
      composerRef.current?.focus()
      return
    }
    setOutgoingQueue(previous => {
      const recalled = recallOutgoingQueueItem(previous, itemId)
      if (!recalled.recalledItem) return previous
      outgoingQueueRef.current = recalled.items
      composerRef.current?.setDraft(recalled.recalledItem.content)
      composerRef.current?.focus()
      return recalled.items
    })
  }, [composerRef, showSendError])

  const drainOutgoingQueue = useCallback(async () => {
    if (!roomId || isDrainingQueueRef.current || queuedDispatchPendingRef.current) return
    if (dispatchingQueueItemIdRef.current !== null) return

    const busyNow = computeIsRoomBusy({
      streamingCount: streamingAgentIdsRef.current.size,
      agents: agentsRef.current,
    })
    if (busyNow) return

    const nextItem = getNextQueuedOutgoingItem(outgoingQueueRef.current)
    if (!nextItem) return

    isDrainingQueueRef.current = true
    dispatchingQueueItemIdRef.current = nextItem.id
    setOutgoingQueue(previous => {
      const next = markOutgoingQueueItemDispatching(previous, nextItem.id)
      outgoingQueueRef.current = next
      return next
    })

    try {
      const result = await postPreparedContent({
        content: nextItem.content,
        recipientId: nextItem.toAgentId,
        targetName: nextItem.toAgentName,
        source: 'queue',
      })

      if (result.ok) {
        queuedDispatchPendingRef.current = true
        setOutgoingQueue(previous => {
          const next = removeOutgoingQueueItem(previous, nextItem.id)
          outgoingQueueRef.current = next
          return next
        })
        return
      }

      logError('queue:dispatch_error', {
        roomId,
        itemId: nextItem.id,
        status: result.status,
        error: result.errorText,
      })

      if (result.status === 409) {
        queuedDispatchPendingRef.current = true
        setOutgoingQueue(previous => {
          const next = previous.map(item => item.id === nextItem.id ? { ...item, status: 'queued' as const } : item)
          outgoingQueueRef.current = next
          return next
        })
        return
      }

      if (result.status === 400) {
        setOutgoingQueue(previous => {
          const next = removeOutgoingQueueItem(previous, nextItem.id)
          outgoingQueueRef.current = next
          return next
        })
        showSendError('队列消息发送失败：目标专家已不可用')
        return
      }

      setOutgoingQueue(previous => {
        const next = previous.map(item => item.id === nextItem.id ? { ...item, status: 'queued' as const } : item)
        outgoingQueueRef.current = next
        return next
      })
      showSendError('队列消息发送失败，请稍后重试')
    } catch (error) {
      logError('queue:dispatch_error', { roomId, itemId: nextItem.id, error: String(error) })
      setOutgoingQueue(previous => {
        const next = previous.map(item => item.id === nextItem.id ? { ...item, status: 'queued' as const } : item)
        outgoingQueueRef.current = next
        return next
      })
      showSendError('队列消息发送失败，请检查网络')
    } finally {
      dispatchingQueueItemIdRef.current = null
      isDrainingQueueRef.current = false
    }
  }, [postPreparedContent, queuedDispatchPendingRef, roomId, showSendError])

  const agentNames = useMemo(() => agents.map(agent => agent.name), [agents])

  const sendPreparedContent = useCallback(async (rawContent: string) => {
    if (!roomId || sending) return false
    const content = rawContent.trim()
    if (!content) return false
    if (extractUserMentionsFromAgents(content, agentNames).length === 0) {
      showSendError('先选择要发给哪位专家：输入 @ 或点一个专家名称')
      composerRef.current?.focus()
      return false
    }
    const mentionNames = extractUserMentionsFromAgents(content, agentNames)
    const targetName = mentionNames[0] ?? null
    const recipientId = targetName
      ? agents.find(agent => agent.name === targetName)?.id ?? null
      : null
    if (!targetName || !recipientId) {
      showSendError('未找到指定专家，请检查 @ 后的名字')
      return false
    }
    const busyNow = computeIsRoomBusy({
      streamingCount: streamingAgentIdsRef.current.size,
      agents: agentsRef.current,
    })
    if (busyNow) {
      enqueuePreparedMessage(content, recipientId, targetName)
      return true
    }
    setSending(true)
    try {
      const result = await postPreparedContent({
        content,
        recipientId,
        targetName,
        source: 'direct',
      })
      if (!result.ok) {
        logError('msg:send_error', { roomId, status: result.status, error: result.errorText })
        if (result.status === 409) {
          queuedDispatchPendingRef.current = true
          enqueuePreparedMessage(content, recipientId, targetName)
          return true
        }
        if (result.status === 400) {
          showSendError('未找到指定专家，请检查 @ 后的名字')
        } else {
          showSendError('发送失败，请重试')
        }
        return false
      }
      return true
    } catch (error) {
      logError('msg:send_error', { roomId, error: String(error) })
      showSendError('发送失败，请检查网络')
      return false
    } finally {
      setSending(false)
    }
  }, [agentNames, agents, composerRef, enqueuePreparedMessage, postPreparedContent, queuedDispatchPendingRef, roomId, sending, showSendError])

  const restoreFailedInput = useCallback((content?: string) => {
    if (!content) return
    if (composerRef.current?.hasDraft()) {
      showSendError('输入框里还有草稿，先处理当前内容再找回原提问')
      composerRef.current?.focus()
      return
    }
    composerRef.current?.setDraft(content)
    composerRef.current?.focus()
  }, [composerRef, showSendError])

  const copyFailedPrompt = useCallback(async (content?: string) => {
    if (!content || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(content)
    } catch {
      showSendError('复制失败，请手动重试', 3000)
    }
  }, [showSendError])

  useEffect(() => {
    if (roomBusy) {
      queuedDispatchPendingRef.current = false
    }
  }, [queuedDispatchPendingRef, roomBusy])

  useEffect(() => {
    if (!roomId || roomBusy) return
    if (queuedDispatchPendingRef.current) return
    if (dispatchingQueueItemIdRef.current !== null) return
    if (!getNextQueuedOutgoingItem(outgoingQueue)) return
    void drainOutgoingQueue()
  }, [drainOutgoingQueue, outgoingQueue, queuedDispatchPendingRef, roomBusy, roomId])

  const retryFailedMessage = useCallback(async (roomError: AgentRunErrorEvent) => {
    if (!roomError.originalUserContent) return
    if (composerRef.current?.hasDraft()) {
      showSendError('输入框里还有草稿，先处理当前内容再重试')
      composerRef.current?.focus()
      return
    }
    await sendPreparedContent(roomError.originalUserContent)
  }, [composerRef, sendPreparedContent, showSendError])

  const prefillMention = useCallback((agent: Agent) => {
    composerRef.current?.prefillMention(agent)
  }, [composerRef])

  const handleRecipientSelected = useCallback((_agentId: string | null) => {}, [])

  const handleRetryFailedMessage = useCallback((roomError: AgentRunErrorEvent) => {
    void retryFailedMessage(roomError)
  }, [retryFailedMessage])

  const handleTryAnotherAgent = useCallback((roomError: AgentRunErrorEvent, nextAgentId: string) => {
    if (!roomError.originalUserContent) return
    const nextAgent = agentsRef.current.find(agent => agent.id === nextAgentId)
    if (!nextAgent) {
      showSendError('未找到替代专家，请稍后重试')
      return
    }
    if (composerRef.current?.hasDraft()) {
      showSendError('输入框里还有草稿，先处理当前内容再改发其他专家')
      composerRef.current?.focus()
      return
    }
    const currentRecipientName = roomError.toAgentName ?? roomError.agentName
    const rewritten = rewriteMessageForDifferentAgent(
      roomError.originalUserContent,
      currentRecipientName,
      nextAgent.name,
    )
    composerRef.current?.setDraft(rewritten)
    composerRef.current?.focus()
  }, [composerRef, showSendError])

  const handleCopyFailedPrompt = useCallback((content?: string) => {
    void copyFailedPrompt(content)
  }, [copyFailedPrompt])

  const handleStopAgent = useCallback(async (agent: Agent) => {
    if (!roomId) return

    info('ui:agent:stop', { roomId, agentId: agent.id, agentName: agent.name })
    setStoppingAgentIds(previous => {
      const next = new Set(previous)
      next.add(agent.id)
      return next
    })

    try {
      const response = await fetch(`${API}/api/rooms/${roomId}/agents/${agent.id}/stop`, {
        method: 'POST',
      })
      if (response.ok) return

      setStoppingAgentIds(previous => {
        const next = new Set(previous)
        next.delete(agent.id)
        return next
      })

      if (response.status === 409) {
        warn('ui:agent:stop_failed', { roomId, agentId: agent.id, reason: 'not_running' })
        showSendError(`${agent.name} 已经不在回答了`, 3000)
        return
      }
      if (response.status === 404) {
        warn('ui:agent:stop_failed', { roomId, agentId: agent.id, reason: 'not_found' })
        showSendError(`${agent.name} 当前不可用，请刷新后重试`, 3500)
        return
      }
      warn('ui:agent:stop_failed', { roomId, agentId: agent.id, status: response.status })
      showSendError('停止失败，请稍后重试')
    } catch (error) {
      setStoppingAgentIds(previous => {
        const next = new Set(previous)
        next.delete(agent.id)
        return next
      })
      warn('ui:agent:stop_network_failed', { roomId, agentId: agent.id, error })
      showSendError('停止失败，请检查网络')
    }
  }, [roomId, showSendError])

  return {
    sending,
    sendError,
    stoppingAgentIds,
    outgoingQueue,
    recallableQueueItemId,
    composerDraft,
    roomBusy,
    busyAgents,
    showSendError,
    setComposerDraft,
    cancelQueuedItem,
    recallQueuedItem,
    sendPreparedContent,
    restoreFailedInput,
    handleRetryFailedMessage,
    prefillMention,
    handleRecipientSelected,
    handleTryAnotherAgent,
    handleCopyFailedPrompt,
    handleStopAgent,
  }
}
