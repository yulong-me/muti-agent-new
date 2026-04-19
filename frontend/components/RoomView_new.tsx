'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import ReactMarkdown from 'react-markdown'
import { API_URL } from '@/lib/api'

const API = API_URL;
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { io, type Socket } from 'socket.io-client'
import {
  Menu, Download, ChevronDown, BrainCircuit, UserPlus, Users, X, Wrench, Copy, Maximize2,
} from 'lucide-react'
import {
  AGENT_COLORS, DEFAULT_AGENT_COLOR, STATE_LABELS,
  mdComponents, extractMentions, extractUserMentionsFromAgents, findActiveMentionTrigger, insertMention, TIME_FORMATTER,
  type Agent, type Message, type DiscussionState, type ToolCall,
} from '../lib/agents'
import { error as logError, telemetry, setRoomId } from '../lib/logger'
import CreateRoomModal from './CreateRoomModal'
import SettingsModal from './SettingsModal'
import MentionPicker from './MentionPicker'
import { BubbleSection } from './BubbleSection'
import { RoomListSidebarDesktop, RoomListSidebarMobile } from './RoomListSidebar'
import { AgentPanel } from './AgentPanel'
import { AgentInviteDrawer } from './AgentInviteDrawer'
import { AgentAvatar } from './AgentAvatar'
import { ErrorBubble, type AgentRunErrorEvent } from './ErrorBubble'
import { BubbleErrorBoundary } from './BubbleErrorBoundary'

