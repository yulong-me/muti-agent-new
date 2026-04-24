'use client'

import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { io, type Socket } from 'socket.io-client'

import { API_URL } from '@/lib/api'
import { debug, setRoomId, telemetry, warn } from '@/lib/logger'
import type { Agent, DiscussionState, Message, SessionTelemetry, ToolCall } from '@/lib/agents'

import type { AgentRunErrorEvent } from '../ErrorBubble'

const API = API_URL

interface UseRoomRealtimeOptions {
  roomId?: string
  queuedDispatchPendingRef: MutableRefObject<boolean>
}

export function useRoomRealtime({ roomId, queuedDispatchPendingRef }: UseRoomRealtimeOptions) {
  const [state, setState] = useState<DiscussionState>('RUNNING')
  const [messages, setMessages] = useState<Message[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [report, setReport] = useState('')
  const [streamingAgentIds, setStreamingAgentIds] = useState<Set<string>>(new Set())
  const [messageErrorMap, setMessageErrorMap] = useState<Record<string, AgentRunErrorEvent>>({})
  const [orphanErrors, setOrphanErrors] = useState<AgentRunErrorEvent[]>([])
  const [maxA2ADepth, setMaxA2ADepth] = useState<number | null>(null)
  const [currentA2ADepth, setCurrentA2ADepth] = useState(0)
  const [effectiveMaxDepth, setEffectiveMaxDepth] = useState(5)
  const [workspace, setWorkspace] = useState<string | undefined>(undefined)
  const [effectiveSkills, setEffectiveSkills] = useState<Array<{ name: string; mode: 'auto' | 'required'; sourceLabel: string }>>([])
  const [globalSkillCount, setGlobalSkillCount] = useState(0)
  const [workspaceDiscoveredCount, setWorkspaceDiscoveredCount] = useState(0)
  const [sessionTelemetryByAgent, setSessionTelemetryByAgent] = useState<Record<string, SessionTelemetry>>({})

  const pollStateRef = useRef<{ state: DiscussionState; agents: Agent[] }>({
    state: 'RUNNING',
    agents: [],
  })
  const socketRef = useRef<Socket | null>(null)
  const streamingMessagesRef = useRef<Map<string, Message>>(new Map())
  const streamingThinkingRef = useRef<Map<string, string>>(new Map())
  const streamingToolCallsRef = useRef<Map<string, ToolCall[]>>(new Map())
  const streamingAgentIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    setRoomId(roomId ?? null)
  }, [roomId])

  useEffect(() => {
    setMessages([])
    setAgents([])
    setState('RUNNING')
    setReport('')
    setStreamingAgentIds(new Set())
    setMessageErrorMap({})
    setOrphanErrors([])
    setMaxA2ADepth(null)
    setCurrentA2ADepth(0)
    setEffectiveMaxDepth(5)
    setWorkspace(undefined)
    setEffectiveSkills([])
    setGlobalSkillCount(0)
    setWorkspaceDiscoveredCount(0)
    setSessionTelemetryByAgent({})
    streamingMessagesRef.current.clear()
    streamingThinkingRef.current.clear()
    streamingToolCallsRef.current.clear()
    streamingAgentIdsRef.current.clear()
  }, [roomId])

  useEffect(() => {
    if (!roomId) return

    let cancelled = false
    fetch(`${API}/api/rooms/${roomId}/skills`)
      .then(async response => {
        if (!response.ok) {
          return { effectiveUnion: [], workspaceSkills: [], globalSkills: [], workspacePath: undefined }
        }
        return await response.json() as {
          effectiveUnion?: Array<{ name: string; mode: 'auto' | 'required'; sourceLabel: string }>
          workspaceSkills?: Array<unknown>
          globalSkills?: Array<unknown>
          workspacePath?: string
        }
      })
      .then(data => {
        if (cancelled) return
        setEffectiveSkills(data.effectiveUnion ?? [])
        setGlobalSkillCount(data.globalSkills?.length ?? 0)
        setWorkspaceDiscoveredCount(data.workspaceSkills?.length ?? 0)
        if (data.workspacePath) {
          setWorkspace(data.workspacePath)
        }
        debug('ui:room:skills_loaded', {
          roomId,
          effectiveCount: data.effectiveUnion?.length ?? 0,
          globalCount: data.globalSkills?.length ?? 0,
          workspaceCount: data.workspaceSkills?.length ?? 0,
          workspacePath: data.workspacePath ?? null,
        })
      })
      .catch(error => {
        if (!cancelled) {
          setEffectiveSkills([])
          setGlobalSkillCount(0)
          setWorkspaceDiscoveredCount(0)
        }
        warn('ui:room:skills_load_failed', { roomId, error })
      })

    return () => {
      cancelled = true
    }
  }, [roomId])

  useEffect(() => {
    const socket = io(`${API}`, { transports: ['websocket', 'polling'] })
    socketRef.current = socket

    socket.on('connect', () => telemetry('socket:connect'))

    socket.on('user_message', (data: { roomId: string; message: Message }) => {
      if (data.roomId !== roomId) return
      const message = data.message
      setMessages(previous => {
        if (previous.some(item => item.id === message.id)) return previous
        return [...previous, message].sort((left, right) => left.timestamp - right.timestamp)
      })
    })

    socket.on('stream_start', (data: {
      roomId: string
      agentId: string
      agentConfigId: string
      id: string
      timestamp: number
      agentName: string
      agentRole: Agent['role']
    }) => {
      if (data.roomId !== roomId) return
      queuedDispatchPendingRef.current = false
      streamingAgentIdsRef.current.add(data.agentId)
      setStreamingAgentIds(new Set(streamingAgentIdsRef.current))
      streamingThinkingRef.current.set(data.agentId, '')
      streamingToolCallsRef.current.set(data.agentId, [])
      telemetry('ui:ai:start', { roomId, agentName: data.agentName, agentRole: data.agentRole })
      telemetry('socket:stream_start', { agentName: data.agentName, id: data.id })
      const tempMessage: Message = {
        id: data.id,
        agentRole: data.agentRole,
        agentName: data.agentName,
        content: '',
        timestamp: data.timestamp,
        type: 'streaming',
      }
      streamingMessagesRef.current.set(data.agentId, tempMessage)
      setMessages(previous => [...previous.filter(item => item.id !== data.id), tempMessage])
    })

    socket.on('stream_delta', (data: { roomId: string; agentId: string; text: string }) => {
      if (data.roomId !== roomId) return
      const message = streamingMessagesRef.current.get(data.agentId)
      if (!message) return
      message.content += data.text
      setMessages(previous => previous.map(item => item.id === message.id ? { ...item, content: message.content } : item))
    })

    socket.on('thinking_delta', (data: { roomId: string; agentId: string; thinking: string }) => {
      if (data.roomId !== roomId) return
      const existingThinking = streamingThinkingRef.current.get(data.agentId) || ''
      streamingThinkingRef.current.set(data.agentId, existingThinking + data.thinking)
      const message = streamingMessagesRef.current.get(data.agentId)
      if (!message) return
      const accumulatedThinking = streamingThinkingRef.current.get(data.agentId)
      message.thinking = accumulatedThinking
      setMessages(previous => previous.map(item => item.id === message.id ? { ...item, thinking: accumulatedThinking } : item))
    })

    socket.on('tool_use', (data: {
      roomId: string
      agentId: string
      toolName: string
      toolInput?: Record<string, unknown>
      callId?: string
      timestamp?: number
    }) => {
      if (data.roomId !== roomId) return
      const toolCalls = streamingToolCallsRef.current.get(data.agentId) ?? []
      toolCalls.push({
        toolName: data.toolName,
        toolInput: data.toolInput ?? {},
        callId: data.callId,
        timestamp: data.timestamp ?? Date.now(),
      })
      streamingToolCallsRef.current.set(data.agentId, toolCalls)
      const message = streamingMessagesRef.current.get(data.agentId)
      if (!message) return
      message.toolCalls = [...toolCalls]
      setMessages(previous => previous.map(item => item.id === message.id ? { ...item, toolCalls: [...toolCalls] } : item))
    })

    socket.on('room_error_event', (data: { roomId: string; error: AgentRunErrorEvent }) => {
      if (data.roomId !== roomId) return
      queuedDispatchPendingRef.current = false
      const roomError = data.error
      if (roomError.messageId) {
        setMessageErrorMap(previous => ({ ...previous, [roomError.messageId as string]: roomError }))
        const streamingMessage = streamingMessagesRef.current.get(roomError.agentId)
        if (streamingMessage?.id === roomError.messageId) {
          streamingMessagesRef.current.delete(roomError.agentId)
          streamingThinkingRef.current.delete(roomError.agentId)
          streamingToolCallsRef.current.delete(roomError.agentId)
          streamingAgentIdsRef.current.delete(roomError.agentId)
          setStreamingAgentIds(new Set(streamingAgentIdsRef.current))
        }
        setMessages(previous => previous.map(message =>
          message.id === roomError.messageId
            ? {
                ...message,
                runError: roomError,
                duration_ms: message.duration_ms ?? 0,
                total_cost_usd: message.total_cost_usd ?? 0,
                input_tokens: message.input_tokens ?? 0,
                output_tokens: message.output_tokens ?? 0,
                type: message.type === 'streaming' ? 'statement' : message.type,
              }
            : message,
        ))
      } else {
        setOrphanErrors(previous => [...previous, roomError])
      }
    })

    socket.on('stream_end', (data: {
      roomId: string
      agentId: string
      id: string
      duration_ms: number
      total_cost_usd: number
      input_tokens: number
      output_tokens: number
      agentConfigId?: string
      sessionId?: string
      invocationUsage?: Message['invocationUsage']
      contextHealth?: Message['contextHealth']
    }) => {
      if (data.roomId !== roomId) return
      queuedDispatchPendingRef.current = false
      streamingAgentIdsRef.current.delete(data.agentId)
      setStreamingAgentIds(new Set(streamingAgentIdsRef.current))
      const message = streamingMessagesRef.current.get(data.agentId)
      telemetry('ui:ai:end', {
        roomId,
        agentName: message?.agentName ?? '',
        duration_ms: data.duration_ms,
        total_cost_usd: data.total_cost_usd,
        output_tokens: data.output_tokens,
      })
      telemetry('socket:stream_end', { id: data.id, duration_ms: data.duration_ms })
      if (message) {
        message.duration_ms = data.duration_ms
        message.total_cost_usd = data.total_cost_usd
        message.input_tokens = data.input_tokens
        message.output_tokens = data.output_tokens
        message.sessionId = data.sessionId
        message.invocationUsage = data.invocationUsage
        message.contextHealth = data.contextHealth
        const accumulatedThinking = streamingThinkingRef.current.get(data.agentId)
        const accumulatedToolCalls = streamingToolCallsRef.current.get(data.agentId)
        setMessages(previous => previous.map(item =>
          item.id === data.id
            ? {
                ...message,
                thinking: accumulatedThinking ?? message.thinking,
                toolCalls: accumulatedToolCalls ?? message.toolCalls,
                type: item.type !== 'streaming' ? item.type : 'statement',
              }
            : item,
        ))
        const telemetryKey = data.agentConfigId
        if (telemetryKey && data.sessionId) {
          setSessionTelemetryByAgent(previous => ({
            ...previous,
            [telemetryKey]: {
              sessionId: data.sessionId!,
              invocationUsage: data.invocationUsage,
              contextHealth: data.contextHealth,
              measuredAt: Date.now(),
            },
          }))
        }
      }
      streamingMessagesRef.current.delete(data.agentId)
      streamingThinkingRef.current.delete(data.agentId)
      streamingToolCallsRef.current.delete(data.agentId)
    })

    socket.on('agent_status', (data: { roomId: string; agentId: string; status: Agent['status'] }) => {
      if (data.roomId !== roomId) return
      setAgents(previous => previous.map(agent => agent.id === data.agentId ? { ...agent, status: data.status } : agent))
    })

    socket.on('room:agent-joined', (data: { roomId: string; agents: Agent[]; systemMessage: Message }) => {
      if (data.roomId !== roomId) return
      setAgents(data.agents)
      setMessages(previous => {
        if (previous.some(message => message.id === data.systemMessage.id)) return previous
        return [...previous, data.systemMessage]
      })
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [queuedDispatchPendingRef, roomId])

  useEffect(() => {
    if (!roomId || !socketRef.current) return
    socketRef.current.emit('join-room', roomId)
    telemetry('socket:join_room', { roomId })
    telemetry('ui:room:enter', { roomId })
    return () => {
      if (socketRef.current) {
        socketRef.current.emit('leave-room', roomId)
      }
    }
  }, [roomId])

  useEffect(() => {
    if (!roomId) return

    const poll = async () => {
      try {
        const response = await fetch(`${API}/api/rooms/${roomId}/messages`)
        if (!response.ok) return

        const data = await response.json()
        const nextState = data.state || 'RUNNING'
        const nextAgents = data.agents || []
        pollStateRef.current = { state: nextState, agents: nextAgents }
        setState(nextState)
        setAgents(nextAgents)
        setReport(data.report || '')
        if (data.maxA2ADepth !== undefined) {
          setMaxA2ADepth(data.maxA2ADepth)
        }
        if (data.a2aDepth !== undefined) {
          setCurrentA2ADepth(data.a2aDepth)
        }
        if (data.effectiveMaxDepth !== undefined) {
          setEffectiveMaxDepth(data.effectiveMaxDepth)
        }
        if (data.workspace !== undefined) {
          setWorkspace(data.workspace)
        }
        if (data.sessionTelemetryByAgent !== undefined) {
          setSessionTelemetryByAgent(data.sessionTelemetryByAgent as Record<string, SessionTelemetry>)
        }

        const fetchedMessages = (data.messages || []) as Message[]
        const fetchedById = new Map(fetchedMessages.map(message => [message.id, message]))
        let recoveredMissedStreamEnd = false
        for (const [agentId, streamingMessage] of streamingMessagesRef.current) {
          const freshMessage = fetchedById.get(streamingMessage.id)
          if (freshMessage && (freshMessage.runError || freshMessage.duration_ms !== undefined)) {
            streamingMessagesRef.current.delete(agentId)
            streamingThinkingRef.current.delete(agentId)
            streamingToolCallsRef.current.delete(agentId)
            streamingAgentIdsRef.current.delete(agentId)
            recoveredMissedStreamEnd = true
          }
        }

        const nowIdle = streamingAgentIdsRef.current.size === 0 &&
          !nextAgents.some((agent: Agent) => agent.status === 'thinking' || agent.status === 'waiting')
        if (!nowIdle) {
          queuedDispatchPendingRef.current = false
        }
        if (recoveredMissedStreamEnd) {
          setStreamingAgentIds(new Set(streamingAgentIdsRef.current))
        }

        const fetchedErrors = fetchedMessages.filter(message => message.runError)
        if (fetchedErrors.length > 0) {
          setMessageErrorMap(previous => {
            const next = { ...previous }
            for (const message of fetchedErrors) {
              if (message.runError) {
                next[message.id] = message.runError as AgentRunErrorEvent
              }
            }
            return next
          })
        }

        setMessages(previous => {
          const mergedExisting = previous.map(existing => {
            const fresh = fetchedById.get(existing.id)
            if (!fresh) return existing
            if (fresh.runError || fresh.duration_ms !== undefined || existing.type !== 'streaming') {
              return {
                ...existing,
                ...fresh,
                type: existing.type === 'streaming' && fresh.duration_ms === undefined && !fresh.runError
                  ? existing.type
                  : fresh.type,
              }
            }
            return existing
          })
          const existingIds = new Set(mergedExisting.map(message => message.id))
          const merged = [
            ...mergedExisting,
            ...fetchedMessages.filter(message => !existingIds.has(message.id)),
          ]
          return merged.sort((left, right) => left.timestamp - right.timestamp)
        })
      } catch {}
    }

    void poll()
    const interval = setInterval(() => {
      const { state: currentState, agents: currentAgents } = pollStateRef.current
      const anyThinking = currentAgents.some(agent => agent.status === 'thinking' || agent.status === 'waiting')
      if (!anyThinking && currentState !== 'RUNNING') return
      void poll()
    }, 2000)

    return () => clearInterval(interval)
  }, [queuedDispatchPendingRef, roomId])

  return {
    state,
    messages,
    agents,
    report,
    streamingAgentIds,
    messageErrorMap,
    orphanErrors,
    maxA2ADepth,
    setMaxA2ADepth,
    currentA2ADepth,
    setCurrentA2ADepth,
    effectiveMaxDepth,
    setEffectiveMaxDepth,
    workspace,
    effectiveSkills,
    globalSkillCount,
    workspaceDiscoveredCount,
    sessionTelemetryByAgent,
  }
}
