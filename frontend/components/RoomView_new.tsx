'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { API_URL } from '@/lib/api'

const API = API_URL;
import { io, type Socket } from 'socket.io-client'
import {
  ChevronDown, ChevronLeft, ChevronRight, Download, Menu, UserPlus, Users,
} from 'lucide-react'
import {
  extractUserMentionsFromAgents,
  type Agent, type Message, type DiscussionState, type OutgoingQueueItem, type ToolCall,
} from '../lib/agents'
import {
  createOutgoingQueueItem,
  findRecallableOutgoingQueueItem,
  getNextQueuedOutgoingItem,
  isRoomBusy as computeIsRoomBusy,
  markOutgoingQueueItemDispatching,
  recallOutgoingQueueItem,
  removeOutgoingQueueItem,
} from '../lib/outgoingQueue'
import { rewriteMessageForDifferentAgent } from '../lib/errorRecovery'
import { error as logError, telemetry, setRoomId } from '../lib/logger'
import CreateRoomModal from './CreateRoomModal'
import { OutgoingMessageQueue } from './OutgoingMessageQueue'
import SettingsModal from './SettingsModal'
import { RoomListSidebarDesktop, RoomListSidebarMobile } from './RoomListSidebar'
import { AgentPanel } from './AgentPanel'
import { AgentInviteDrawer } from './AgentInviteDrawer'
import { type AgentRunErrorEvent } from './ErrorBubble'
import { MessageList } from './MessageList'
import { RoomComposer } from './RoomComposer'
import { type RoomComposerHandle } from './RoomComposer'