// F017: A2A depth dropdown
function DepthSwitcher({ value, onChange, currentDepth, maxDepth }: {
  value: number | null
  onChange: (v: number | null) => void
  currentDepth: number
  maxDepth: number
}) {
  const [open, setOpen] = useState(false)
  const options: { label: string; value: number | null; title: string }[] = [
    { label: '浅 (3层)', value: 3, title: '协作深度 3 层' },
    { label: '中 (5层)', value: 5, title: '协作深度 5 层（默认）' },
    { label: '深 (10层)', value: 10, title: '协作深度 10 层' },
    { label: '∞ 无限', value: 0, title: '无深度限制' },
  ]
  // null means "inherit scene default" — we treat null as 5 (the scene default) for display
  const effective = value ?? 5
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
                effective === opt.value
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
  const [userInput, setUserInput] = useState('')
  const [sending, setSending] = useState(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(null)
  // F013: selectedRecipientId kept for telemetry only; routing comes from @ mention text
  const [streamingAgentIds, setStreamingAgentIds] = useState<Set<string>>(new Set())
  const [messageErrorMap, setMessageErrorMap] = useState<Record<string, AgentRunErrorEvent>>({})
  const [orphanErrors, setOrphanErrors] = useState<AgentRunErrorEvent[]>([])
  // F017: A2A depth config (null = inherit scene default)
  const [maxA2ADepth, setMaxA2ADepth] = useState<number | null>(null)
  // F017: current A2A depth and effective max (from poll, but user-selected takes precedence)
  const [currentA2ADepth, setCurrentA2ADepth] = useState(0)
  const [effectiveMaxDepth, setEffectiveMaxDepth] = useState(5)

  // F017: displayMax — user-selected depth option takes priority over poll's effectiveMaxDepth
  const displayMax = maxA2ADepth !== null ? maxA2ADepth : effectiveMaxDepth

  // @mention picker state
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStartIdx, setMentionStartIdx] = useState(-1)
  const [mentionHighlightIdx, setMentionHighlightIdx] = useState(0)
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollStateRef = useRef<{ state: DiscussionState; agents: Agent[] }>({ state: 'RUNNING' as DiscussionState, agents: [] as Agent[] })
  const streamingMessagesRef = useRef<Map<string, Message>>(new Map())
  const streamingThinkingRef = useRef<Map<string, string>>(new Map())
  const streamingToolCallsRef = useRef<Map<string, ToolCall[]>>(new Map())

  // F007: invite drawer
  const [showInviteDrawer, setShowInviteDrawer] = useState(false)
  // Tool call hover tooltip
  const [hoveredToolCall, setHoveredToolCall] = useState<string | null>(null)
  const [expandedToolCall, setExpandedToolCall] = useState<string | null>(null)
  const hoverTimerRef = useRef<number | undefined>(undefined)
  const userScrolledRef = useRef(false)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const streamingCountRef = useRef(0)
  const streamingAgentIdsRef = useRef<Set<string>>(new Set())
  const socketRef = useRef<Socket | null>(null)
  const sendMessageRef = useRef<() => void>(() => {})
  const agentsRef = useRef<Agent[]>([])

  const scrollToBottom = () => {
    if (userScrolledRef.current) return
    const behavior = streamingCountRef.current > 0 ? 'instant' : 'smooth'
    messagesEndRef.current?.scrollIntoView({ behavior })
  }

  const handleScroll = () => {
    const el = messagesContainerRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    userScrolledRef.current = distFromBottom > 100
    setShowScrollBtn(distFromBottom > 100)
  }

  const handleScrollToBottom = () => {
    userScrolledRef.current = false
    setShowScrollBtn(false)
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => { scrollToBottom() }, [messages])

  // AC-1: Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const maxH = 200
    const newH = Math.min(ta.scrollHeight, maxH)
    ta.style.height = `${newH}px`
    ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden'
  }, [userInput])
  useEffect(() => setMounted(true), [])

  // AC-5: debug logs are no longer synced to UI state (panel removed)

  // F0043: Set roomId in logger so frontend logs get persisted to logs/{roomId}.log
  useEffect(() => { setRoomId(roomId ?? null) }, [roomId])

  // Bug fix: reset all per-room state on roomId change so old data never bleeds through
  useEffect(() => {
    setMessages([])
    setAgents([])
    setState('RUNNING')
    setReport('')
    setSelectedRecipientId(null)
    setStreamingAgentIds(new Set())
    setMessageErrorMap({})
    setOrphanErrors([])
    // Reset all streaming refs so previous room's in-flight messages don't bleed in
    streamingMessagesRef.current.clear()
    streamingThinkingRef.current.clear()
    streamingToolCallsRef.current.clear()
    streamingCountRef.current = 0
    streamingAgentIdsRef.current.clear()
    userScrolledRef.current = false
    setShowScrollBtn(false)
    // Clear tool call hover states
    setHoveredToolCall(null)
    setExpandedToolCall(null)
  }, [roomId])


  useEffect(() => { agentsRef.current = agents }, [agents])

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
    const workerMsgs = [...messages].reverse().filter(m => m.agentRole === 'WORKER')
    return workerMsgs[0]?.agentName
      ? agents.find(a => a.name === workerMsgs[0].agentName)?.id ?? null
      : null
  }, [messages, agents])

  const filteredAgents = useMemo(() => {
    const base = mentionQuery
      ? agents.filter(a => a.name.toLowerCase().includes(mentionQuery.toLowerCase()))
      : agents
    // F013: put last-active WORKER at top of mention picker
    if (!lastActiveWorkerId || mentionQuery) return base
    return [
      ...base.filter(a => a.id === lastActiveWorkerId),
      ...base.filter(a => a.id !== lastActiveWorkerId),
    ]
  }, [agents, mentionQuery, lastActiveWorkerId])
  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => a.timestamp - b.timestamp),
    [messages],
  )
  const currentAgentConfigIds = useMemo(
    () => agents.map(a => a.configId ?? ''),
    [agents],
  )

  // F015: room is busy when any agent is streaming or has thinking/waiting status
  const isRoomBusy = streamingAgentIds.size > 0 || agents.some(a => a.status === 'thinking' || a.status === 'waiting')

  const openMentionPicker = useCallback((mentionAtIdx: number, query: string, filteredCount?: number) => {
    setMentionPickerOpen(true)
    setMentionQuery(query)
    setMentionStartIdx(mentionAtIdx)
    // When query is empty, highlight last item so the bottom of the list is immediately visible
    const defaultHighlight = query === '' && (filteredCount ?? 0) > 1
      ? (filteredCount ?? 1) - 1
      : 0
    setMentionHighlightIdx(defaultHighlight)
  }, [])

  const closeMentionPicker = useCallback(() => {
    setMentionPickerOpen(false)
    setMentionQuery('')
    setMentionStartIdx(-1)
  }, [])

  const prefillMention = useCallback((agent: Agent) => {
    setUserInput(current => current.trim() ? current : `@${agent.name} `)
    setSelectedRecipientId(agent.id)
    closeMentionPicker()
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [closeMentionPicker])

  useEffect(() => {
    if (!mentionPickerOpen) return
    const onMouseDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null
      if (!target) return
      if (textareaRef.current?.contains(target)) return
      if (target.closest('[data-mention-picker="1"]')) return
      closeMentionPicker()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [mentionPickerOpen, closeMentionPicker])

  const selectMentionAgent = useCallback((agentName: string) => {
    const ta = textareaRef.current
    if (!ta || mentionStartIdx < 0) return
    const cursor = ta.selectionStart ?? userInput.length
    const { nextValue, nextCursor } = insertMention(userInput, mentionStartIdx, cursor, agentName)
    setUserInput(nextValue)
    closeMentionPicker()
    const target = agents.find(a => a.name === agentName)
    if (target) {
      setSelectedRecipientId(target.id)
      telemetry('ui:mention:pick', { roomId, agentName, agentId: target.id, agentRole: target.role })
    }
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(nextCursor, nextCursor)
    }, 0)
  }, [userInput, mentionStartIdx, closeMentionPicker, agents, roomId])

  // OPT001-P0: Memoize agentNames to avoid rebuilding array on every keystroke
  const agentNames = useMemo(() => agents.map(a => a.name), [agents])

  // OPT001-P0: Debounce mention detection to avoid cascade of setState on every keystroke.
  // Stores pending input value so the debounced callback can read it without stale closure.
  const pendingInputRef = useRef({ value: '', cursor: 0 })
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const compositionRef = useRef(false) // true while IME composition is in progress

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    const cursor = e.target.selectionStart ?? val.length
    setUserInput(val)
    pendingInputRef.current = { value: val, cursor }

    // OPT001-IME: Skip mention detection during IME composition — only detect after commit
    if (compositionRef.current) return

    // Cancel any pending debounced call
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
    }

    // Debounce mention detection by 150ms
    debounceTimerRef.current = setTimeout(() => {
      const { value, cursor: c } = pendingInputRef.current
      const activeMention = findActiveMentionTrigger(value, c, agentNames)
      if (activeMention) {
        // Open picker as soon as @ is detected — show all agents if no query yet
        // Compute filtered count so we can highlight the last item when query is empty
        const filteredCount = activeMention.query.length > 0
          ? agents.filter(a => a.name.toLowerCase().includes(activeMention.query.toLowerCase())).length
          : agents.length
        openMentionPicker(activeMention.start, activeMention.query, filteredCount)
      } else {
        closeMentionPicker()
      }
      debounceTimerRef.current = null
    }, 150)
  }, [openMentionPicker, closeMentionPicker, agentNames])

  const handleCompositionStart = useCallback(() => {
    compositionRef.current = true
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
  }, [])

  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLTextAreaElement>) => {
    compositionRef.current = false
    // Manually trigger input change with the committed value so picker detection runs
    const val = e.currentTarget.value
    const cursor = e.currentTarget.selectionStart ?? val.length
    pendingInputRef.current = { value: val, cursor }
    const activeMention = findActiveMentionTrigger(val, cursor, agentNames)
    if (activeMention) {
      const filteredCount = activeMention.query.length > 0
        ? agents.filter(a => a.name.toLowerCase().includes(activeMention.query.toLowerCase())).length
        : agents.length
      openMentionPicker(activeMention.start, activeMention.query, filteredCount)
    } else {
      closeMentionPicker()
    }
  }, [openMentionPicker, closeMentionPicker, agentNames])

  // OPT001: Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (filteredAgents.length === 0) {
      setMentionHighlightIdx(0)
      return
    }
    setMentionHighlightIdx(current => Math.min(current, filteredAgents.length - 1))
  }, [filteredAgents.length])

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!mentionPickerOpen) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessageRef.current()
      }
      return
    }
    const count = filteredAgents.length
    if (count === 0) {
      if (e.key === 'Escape') { e.preventDefault(); closeMentionPicker() }
      else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        closeMentionPicker()
        sendMessageRef.current()
      }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionHighlightIdx(i => (i + 1) % count) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMentionHighlightIdx(i => (i - 1 + count) % count) }
    else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      if (filteredAgents[mentionHighlightIdx]) selectMentionAgent(filteredAgents[mentionHighlightIdx].name)
    } else if (e.key === 'Escape') { e.preventDefault(); closeMentionPicker() }
  }, [mentionPickerOpen, filteredAgents, mentionHighlightIdx, selectMentionAgent, closeMentionPicker])

  const sendPreparedContent = useCallback(async (rawContent: string) => {
    if (!roomId || sending) return
    const content = rawContent.trim()
    if (!content) return
    const agentNames = agents.map(a => a.name)
    // F013: no @ found — open mention picker at cursor, most-recent first
    if (extractUserMentionsFromAgents(content, agentNames).length === 0) {
      const cursor = textareaRef.current?.selectionStart ?? content.length
      setMentionStartIdx(cursor)
      setMentionQuery('')
      setMentionHighlightIdx(0)
      setMentionPickerOpen(true)
      setSendError('先选择要发给哪位专家：输入 @ 或点一个专家名称')
      setTimeout(() => setSendError(null), 4000)
      requestAnimationFrame(() => textareaRef.current?.focus())
      return
    }
    setMentionPickerOpen(false)
    // F013: @ is the single source of truth — derive toAgentId from mention text
    const mentionNames = extractUserMentionsFromAgents(content, agentNames)
    const targetName = mentionNames[0] ?? null
    const recipientId = targetName
      ? agents.find(a => a.name === targetName)?.id ?? null
      : null
    // F015 P1-fix: use ref to avoid stale closure — read streamingAgentIds live at call time
    const busyNow = streamingAgentIdsRef.current.size > 0 || agents.some(a => a.status === 'thinking' || a.status === 'waiting')
    if (busyNow) {
      setSendError('房间忙碌中，请稍后再试')
      setTimeout(() => setSendError(null), 4000)
      return
    }
    setSending(true)
    telemetry('ui:msg:send', {
      roomId, contentLength: content.length,
      contentSnippet: content.length > 80 ? content.slice(0, 80) + '…' : content,
      toAgentId: recipientId,
      toAgentName: targetName,
    })
    setUserInput('')
    try {
      const res = await fetch(`${API}/api/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, toAgentId: recipientId }),
      })
      if (!res.ok) {
        const err = await res.text()
        logError('msg:send_error', { roomId, status: res.status, error: err })
        // 409 means room became busy concurrently — show error
        if (res.status === 409) {
          setSending(false)
          setUserInput(content)
          setSendError('房间忙碌中，请稍后再试')
          setTimeout(() => setSendError(null), 4000)
          return
        }
        setUserInput(content)
        // F013: 400 means missing target; guide user to pick one
        if (res.status === 400) {
          setSendError('未找到指定专家，请检查 @ 后的名字')
        } else {
          setSendError('发送失败，请重试')
        }
        setTimeout(() => setSendError(null), 4000)
      }
    } catch (e) {
      logError('msg:send_error', { roomId, error: String(e) })
      setUserInput(content)
      setSendError('发送失败，请检查网络')
      setTimeout(() => setSendError(null), 4000)
    } finally {
      setSending(false)
    }
  }, [agents, roomId, sending])

  const restoreFailedInput = useCallback((content?: string) => {
    if (!content) return
    if (userInput.trim()) {
      setSendError('输入框里还有草稿，先处理当前内容再找回原提问')
      setTimeout(() => setSendError(null), 4000)
      textareaRef.current?.focus()
      return
    }
    setUserInput(content)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [userInput])

  const copyFailedPrompt = useCallback(async (content?: string) => {
    if (!content || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(content)
    } catch {
      setSendError('复制失败，请手动重试')
      setTimeout(() => setSendError(null), 3000)
    }
  }, [])

  // F015: drain the outgoing queue when room becomes idle.
  // Only sends ONE item per invocation; subsequent items are handled by
  // the next stream_end / room_error / poll idle trigger.
  const retryFailedMessage = useCallback(async (roomError: AgentRunErrorEvent) => {
    if (!roomError.originalUserContent) return
    if (userInput.trim()) {
      setSendError('输入框里还有草稿，先处理当前内容再重试')
      setTimeout(() => setSendError(null), 4000)
      textareaRef.current?.focus()
      return
    }
    await sendPreparedContent(roomError.originalUserContent)
  }, [sendPreparedContent, userInput])

  const handleSendMessage = useCallback(async () => {
    await sendPreparedContent(userInput)
  }, [sendPreparedContent, userInput])
  sendMessageRef.current = handleSendMessage

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
              <h1 className="text-lg font-bold text-ink hidden sm:block">AI 智囊团</h1>
            </div>
            <div className="flex items-center gap-2 md:gap-4">
              {/* F017: A2A depth switcher */}
              {roomId && (
                <DepthSwitcher
                  value={maxA2ADepth}
                  currentDepth={currentA2ADepth}
                  maxDepth={displayMax}
                  onChange={async (newDepth) => {
                    setMaxA2ADepth(newDepth)
                    try {
                      await fetch(`${API}/api/rooms/${roomId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ maxA2ADepth: newDepth }),
                      })
                    } catch {
                      // revert on error
                      setMaxA2ADepth(maxA2ADepth)
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
            </div>
          </div>

          {/* Message list */}
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6 scroll-smooth custom-scrollbar" ref={messagesContainerRef} onScroll={handleScroll}>
            {sortedMessages.map(msg => {
              const isUser = msg.agentRole === 'USER'
              const isSystem = msg.type === 'system'
              const isStreaming = !isUser && !isSystem && (msg.type === 'streaming' || msg.duration_ms === undefined)
              const runError = messageErrorMap[msg.id] ?? msg.runError
              const hasToolCalls = Boolean(msg.toolCalls?.length)
              const hasOutput = Boolean(msg.content.trim() || msg.thinking?.trim() || hasToolCalls)
              const agentColor = AGENT_COLORS[msg.agentName]?.bg || DEFAULT_AGENT_COLOR.bg
              const mentions = extractMentions(msg.content, agents.map(a => a.name))
              // Only show @点名 for agents that are actually in this room.
              // This prevents "phantom routing" where the agent references someone
              // not in the room (e.g. citing 【乔布斯】 from history but not routing to them).
              const validMentions = isUser
                ? [] // USER messages already show routing via toAgentId → toRecipient
                : mentions.filter(name => agents.some(a => a.name === name))
              const formattedTime = TIME_FORMATTER.format(new Date(msg.timestamp))

              if (isUser) {
                const toRecipient = msg.toAgentId ? agents.find(a => a.id === msg.toAgentId) : null
                const toColors = toRecipient ? AGENT_COLORS[toRecipient.name] || DEFAULT_AGENT_COLOR : null
                return (
                  <div key={msg.id} className="flex justify-end gap-3 mb-6 items-start">
                    <div className="w-full max-w-[85%] lg:max-w-[90%]">
                      <div className="flex justify-end items-center gap-2 mb-1.5">
                        <span className="text-[11px] text-ink-soft">
                          {formattedTime}
                        </span>
                        {isStreaming && <span className="text-[11px] text-accent animate-pulse font-medium">● 回答中</span>}
                        <span className="text-[12px] font-bold px-2 py-0.5 rounded-md bg-accent/20 text-accent">你</span>
                        {toRecipient && toColors && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ backgroundColor: `${toColors.bg}15`, color: toColors.bg }}>
                            <span>→</span>
                            <AgentAvatar name={toRecipient.name} color={toColors.bg} textColor={toColors.text} size={12} className="w-3 h-3 rounded-full" />
                            {toRecipient.name}
                          </span>
                        )}
                      </div>
                      <div className="rounded-2xl rounded-tr-sm px-4 py-3.5 bg-surface border border-line shadow-sm">
                        <BubbleErrorBoundary agentName={msg.agentName}>
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkBreaks]}
                            components={{
                              ...mdComponents,
                              p: ({ children }) => <p className="mb-2 last:mb-0 text-ink">{children}</p>,
                              a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 opacity-90 hover:opacity-100 text-accent">{children}</a>,
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </BubbleErrorBoundary>
                      </div>
                    </div>
                  </div>
                )
              }

              if (isSystem) {
                return (
                  <div key={msg.id} className="flex justify-center mb-3">
                    <div className="text-xs px-4 py-2 rounded-lg bg-surface/60 border border-line text-ink-soft max-w-[85%] text-center">
                      {msg.content}
                    </div>
                  </div>
                )
              }

              if (runError && !hasOutput) {
                return (
                  <div key={msg.id} className="group flex gap-3 mb-6 items-start">
                    <div className="w-8 h-8 rounded-full flex-shrink-0 shadow-sm mt-1 overflow-hidden">
                      <AgentAvatar name={msg.agentName} color={agentColor} size={32} className="w-full h-full" />
                    </div>
                    <div className="w-full max-w-[85%] lg:max-w-[90%]">
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="text-[13px] font-bold px-2 py-0.5 rounded-md" style={{ backgroundColor: `${agentColor}20`, color: agentColor }}>
                          {msg.agentName}
                        </span>
                        <span className="text-[11px] text-ink-soft">
                          {formattedTime}
                        </span>
                      </div>
                      <ErrorBubble
                        error={runError}
                        retryDisabled={sending}
                        restoreDisabled={Boolean(userInput.trim())}
                        onRetry={() => void retryFailedMessage(runError)}
                        onRestore={() => restoreFailedInput(runError.originalUserContent)}
                        onCopy={() => void copyFailedPrompt(runError.originalUserContent)}
                      />
                    </div>
                  </div>
                )
              }

              return (
                <div key={msg.id} className="group flex gap-3 mb-6 items-start">
                  <div className="w-8 h-8 rounded-full flex-shrink-0 shadow-sm mt-1 overflow-hidden">
                    <AgentAvatar name={msg.agentName} color={agentColor} size={32} className="w-full h-full" />
                  </div>
                  <div className="w-full max-w-[85%] lg:max-w-[90%]">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-[13px] font-bold px-2 py-0.5 rounded-md" style={{ backgroundColor: `${agentColor}20`, color: agentColor }}>
                        {msg.agentName}
                      </span>
                      <span className="text-[11px] text-ink-soft">
                        {formattedTime}
                      </span>
                      {isStreaming && (
                        <span className="text-[11px] text-emerald-500 font-medium flex items-center gap-1">
                          <span className="animate-pulse">● 回答中</span>
                        </span>
                      )}
                    </div>
                    <div className="rounded-2xl rounded-tl-sm px-4 py-3.5 bg-surface border border-line shadow-sm">
                      <BubbleErrorBoundary agentName={msg.agentName}>
                        <BubbleSection label="思考过程" icon="brain" content={msg.thinking ?? ''} isStreaming={isStreaming} agentColor={agentColor} />
                        {msg.toolCalls && msg.toolCalls.length > 0 && (
                          <div className="mb-3">
                            <div className="flex items-center gap-2 text-xs font-medium mb-2 px-2 py-1 rounded-lg" style={{ color: agentColor, backgroundColor: `${agentColor}10` }}>
                              <Wrench className="w-3 h-3" />
                              <span>工具调用</span>
                              <span className="text-[11px] opacity-50 font-normal tracking-wider">{msg.toolCalls.length} 次</span>
                            </div>
                            <div className="ml-2 pl-3.5 border-l-2 font-mono text-[13px] flex flex-wrap gap-2 items-center" style={{ borderColor: `${agentColor}40` }}>
                              {msg.toolCalls.map((tool, i) => {
                                const key = `${msg.id}-${tool.callId ?? i}`
                                const isHovered = hoveredToolCall === key
                                const isExpanded = expandedToolCall === key
                                return (
                                  <div key={tool.callId ?? i} className="relative">
                                    <span
                                      className="text-[11px] font-bold px-2 py-1 rounded cursor-help whitespace-nowrap"
                                      style={{ backgroundColor: `${agentColor}20`, color: agentColor }}
                                      onMouseEnter={() => {
                                        clearTimeout(hoverTimerRef.current)
                                        setHoveredToolCall(key)
                                      }}
                                      onMouseLeave={() => {
                                        hoverTimerRef.current = window.setTimeout(() => setHoveredToolCall(null), 100)
                                      }}
                                    >
                                      {tool.toolName}
                                    </span>
                                    {isHovered && (
                                      <div
                                        className="absolute z-[9999] left-0 top-full mt-1 w-80 bg-black/80 border border-line rounded-lg shadow-xl text-xs select-text backdrop-blur-sm"
                                        onMouseEnter={() => {
                                          clearTimeout(hoverTimerRef.current)
                                          setHoveredToolCall(key)
                                        }}
                                        onMouseLeave={() => setHoveredToolCall(null)}
                                      >
                                        <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                                          <span className="font-medium text-white/80">{tool.toolName}</span>
                                          <div className="flex gap-1">
                                            <button
                                              onClick={() => setExpandedToolCall(isExpanded ? null : key)}
                                              className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                                              title={isExpanded ? '收起' : '全屏'}
                                            >
                                              <Maximize2 className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                              onClick={() => navigator.clipboard.writeText(JSON.stringify(tool.toolInput, null, 2))}
                                              className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                                              title="复制全部"
                                            >
                                              <Copy className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                        </div>
                                        <pre className={`text-[11px] text-white/90 whitespace-pre-wrap break-all p-3 ${isExpanded ? 'max-h-none overflow-y-visible' : 'max-h-48 overflow-y-auto'}`}>{JSON.stringify(tool.toolInput, null, 2)}</pre>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                        <BubbleSection label="回复" icon="output" content={msg.content} isStreaming={isStreaming} agentColor={agentColor} />
                        {validMentions.length > 0 && (
                          <div className="flex items-center gap-1.5 text-xs font-medium flex-wrap" style={{ color: agentColor }}>
                            <span className="opacity-50 mr-0.5">@点名</span>
                            {validMentions.map(name => (
                              <span key={name} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ backgroundColor: `${agentColor}20`, color: agentColor }}>
                                {name}
                              </span>
                            ))}
                          </div>
                        )}
                      </BubbleErrorBoundary>
                      {runError && (
                        <div className="mt-3">
                          <ErrorBubble
                            error={runError}
                            retryDisabled={sending}
                            restoreDisabled={Boolean(userInput.trim())}
                            onRetry={() => void retryFailedMessage(runError)}
                            onRestore={() => restoreFailedInput(runError.originalUserContent)}
                            onCopy={() => void copyFailedPrompt(runError.originalUserContent)}
                          />
                        </div>
                      )}
                    </div>
                    {!isStreaming && msg.duration_ms && state === 'DONE' && (
                      <div className="mt-1.5 px-3 py-1.5 bg-surface border border-line rounded-lg text-[11px] text-ink-soft flex flex-wrap gap-x-4 gap-y-1 max-w-fit">
                        <span>⏱ {(msg.duration_ms / 1000).toFixed(1)}s</span>
                        {msg.total_cost_usd && <span>💰 ${msg.total_cost_usd.toFixed(4)}</span>}
                        {msg.input_tokens && <span>📥 {msg.input_tokens}</span>}
                        {msg.output_tokens && <span>📤 {msg.output_tokens}</span>}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {orphanErrors.map(roomError => (
              <div key={roomError.traceId} className="mb-6">
                <ErrorBubble
                  error={roomError}
                  retryDisabled={sending}
                  restoreDisabled={Boolean(userInput.trim())}
                  onRetry={() => void retryFailedMessage(roomError)}
                  onRestore={() => restoreFailedInput(roomError.originalUserContent)}
                  onCopy={() => void copyFailedPrompt(roomError.originalUserContent)}
                />
              </div>
            ))}

            {messages.length === 0 && roomId && (
              <div className="flex flex-col items-center justify-center min-h-44 text-center text-ink-soft gap-3 px-4">
                <BrainCircuit className="w-8 h-8 opacity-70" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-ink">从 @一位专家 开始</p>
                  <p className="text-xs max-w-md leading-relaxed">
                    每条消息都需要明确收件人。软件开发任务建议先找架构师拆需求和计划，再进入实现与 review。
                  </p>
                </div>
                {agents.length > 0 && (
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    {agents.slice(0, 4).map(agent => (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => prefillMention(agent)}
                        className="px-3 py-1.5 rounded-lg border border-line bg-surface text-xs font-medium text-ink hover:border-accent hover:text-accent transition-colors"
                      >
                        @{agent.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div ref={messagesEndRef} />
            {showScrollBtn && (
              <button
                onClick={handleScrollToBottom}
                className="sticky bottom-4 left-1/2 -translate-x-1/2 bg-accent text-white px-4 py-2 rounded-full text-xs font-medium shadow-lg hover:bg-accent-deep transition-colors flex items-center gap-1.5 z-10"
              >
                <ChevronDown className="w-3.5 h-3.5" /> 回到底部
              </button>
            )}
          </div>

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
              <div className="flex flex-col gap-2 relative">
                {sendError && <div className="text-xs text-red-500 px-1">{sendError}</div>}
                {mentionPickerOpen && (
                  <MentionPicker
                    agents={filteredAgents}
                    highlightIndex={mentionHighlightIdx}
                    onSelect={selectMentionAgent}
                    onHighlight={setMentionHighlightIdx}
                  />
                )}
                <div className="flex gap-3">
                  <textarea
                    ref={textareaRef}
                    className="app-islands-input flex-1 bg-surface border border-line rounded-xl px-4 py-3 text-[14px] text-ink placeholder:text-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent resize-none min-h-12 max-h-48 leading-relaxed"
                    placeholder="输入消息，或 @mention 专家…"
                    value={userInput}
                    onChange={handleInputChange}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    onKeyDown={handleInputKeyDown}
                    disabled={sending}
                    aria-label="输入消息"
                  />
                  <button
                    type="button"
                    className="app-islands-item bg-accent text-white font-semibold px-5 py-3 rounded-xl hover:bg-accent-deep transition-all disabled:opacity-50 text-[14px] shadow-sm self-end"
                    onClick={handleSendMessage}
                    disabled={sending || !userInput.trim()}
                  >
                    {sending ? '发送中…' : '发送'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Right sidebar: Agents (desktop) */}
        <AgentPanel
          roomId={roomId}
          agents={agents}
          messages={messages}
          state={state}
        />

      </div>
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} initialTab={settingsInitialTab} />
      {/* AC-4: Agent Drawer — mobile only */}
      {agentDrawerOpen && (
        <div className="fixed inset-0 z-[200] flex">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-xl -webkit-backdrop-blur-xl" onClick={() => setAgentDrawerOpen(false)} />
          <div className="relative z-10 ml-auto w-[280px] h-full app-window-shell border-l flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-4 py-4 border-b border-white/[0.06]">
              <h2 className="text-[15px] font-bold text-ink">参与 Agent</h2>
              <button
                type="button"
                onClick={() => setAgentDrawerOpen(false)}
                className="p-1.5 text-ink-soft hover:text-ink hover:bg-white/[0.06] rounded-lg transition-colors"
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
              {agents.map(agent => (
                <div key={agent.id} className="app-window-surface rounded-xl p-3">
                  <div className="flex items-center gap-3 mb-2.5">
                    <AgentAvatar
                      name={agent.name}
                      color={(AGENT_COLORS[agent.name] || DEFAULT_AGENT_COLOR).bg}
                      textColor={(AGENT_COLORS[agent.name] || DEFAULT_AGENT_COLOR).text}
                      size={32}
                      className="w-8 h-8 rounded-full flex-shrink-0 shadow-sm overflow-hidden"
                    />
                    <div>
                      <p className="text-[14px] font-bold leading-none mb-1 text-ink">{agent.name}</p>
                      <p className="text-[11px] text-ink-soft leading-none">
                        {agent.role === 'MANAGER' ? '主持人' : agent.domainLabel}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md max-w-fit" style={{background:"rgba(255,255,255,0.025)"}}>
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        agent.status === 'thinking' || agent.status === 'waiting'
                          ? 'bg-emerald-500 animate-pulse shadow-[0_0_4px_rgba(16,185,129,0.5)]'
                          : 'bg-ink-soft/40'
                      }`}
                    />
                    <span className="text-[11px] font-medium text-ink-soft">
                      {agent.status === 'thinking' ? '工作中' : agent.status === 'waiting' ? '等待中' : '空闲'}
                    </span>
                  </div>
                </div>
              ))}
              {agents.length === 0 && (
                <p className="text-[12px] text-ink-soft text-center mt-6">选择讨论室后显示参与者</p>
              )}
            </div>
          </div>
        </div>
      )}
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