// F017: A2A depth dropdown
function DepthSwitcher({ value, onChange, currentDepth, maxDepth }: {
  value: number | null
  onChange: (v: number | null) => void
  currentDepth: number
  maxDepth: number
}) {
  const [open, setOpen] = useState(false)
  const maxDepthLabel = maxDepth === 0 ? '∞' : `${maxDepth}层`
  const options: { label: string; value: number | null; title: string }[] = [
    { label: `跟随场景 (${maxDepthLabel})`, value: null, title: `使用当前场景默认协作深度：${maxDepthLabel}` },
    { label: '浅 (3层)', value: 3, title: '协作深度 3 层' },
    { label: '中 (5层)', value: 5, title: '协作深度 5 层' },
    { label: '深 (10层)', value: 10, title: '协作深度 10 层' },
    { label: '∞ 无限', value: 0, title: '无深度限制' },
  ]
  // remaining = maxDepth - currentDepth (decrements from maxDepth toward 0)
  const remaining = maxDepth === 0 ? '∞' : Math.max(0, maxDepth - currentDepth)

  return (
    <div className="relative flex items-center" title="A2A 协作深度">
      {/* Single clickable badge+trigger: A2A N/M ▼ — click anywhere to open dropdown */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 px-2 py-0.5 bg-surface-muted rounded-lg text-[11px] font-semibold hover:bg-surface-muted/80 transition-colors"
      >
        <span className="text-ink-soft">A2A</span>
        <span className="text-accent font-bold">{remaining}</span>
        <span className="text-ink-soft">/</span>
        <span className="text-ink">{maxDepth === 0 ? '∞' : maxDepth}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {/* Dropdown menu */}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-surface rounded-lg shadow-lg border border-border overflow-hidden min-w-[120px]">
          {options.map(opt => (
            <button
              key={String(opt.value)}
              type="button"
              title={opt.title}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                value === opt.value
                  ? 'bg-accent text-white'
                  : 'text-ink hover:bg-surface-muted'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface RoomViewProps { roomId?: string; defaultCreateOpen?: boolean }

const AGENT_PANEL_DEFAULT_WIDTH = 320
const AGENT_PANEL_MIN_WIDTH = 280
const AGENT_PANEL_MAX_WIDTH = 560
const AGENT_PANEL_WIDTH_KEY = 'opencouncil.agent-panel-width'
const AGENT_PANEL_COLLAPSED_KEY = 'opencouncil.agent-panel-collapsed'

function clampAgentPanelWidth(width: number) {
  return Math.min(AGENT_PANEL_MAX_WIDTH, Math.max(AGENT_PANEL_MIN_WIDTH, Math.round(width)))
}

export default function RoomView_new({ roomId, defaultCreateOpen = false }: RoomViewProps) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(defaultCreateOpen)
  const router = useRouter()
  const [state, setState] = useState<DiscussionState>('RUNNING')
  const [messages, setMessages] = useState<Message[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [report, setReport] = useState<string>('')
  const [rooms, setRooms] = useState<{ id: string; topic: string; createdAt: number; updatedAt: number; state: DiscussionState; workspace?: string; preview?: string; agentCount: number }[]>([])
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<'agent' | 'provider'>('agent')
  // AC-4: mobile agent drawer
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [streamingAgentIds, setStreamingAgentIds] = useState<Set<string>>(new Set())
  const [stoppingAgentIds, setStoppingAgentIds] = useState<Set<string>>(new Set())
  const [outgoingQueue, setOutgoingQueue] = useState<OutgoingQueueItem[]>([])
  const [composerDraft, setComposerDraft] = useState('')
  const [messageErrorMap, setMessageErrorMap] = useState<Record<string, AgentRunErrorEvent>>({})
  const [orphanErrors, setOrphanErrors] = useState<AgentRunErrorEvent[]>([])
  // F017: A2A depth config (null = inherit scene default)
  const [maxA2ADepth, setMaxA2ADepth] = useState<number | null>(null)
  // F017: current A2A depth and effective max (from poll, but user-selected takes precedence)
  const [currentA2ADepth, setCurrentA2ADepth] = useState(0)
  const [effectiveMaxDepth, setEffectiveMaxDepth] = useState(5)
  // F006: workspace path from poll
  const [workspace, setWorkspace] = useState<string | undefined>(undefined)
  const [agentPanelWidth, setAgentPanelWidth] = useState(AGENT_PANEL_DEFAULT_WIDTH)
  const [agentPanelCollapsed, setAgentPanelCollapsed] = useState(false)

  // F017: displayMax — user-selected depth option takes priority over poll's effectiveMaxDepth
  const displayMax = maxA2ADepth !== null ? maxA2ADepth : effectiveMaxDepth

  const [mounted, setMounted] = useState(false)

  const { theme, resolvedTheme, setTheme } = useTheme()
  const currentTheme = resolvedTheme ?? theme
  const toggleTheme = useCallback(() => {
    setTheme(currentTheme === 'dark' ? 'light' : 'dark')
  }, [currentTheme, setTheme])
  const openSystemSettings = useCallback(() => {
    setSettingsInitialTab('agent')
    setSettingsOpen(true)
  }, [])
  const composerRef = useRef<RoomComposerHandle>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollStateRef = useRef<{ state: DiscussionState; agents: Agent[] }>({ state: 'RUNNING' as DiscussionState, agents: [] as Agent[] })
  const streamingMessagesRef = useRef<Map<string, Message>>(new Map())
  const streamingThinkingRef = useRef<Map<string, string>>(new Map())
  const streamingToolCallsRef = useRef<Map<string, ToolCall[]>>(new Map())

  // F007: invite drawer
  const [showInviteDrawer, setShowInviteDrawer] = useState(false)
  const userScrolledRef = useRef(false)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const streamingCountRef = useRef(0)
  const streamingAgentIdsRef = useRef<Set<string>>(new Set())
  const outgoingQueueRef = useRef<OutgoingQueueItem[]>([])
  const dispatchingQueueItemIdRef = useRef<string | null>(null)
  const isDrainingQueueRef = useRef(false)
  const queuedDispatchPendingRef = useRef(false)
  const socketRef = useRef<Socket | null>(null)
  const agentsRef = useRef<Agent[]>([])
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

  const scrollToBottom = useCallback(() => {
    if (userScrolledRef.current) return
    const behavior = streamingCountRef.current > 0 ? 'instant' : 'smooth'
    messagesEndRef.current?.scrollIntoView({ behavior })
  }, [])

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    userScrolledRef.current = distFromBottom > 100
    setShowScrollBtn(distFromBottom > 100)
  }, [])

  const handleScrollToBottom = useCallback(() => {
    userScrolledRef.current = false
    setShowScrollBtn(false)
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, scrollToBottom])

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const storedWidth = Number.parseInt(localStorage.getItem(AGENT_PANEL_WIDTH_KEY) ?? '', 10)
    if (Number.isFinite(storedWidth)) {
      setAgentPanelWidth(clampAgentPanelWidth(storedWidth))
    }
    setAgentPanelCollapsed(localStorage.getItem(AGENT_PANEL_COLLAPSED_KEY) === '1')
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(AGENT_PANEL_WIDTH_KEY, String(agentPanelWidth))
  }, [agentPanelWidth])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(AGENT_PANEL_COLLAPSED_KEY, agentPanelCollapsed ? '1' : '0')
  }, [agentPanelCollapsed])

  // AC-5: debug logs are no longer synced to UI state (panel removed)

  // F0043: Set roomId in logger so frontend logs get persisted to logs/{roomId}.log
  useEffect(() => { setRoomId(roomId ?? null) }, [roomId])

  // Bug fix: reset all per-room state on roomId change so old data never bleeds through
  useEffect(() => {
    setMessages([])
    setAgents([])
    setState('RUNNING')
    setReport('')
    setStreamingAgentIds(new Set())
    setStoppingAgentIds(new Set())
    setOutgoingQueue([])
    setComposerDraft('')
    setMessageErrorMap({})
    setOrphanErrors([])
    // Reset all streaming refs so previous room's in-flight messages don't bleed in
    streamingMessagesRef.current.clear()
    streamingThinkingRef.current.clear()
    streamingToolCallsRef.current.clear()
    streamingCountRef.current = 0
    streamingAgentIdsRef.current.clear()
    outgoingQueueRef.current = []
    dispatchingQueueItemIdRef.current = null
    isDrainingQueueRef.current = false
    queuedDispatchPendingRef.current = false
    userScrolledRef.current = false
    setShowScrollBtn(false)
  }, [roomId])


  useEffect(() => { agentsRef.current = agents }, [agents])

  useEffect(() => {
    const busyIds = new Set(busyAgents.map(agent => agent.id))
    setStoppingAgentIds(prev => {
      const next = new Set(Array.from(prev).filter(id => busyIds.has(id)))
      if (next.size === prev.size && Array.from(next).every(id => prev.has(id))) {
        return prev
      }
      return next
    })
  }, [busyAgents])

  const handleAgentPanelWidthChange = useCallback((nextWidth: number) => {
    setAgentPanelWidth(clampAgentPanelWidth(nextWidth))
  }, [])

  const toggleAgentPanel = useCallback(() => {
    setAgentPanelCollapsed(prev => !prev)
  }, [])

  // ─── Socket ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(`${API}`, { transports: ['websocket', 'polling'] })
    socketRef.current = socket

    socket.on('connect', () => telemetry('socket:connect'))

    socket.on('user_message', (data: any) => {
      if (data.roomId !== roomId) return
      const msg = data.message as Message
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev
        return [...prev, msg].sort((a, b) => a.timestamp - b.timestamp)
      })
    })

    socket.on('stream_start', (data: any) => {
      if (data.roomId !== roomId) return
      queuedDispatchPendingRef.current = false
      streamingCountRef.current++
      streamingAgentIdsRef.current.add(data.agentId)
      setStreamingAgentIds(new Set(streamingAgentIdsRef.current))
      streamingThinkingRef.current.set(data.agentId, '')
      streamingToolCallsRef.current.set(data.agentId, [])
      telemetry('ui:ai:start', { roomId, agentName: data.agentName, agentRole: data.agentRole })
      telemetry('socket:stream_start', { agentName: data.agentName, id: data.id })
      const tempMsg: Message = {
        id: data.id,
        agentRole: data.agentRole as Agent['role'],
        agentName: data.agentName,
        content: '',
        timestamp: data.timestamp,
        type: 'streaming',
      }
      streamingMessagesRef.current.set(data.agentId, tempMsg)
      setMessages(prev => [...prev.filter(m => m.id !== data.id), tempMsg])
    })

    socket.on('stream_delta', (data: any) => {
      if (data.roomId !== roomId) return
      const msg = streamingMessagesRef.current.get(data.agentId)
      if (msg) {
        msg.content += data.text
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: msg.content } : m))
      }
    })

    socket.on('thinking_delta', (data: any) => {
      if (data.roomId !== roomId) return
      const existing = streamingThinkingRef.current.get(data.agentId) || ''
      streamingThinkingRef.current.set(data.agentId, existing + data.thinking)
      const msg = streamingMessagesRef.current.get(data.agentId)
      if (msg) {
        const accumulatedThinking = streamingThinkingRef.current.get(data.agentId)
        msg.thinking = accumulatedThinking
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, thinking: accumulatedThinking } : m))
      }
    })

    socket.on('tool_use', (data: any) => {
      if (data.roomId !== roomId) return
      const toolCalls = streamingToolCallsRef.current.get(data.agentId) ?? []
      toolCalls.push({
        toolName: data.toolName,
        toolInput: data.toolInput ?? {},
        callId: data.callId,
        timestamp: data.timestamp ?? Date.now(),
      })
      streamingToolCallsRef.current.set(data.agentId, toolCalls)
      const msg = streamingMessagesRef.current.get(data.agentId)
      if (msg) {
        msg.toolCalls = [...toolCalls]
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, toolCalls: [...toolCalls] } : m))
      }
    })

    socket.on('room_error_event', (data: any) => {
      if (data.roomId !== roomId) return
      queuedDispatchPendingRef.current = false
      const roomError = data.error as AgentRunErrorEvent
      if (roomError.messageId) {
        setMessageErrorMap(prev => ({ ...prev, [roomError.messageId as string]: roomError }))
        const streamingMsg = streamingMessagesRef.current.get(roomError.agentId)
        if (streamingMsg?.id === roomError.messageId) {
          streamingMessagesRef.current.delete(roomError.agentId)
          streamingThinkingRef.current.delete(roomError.agentId)
          streamingToolCallsRef.current.delete(roomError.agentId)
          streamingAgentIdsRef.current.delete(roomError.agentId)
          streamingCountRef.current = streamingMessagesRef.current.size
          setStreamingAgentIds(new Set(streamingAgentIdsRef.current))
        }
        setMessages(prev => prev.map(m =>
          m.id === roomError.messageId
            ? {
                ...m,
                runError: roomError,
                duration_ms: m.duration_ms ?? 0,
                total_cost_usd: m.total_cost_usd ?? 0,
                input_tokens: m.input_tokens ?? 0,
                output_tokens: m.output_tokens ?? 0,
                type: m.type === 'streaming' ? 'statement' : m.type,
              }
            : m,
        ))
      } else {
        setOrphanErrors(prev => [...prev, roomError])
      }
      // trigger queue drain when last streaming agent finishes
      const stillStreaming = streamingAgentIdsRef.current.size
      void stillStreaming
    })

    socket.on('stream_end', (data: any) => {
      if (data.roomId !== roomId) return
      queuedDispatchPendingRef.current = false
      streamingCountRef.current = Math.max(0, streamingCountRef.current - 1)
      streamingAgentIdsRef.current.delete(data.agentId)
      setStreamingAgentIds(new Set(streamingAgentIdsRef.current))
      const msg = streamingMessagesRef.current.get(data.agentId)
      telemetry('ui:ai:end', { roomId, agentName: msg?.agentName ?? '', duration_ms: data.duration_ms, total_cost_usd: data.total_cost_usd, output_tokens: data.output_tokens })
      telemetry('socket:stream_end', { id: data.id, duration_ms: data.duration_ms })
      if (msg) {
        msg.duration_ms = data.duration_ms
        msg.total_cost_usd = data.total_cost_usd
        msg.input_tokens = data.input_tokens
        msg.output_tokens = data.output_tokens
        const accumulatedThinking = streamingThinkingRef.current.get(data.agentId)
        const accumulatedToolCalls = streamingToolCallsRef.current.get(data.agentId)
        setMessages(prev => prev.map(m => m.id === data.id ? { ...msg, thinking: accumulatedThinking ?? msg.thinking, toolCalls: accumulatedToolCalls ?? msg.toolCalls, type: m.type !== 'streaming' ? m.type : 'statement' } : m))
      }
      streamingMessagesRef.current.delete(data.agentId)
      streamingThinkingRef.current.delete(data.agentId)
      streamingToolCallsRef.current.delete(data.agentId)
      // trigger queue drain when last streaming agent finishes
      const stillStreaming = streamingAgentIdsRef.current.size
      void stillStreaming
    })

    socket.on('agent_status', (data: any) => {
      if (data.roomId !== roomId) return
      setAgents(prev => prev.map(a => a.id === data.agentId ? { ...a, status: data.status as Agent['status'] } : a))
    })

    // F007: agent joined room
    socket.on('room:agent-joined', (data: any) => {
      if (data.roomId !== roomId) return
      // 更新 agent 列表
      setAgents(data.agents as Agent[])
      // 追加系统消息（去重）
      setMessages(prev => {
        if (prev.some(m => m.id === data.systemMessage.id)) return prev
        return [...prev, data.systemMessage as Message]
      })
    })

    return () => { socket.disconnect(); socketRef.current = null }
  }, [roomId])

  useEffect(() => {
    if (!roomId || !socketRef.current) return
    socketRef.current.emit('join-room', roomId)
    telemetry('socket:join_room', { roomId })
    telemetry('ui:room:enter', { roomId })
    return () => { if (socketRef.current) socketRef.current.emit('leave-room', roomId) }
  }, [roomId])

  // ─── Room list ───────────────────────────────────────────────────────────────
  // F011: load from /api/rooms/sidebar (lightweight, no full messages) + 30s polling
  useEffect(() => {
    telemetry('room:list:load')
    fetch(`${API}/api/rooms/sidebar`).then(r => r.ok ? r.json() : []).then((data: any[]) => {
      setRooms(data.map((room: any) => ({
        id: room.id,
        topic: room.topic,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
        state: room.state as DiscussionState,
        workspace: room.workspace,
        preview: room.preview,
        agentCount: room.agentCount,
      })))
    })
  }, [])

  // F011: poll room list every 30s to keep updatedAt and preview fresh
  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`${API}/api/rooms/sidebar`).then(r => r.ok ? r.json() : []).then((data: any[]) => {
        setRooms(data.map((room: any) => ({
          id: room.id,
          topic: room.topic,
          createdAt: room.createdAt,
          updatedAt: room.updatedAt,
          state: room.state as DiscussionState,
          workspace: room.workspace,
          preview: room.preview,
          agentCount: room.agentCount,
        })))
      })
    }, 30000)
    return () => clearInterval(interval)
  }, [])
    
  // ─── Polling ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return
    const poll = async () => {
      try {
        const res = await fetch(`${API}/api/rooms/${roomId}/messages`)
        if (!res.ok) {
          return
        }
        const data = await res.json()
        const newState = data.state || 'RUNNING'
        const newAgents = data.agents || []
        pollStateRef.current = { state: newState, agents: newAgents }
        setState(newState)
        setAgents(newAgents)
        setReport(data.report || '')
        // F017: read effective maxA2ADepth from poll response
        if (data.maxA2ADepth !== undefined) {
          setMaxA2ADepth(data.maxA2ADepth)
        }
        // F017: read current A2A depth and effective max from poll response
        if (data.a2aDepth !== undefined) {
          setCurrentA2ADepth(data.a2aDepth)
        }
        if (data.effectiveMaxDepth !== undefined) {
          setEffectiveMaxDepth(data.effectiveMaxDepth)
        }
        if (data.workspace !== undefined) {
          setWorkspace(data.workspace)
        }
        const fetchedMessages = (data.messages || []) as Message[]
        const fetchedById = new Map(fetchedMessages.map(m => [m.id, m]))
        let recoveredMissedStreamEnd = false
        for (const [agentId, streamingMsg] of streamingMessagesRef.current) {
          const fresh = fetchedById.get(streamingMsg.id)
          if (fresh && (fresh.runError || fresh.duration_ms !== undefined)) {
            streamingMessagesRef.current.delete(agentId)
            streamingThinkingRef.current.delete(agentId)
            streamingToolCallsRef.current.delete(agentId)
            streamingAgentIdsRef.current.delete(agentId)
            recoveredMissedStreamEnd = true
          }
        }
        const nowIdle = streamingAgentIdsRef.current.size === 0 &&
          !newAgents.some((a: Agent) => a.status === 'thinking' || a.status === 'waiting')
        if (!nowIdle) {
          queuedDispatchPendingRef.current = false
        }
        if (recoveredMissedStreamEnd) {
          // Sync React state with the refs we just cleaned up
          streamingCountRef.current = streamingMessagesRef.current.size
          setStreamingAgentIds(new Set(streamingAgentIdsRef.current))
        }
        const fetchedErrors = fetchedMessages.filter(m => m.runError)
        if (fetchedErrors.length > 0) {
          setMessageErrorMap(prev => {
            const next = { ...prev }
            for (const msg of fetchedErrors) {
              if (msg.runError) next[msg.id] = msg.runError
            }
            return next
          })
        }
        setMessages(prev => {
          const mergedExisting = prev.map(existing => {
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
          const existingIds = new Set(mergedExisting.map(m => m.id))
          const merged = [...mergedExisting, ...fetchedMessages.filter((m: Message) => !existingIds.has(m.id))]
          return merged.sort((a, b) => a.timestamp - b.timestamp)
        })
      } catch {}
    }
    poll()
    const interval = setInterval(() => {
      const { state: s, agents: ag } = pollStateRef.current
      const anyThinking = ag.some(a => a.status === 'thinking' || a.status === 'waiting')
      if (!anyThinking && s !== 'RUNNING') return
      poll()
    }, 2000)
    return () => clearInterval(interval)
  }, [roomId])

  const handleDownload = () => {
    if (!report) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([report], { type: 'text/markdown' }))
    a.download = 'discussion-report.md'
    a.click()
  }

  // ─── @mention helpers ────────────────────────────────────────────────────────
  // F013: derive last-active WORKER from message history (for mention picker sort)
  const lastActiveWorkerId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.agentRole !== 'WORKER') continue
      return agents.find(a => a.name === msg.agentName)?.id ?? null
    }
    return null
  }, [messages, agents])

  const currentAgentConfigIds = useMemo(
    () => agents.map(a => a.configId ?? ''),
    [agents],
  )
  const agentNames = useMemo(() => agents.map(a => a.name), [agents])

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
    telemetry('ui:msg:send', {
      roomId,
      source,
      contentLength: content.length,
      contentSnippet: content.length > 80 ? `${content.slice(0, 80)}…` : content,
      toAgentId: recipientId,
      toAgentName: targetName,
    })
    const res = await fetch(`${API}/api/rooms/${roomId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, toAgentId: recipientId }),
    })
    if (res.ok) return { ok: true }
    return {
      ok: false,
      status: res.status,
      errorText: await res.text(),
    }
  }, [roomId])

  const enqueuePreparedMessage = useCallback((content: string, toAgentId: string, toAgentName: string) => {
    const item = createOutgoingQueueItem({ content, toAgentId, toAgentName })
    setOutgoingQueue(prev => {
      const next = [...prev, item]
      outgoingQueueRef.current = next
      return next
    })
  }, [])

  const cancelQueuedItem = useCallback((itemId: string) => {
    if (dispatchingQueueItemIdRef.current === itemId) return
    setOutgoingQueue(prev => {
      const next = removeOutgoingQueueItem(prev, itemId)
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
    setOutgoingQueue(prev => {
      const recalled = recallOutgoingQueueItem(prev, itemId)
      if (!recalled.recalledItem) return prev
      outgoingQueueRef.current = recalled.items
      composerRef.current?.setDraft(recalled.recalledItem.content)
      composerRef.current?.focus()
      return recalled.items
    })
  }, [showSendError])

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
    setOutgoingQueue(prev => {
      const next = markOutgoingQueueItemDispatching(prev, nextItem.id)
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
        setOutgoingQueue(prev => {
          const next = removeOutgoingQueueItem(prev, nextItem.id)
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
        setOutgoingQueue(prev => {
          const next = prev.map(item => item.id === nextItem.id ? { ...item, status: 'queued' as const } : item)
          outgoingQueueRef.current = next
          return next
        })
        return
      }

      if (result.status === 400) {
        setOutgoingQueue(prev => {
          const next = removeOutgoingQueueItem(prev, nextItem.id)
          outgoingQueueRef.current = next
          return next
        })
        showSendError('队列消息发送失败：目标专家已不可用')
        return
      }

      setOutgoingQueue(prev => {
        const next = prev.map(item => item.id === nextItem.id ? { ...item, status: 'queued' as const } : item)
        outgoingQueueRef.current = next
        return next
      })
      showSendError('队列消息发送失败，请稍后重试')
    } catch (error) {
      logError('queue:dispatch_error', { roomId, itemId: nextItem.id, error: String(error) })
      setOutgoingQueue(prev => {
        const next = prev.map(item => item.id === nextItem.id ? { ...item, status: 'queued' as const } : item)
        outgoingQueueRef.current = next
        return next
      })
      showSendError('队列消息发送失败，请检查网络')
    } finally {
      dispatchingQueueItemIdRef.current = null
      isDrainingQueueRef.current = false
    }
  }, [postPreparedContent, roomId, showSendError])

  const sendPreparedContent = useCallback(async (rawContent: string) => {
    if (!roomId || sending) return false
    const content = rawContent.trim()
    if (!content) return false
    if (extractUserMentionsFromAgents(content, agentNames).length === 0) {
      showSendError('先选择要发给哪位专家：输入 @ 或点一个专家名称')
      composerRef.current?.focus()
      return false
    }
    // F013: @ is the single source of truth — derive toAgentId from mention text
    const mentionNames = extractUserMentionsFromAgents(content, agentNames)
    const targetName = mentionNames[0] ?? null
    const recipientId = targetName
      ? agents.find(a => a.name === targetName)?.id ?? null
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
    } catch (e) {
      logError('msg:send_error', { roomId, error: String(e) })
      showSendError('发送失败，请检查网络')
      return false
    } finally {
      setSending(false)
    }
  }, [agentNames, agents, enqueuePreparedMessage, postPreparedContent, roomId, sending, showSendError])

  const restoreFailedInput = useCallback((content?: string) => {
    if (!content) return
    if (composerRef.current?.hasDraft()) {
      showSendError('输入框里还有草稿，先处理当前内容再找回原提问')
      composerRef.current?.focus()
      return
    }
    composerRef.current?.setDraft(content)
    composerRef.current?.focus()
  }, [showSendError])

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
  }, [roomBusy])

  useEffect(() => {
    if (!roomId || roomBusy) return
    if (queuedDispatchPendingRef.current) return
    if (dispatchingQueueItemIdRef.current !== null) return
    if (!getNextQueuedOutgoingItem(outgoingQueue)) return
    void drainOutgoingQueue()
  }, [drainOutgoingQueue, outgoingQueue, roomBusy, roomId])

  const retryFailedMessage = useCallback(async (roomError: AgentRunErrorEvent) => {
    if (!roomError.originalUserContent) return
    if (composerRef.current?.hasDraft()) {
      showSendError('输入框里还有草稿，先处理当前内容再重试')
      composerRef.current?.focus()
      return
    }
    await sendPreparedContent(roomError.originalUserContent)
  }, [sendPreparedContent, showSendError])

  const prefillMention = useCallback((agent: Agent) => {
    composerRef.current?.prefillMention(agent)
  }, [])

  const handleRecipientSelected = useCallback((_agentId: string | null) => {}, [])
  const handleRetryFailedMessage = useCallback((error: AgentRunErrorEvent) => {
    void retryFailedMessage(error)
  }, [retryFailedMessage])
  const handleTryAnotherAgent = useCallback((error: AgentRunErrorEvent, nextAgentId: string) => {
    if (!error.originalUserContent) return
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
    const currentRecipientName = error.toAgentName ?? error.agentName
    const rewritten = rewriteMessageForDifferentAgent(
      error.originalUserContent,
      currentRecipientName,
      nextAgent.name,
    )
    composerRef.current?.setDraft(rewritten)
    composerRef.current?.focus()
  }, [showSendError])
  const handleCopyFailedPrompt = useCallback((content?: string) => {
    void copyFailedPrompt(content)
  }, [copyFailedPrompt])

  const handleStopAgent = useCallback(async (agent: Agent) => {
    if (!roomId) return

    setStoppingAgentIds(prev => {
      const next = new Set(prev)
      next.add(agent.id)
      return next
    })

    try {
      const res = await fetch(`${API}/api/rooms/${roomId}/agents/${agent.id}/stop`, {
        method: 'POST',
      })
      if (res.ok) return

      setStoppingAgentIds(prev => {
        const next = new Set(prev)
        next.delete(agent.id)
        return next
      })

      if (res.status === 409) {
        showSendError(`${agent.name} 已经不在回答了`, 3000)
        return
      }
      if (res.status === 404) {
        showSendError(`${agent.name} 当前不可用，请刷新后重试`, 3500)
        return
      }
      showSendError('停止失败，请稍后重试')
    } catch {
      setStoppingAgentIds(prev => {
        const next = new Set(prev)
        next.delete(agent.id)
        return next
      })
      showSendError('停止失败，请检查网络')
    }
  }, [roomId, showSendError])

  const toggleMobileMenu = () => setMobileMenuOpen(o => !o)

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <CreateRoomModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
      <div className="app-islands-shell h-[100dvh] flex overflow-hidden text-ink font-sans">

        {/* Left sidebar */}
        <RoomListSidebarDesktop
          rooms={rooms}
          currentRoomId={roomId}
          onNewRoom={() => setIsCreateModalOpen(true)}
          onSelectRoom={id => router.push(`/room/${id}`)}
          onDeleteRoom={async (id) => {
            const res = await fetch(`${API}/api/rooms/${id}/archive`, { method: 'PATCH' })
            if (!res.ok) return
            if (id === roomId) router.push('/')
            else setRooms(rooms => rooms.filter(r => r.id !== id))
          }}
          theme={currentTheme}
          mounted={mounted}
          onToggleTheme={toggleTheme}
          onOpenSystemSettings={openSystemSettings}
        />

        {/* Mobile menu overlay */}
        <RoomListSidebarMobile
          rooms={rooms}
          currentRoomId={roomId}
          onNewRoom={() => setIsCreateModalOpen(true)}
          onSelectRoom={id => router.push(`/room/${id}`)}
          onDeleteRoom={async (id) => {
            const res = await fetch(`${API}/api/rooms/${id}/archive`, { method: 'PATCH' })
            if (!res.ok) return
            if (id === roomId) router.push('/')
            else setRooms(rooms => rooms.filter(r => r.id !== id))
          }}
          theme={currentTheme}
          mounted={mounted}
          onToggleTheme={toggleTheme}
          onOpenSystemSettings={openSystemSettings}
          mobileMenuOpen={mobileMenuOpen}
          onToggleMobileMenu={toggleMobileMenu}
          onCloseMobileMenu={() => setMobileMenuOpen(false)}
        />

        {/* Center: Main Discussion */}
        <div className="app-islands-panel flex-1 flex flex-col relative min-w-0">
          {/* Main Header */}
          <div className="h-[60px] md:h-16 bg-nav-bg backdrop-blur-xl border-b border-line px-4 md:px-6 flex items-center justify-between sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="md:hidden p-2 -ml-2 text-ink-soft hover:text-ink"
                onClick={toggleMobileMenu}
                aria-label="打开讨论历史"
              >
                <Menu className="w-5 h-5" />
              </button>
              <h1 className="text-lg font-bold text-ink hidden sm:block">OpenCouncil</h1>
            </div>
            <div className="flex items-center gap-2 md:gap-4">
              {/* F017: A2A depth switcher */}
              {roomId && (
                <DepthSwitcher
                  value={maxA2ADepth}
                  currentDepth={currentA2ADepth}
                  maxDepth={displayMax}
                  onChange={async (newDepth) => {
                    const prevMaxDepth = maxA2ADepth
                    const prevEffectiveMaxDepth = effectiveMaxDepth
                    setMaxA2ADepth(newDepth)
                    if (newDepth !== null) {
                      setEffectiveMaxDepth(newDepth)
                    }
                    try {
                      const res = await fetch(`${API}/api/rooms/${roomId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ maxA2ADepth: newDepth }),
                      })
                      if (!res.ok) {
                        throw new Error(`PATCH /api/rooms/${roomId} failed: ${res.status}`)
                      }
                      const data = await res.json()
                      if (Object.prototype.hasOwnProperty.call(data, 'maxA2ADepth')) {
                        setMaxA2ADepth(data.maxA2ADepth)
                      }
                      if (Object.prototype.hasOwnProperty.call(data, 'effectiveMaxDepth')) {
                        setEffectiveMaxDepth(data.effectiveMaxDepth)
                      }
                    } catch {
                      // revert on error
                      setMaxA2ADepth(prevMaxDepth)
                      setEffectiveMaxDepth(prevEffectiveMaxDepth)
                    }
                  }}
                />
              )}
              {/* AC-4: Agent panel button — visible on small screens only */}
              {roomId && (
                <button
                  type="button"
                  onClick={() => setAgentDrawerOpen(true)}
                  className="md:hidden p-2 text-ink-soft hover:text-accent transition-colors"
                  aria-label="查看参与 Agent"
                >
                  <Users className="w-5 h-5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowInviteDrawer(true)}
                className="p-2 text-ink-soft hover:text-accent transition-colors"
                aria-label="邀请专家入群"
              >
                <UserPlus className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={toggleAgentPanel}
                className="hidden lg:inline-flex p-2 text-ink-soft hover:text-accent transition-colors"
                aria-label={agentPanelCollapsed ? '展开参与 Agent 面板' : '收起参与 Agent 面板'}
                title={agentPanelCollapsed ? '展开参与 Agent 面板' : '收起参与 Agent 面板'}
              >
                {agentPanelCollapsed ? (
                  <ChevronLeft className="w-5 h-5" />
                ) : (
                  <ChevronRight className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          <MessageList
            roomId={roomId}
            messages={messages}
            agents={agents}
            state={state}
            sending={sending}
            messageErrorMap={messageErrorMap}
            orphanErrors={orphanErrors}
            showScrollBtn={showScrollBtn}
            containerRef={messagesContainerRef}
            endRef={messagesEndRef}
            onScroll={handleScroll}
            onScrollToBottom={handleScrollToBottom}
            onPrefillMention={prefillMention}
            onRetryFailedMessage={handleRetryFailedMessage}
            onRestoreFailedInput={restoreFailedInput}
            onCopyFailedPrompt={handleCopyFailedPrompt}
            onTryAnotherAgent={handleTryAnotherAgent}
          />

          {/* Action Area */}
          <div className="bg-nav-bg backdrop-blur-xl border-t border-line px-4 md:px-8 py-4 flex flex-col gap-3">
            {state === 'DONE' ? (
              <button
                type="button"
                className="w-full bg-ink text-bg font-semibold py-3.5 rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2 shadow-sm"
                onClick={handleDownload}
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
                              onClick={() => void handleStopAgent(agent)}
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
                  onCancel={cancelQueuedItem}
                  onRecall={recallQueuedItem}
                />
                <RoomComposer
                  ref={composerRef}
                  roomId={roomId}
                  agents={agents}
                  lastActiveWorkerId={lastActiveWorkerId}
                  sending={sending}
                  queueMode={roomBusy}
                  sendError={sendError}
                  onSend={sendPreparedContent}
                  onSendError={showSendError}
                  onDraftChange={setComposerDraft}
                  onRecipientSelected={handleRecipientSelected}
                />
              </>
            ) : null}
          </div>
        </div>

        {/* Right sidebar: Agents */}
        <AgentPanel
          roomId={roomId}
          agents={agents}
          workspace={workspace}
          isMobileOpen={agentDrawerOpen}
          onMobileClose={() => setAgentDrawerOpen(false)}
          desktopWidth={agentPanelWidth}
          desktopCollapsed={agentPanelCollapsed}
          onDesktopWidthChange={handleAgentPanelWidthChange}
        />

      </div>
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} initialTab={settingsInitialTab} />
      {showInviteDrawer && roomId && (
        <AgentInviteDrawer
          roomId={roomId}
          currentAgentIds={currentAgentConfigIds}
          onClose={() => setShowInviteDrawer(false)}
          onInvited={() => {}}
        />
      )}
    </>
  )
}
