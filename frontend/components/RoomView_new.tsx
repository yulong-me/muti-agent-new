'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import ReactMarkdown from 'react-markdown'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:7001'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { io, type Socket } from 'socket.io-client'
import {
  Menu, X, Plus, Download, MessageSquare,
  ChevronDown, ChevronUp, BrainCircuit, Settings, Moon, Sun, UserPlus,
} from 'lucide-react'
import {
  AGENT_COLORS, DEFAULT_AGENT_COLOR, STATE_LABELS,
  mdComponents, extractMentions,
  type Agent, type Message, type DiscussionState,
} from '../lib/agents'
import { debug, error as logError, getDebugLog, telemetry, setRoomId } from '../lib/logger'
import CreateRoomModal from './CreateRoomModal'
import SettingsModal from './SettingsModal'
import MentionPicker from './MentionPicker'
import { BubbleSection } from './BubbleSection'
import { RoomListSidebarDesktop, RoomListSidebarMobile } from './RoomListSidebar'
import { AgentPanel } from './AgentPanel'
import MentionQueue, { type QueuedMention } from './MentionQueue'
import { AgentInviteDrawer } from './AgentInviteDrawer'

interface RoomViewProps { roomId?: string; defaultCreateOpen?: boolean }

export default function RoomView_new({ roomId, defaultCreateOpen = false }: RoomViewProps) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(defaultCreateOpen)
  const router = useRouter()
  const [state, setState] = useState<DiscussionState>('RUNNING')
  const [messages, setMessages] = useState<Message[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [report, setReport] = useState<string>('')
  const [rooms, setRooms] = useState<{ id: string; topic: string; createdAt: number; state: DiscussionState }[]>([])
  const [roomsAgentsMap, setRoomsAgentsMap] = useState<Record<string, Agent[]>>({})
  const [roomsLastToAgentMap, setRoomsLastToAgentMap] = useState<Record<string, string | undefined>>({})
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<'agent' | 'provider'>('agent')
  const [debugOpen, setDebugOpen] = useState(false)
  const [debugLogs, setDebugLogs] = useState<{ ts: string; event: string; meta?: Record<string, unknown> }[]>([])
  const [userInput, setUserInput] = useState('')
  const [sending, setSending] = useState(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(null)
  const [mentionQueue, setMentionQueue] = useState<QueuedMention[]>([])
  const [streamingAgentIds, setStreamingAgentIds] = useState<Set<string>>(new Set())

  // @mention picker state
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStartIdx, setMentionStartIdx] = useState(-1)
  const [mentionHighlightIdx, setMentionHighlightIdx] = useState(0)
  const [mounted, setMounted] = useState(false)

  const { theme, setTheme } = useTheme()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollStateRef = useRef<{ state: DiscussionState; agents: Agent[] }>({ state: 'RUNNING' as DiscussionState, agents: [] as Agent[] })
  const streamingMessagesRef = useRef<Map<string, Message>>(new Map())
  const streamingThinkingRef = useRef<Map<string, string>>(new Map())

  // F007: invite drawer
  const [showInviteDrawer, setShowInviteDrawer] = useState(false)
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

  // Hydration fix for next-themes
  useEffect(() => setMounted(true), [])

  // Sync debug logs from logger store to state every 500ms
  useEffect(() => {
    const sync = () => setDebugLogs(getDebugLog())
    sync()
    const interval = setInterval(sync, 500)
    return () => clearInterval(interval)
  }, [])

  // F0043: Set roomId in logger so frontend logs get persisted to logs/{roomId}.log
  useEffect(() => { setRoomId(roomId ?? null) }, [roomId])
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
      // F0050: 用户消息含 @mention → 加入队列
      if (msg.agentRole === 'USER' && msg.content) {
        const names = extractMentions(msg.content)
        setMentionQueue(prev => {
          const existingIds = new Set(prev.map(m => m.agentId))
          const newEntries: QueuedMention[] = []
          for (const name of names) {
            const agent = agentsRef.current.find(a => a.name === name)
            if (agent && !existingIds.has(agent.id)) {
              existingIds.add(agent.id)
              newEntries.push({ agentId: agent.id, agentName: agent.name, mentionedBy: 'user', status: 'queued' })
            }
          }
          return [...prev, ...newEntries]
        })
      }
    })

    socket.on('stream_start', (data: any) => {
      if (data.roomId !== roomId) return
      streamingCountRef.current++
      streamingAgentIdsRef.current.add(data.agentId)
      setStreamingAgentIds(new Set(streamingAgentIdsRef.current))
      streamingThinkingRef.current.set(data.agentId, '')
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

    socket.on('stream_end', (data: any) => {
      if (data.roomId !== roomId) return
      streamingCountRef.current = Math.max(0, streamingCountRef.current - 1)
      streamingAgentIdsRef.current.delete(data.agentId)
      setStreamingAgentIds(new Set(streamingAgentIdsRef.current))
      const msg = streamingMessagesRef.current.get(data.agentId)
      telemetry('ui:ai:end', { roomId, agentName: msg?.agentName ?? '', duration_ms: data.duration_ms, total_cost_usd: data.total_cost_usd, output_tokens: data.output_tokens })
      telemetry('socket:stream_end', { id: data.id, duration_ms: data.duration_ms })
      // F0050: Manager 响应结束，解析其内容中的 @mention 加入队列
      if (msg?.agentRole === 'MANAGER' && msg.content) {
        const names = extractMentions(msg.content)
        setMentionQueue(prev => {
          const existingIds = new Set(prev.map(m => m.agentId))
          const newEntries: QueuedMention[] = []
          for (const name of names) {
            const agent = agentsRef.current.find(a => a.name === name)
            if (agent && !existingIds.has(agent.id)) {
              existingIds.add(agent.id)
              newEntries.push({ agentId: agent.id, agentName: agent.name, mentionedBy: 'manager', status: 'queued' })
            }
          }
          return [...prev, ...newEntries]
        })
      }
      // F0050: done 状态 3s 后移除
      if (msg) {
        setMentionQueue(prev => {
          const alreadyDone = prev.some(m => m.agentId === data.agentId && m.status === 'done')
          if (!alreadyDone) {
            setTimeout(() => {
              setMentionQueue(q => q.filter(m => m.agentId !== data.agentId))
            }, 3000)
            return prev.map(m => m.agentId === data.agentId ? { ...m, status: 'done' as const } : m)
          }
          return prev
        })
      }
      if (msg) {
        msg.duration_ms = data.duration_ms
        msg.total_cost_usd = data.total_cost_usd
        msg.input_tokens = data.input_tokens
        msg.output_tokens = data.output_tokens
        const accumulatedThinking = streamingThinkingRef.current.get(data.agentId)
        setMessages(prev => prev.map(m => m.id === data.id ? { ...msg, thinking: accumulatedThinking ?? msg.thinking, type: m.type !== 'streaming' ? m.type : 'statement' } : m))
      }
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
  useEffect(() => {
    telemetry('room:list:load')
    fetch(`${API}/api/rooms`).then(r => r.ok ? r.json() : []).then((data: any[]) => {
      setRooms(data.map((room: any) => ({ id: room.id, topic: room.topic, createdAt: room.createdAt, state: room.state as DiscussionState })))
      const agentsMap: Record<string, Agent[]> = {}
      const toAgentMap: Record<string, string | undefined> = {}
      for (const room of data) {
        agentsMap[room.id] = room.agents || []
        const lastUserMsg = [...(room.messages || [])].reverse().find((m: Message) => m.agentRole === 'USER')
        toAgentMap[room.id] = lastUserMsg?.toAgentId
      }
      setRoomsAgentsMap(agentsMap)
      setRoomsLastToAgentMap(toAgentMap)
    }).catch(e => logError('room:list_error', { error: String(e) }))
  }, [])

  // ─── Polling ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return
    const poll = async () => {
      try {
        const res = await fetch(`${API}/api/rooms/${roomId}/messages`)
        if (!res.ok) return
        const data = await res.json()
        const newState = data.state || 'RUNNING'
        const newAgents = data.agents || []
        pollStateRef.current = { state: newState, agents: newAgents }
        setState(newState)
        setAgents(newAgents)
        setReport(data.report || '')
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id))
          const merged = [...prev, ...(data.messages || []).filter((m: Message) => !existingIds.has(m.id))]
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

  // Default recipient: MANAGER
  useEffect(() => {
    if (!roomId || agents.length === 0) return
    const manager = agents.find(a => a.role === 'MANAGER')
    if (manager) setSelectedRecipientId(prev => prev ?? manager.id)
  }, [roomId, agents])

  // ─── @mention helpers ────────────────────────────────────────────────────────
  const filteredAgents = mentionQuery
    ? agents.filter(a => a.name.toLowerCase().includes(mentionQuery.toLowerCase()))
    : agents

  const openMentionPicker = useCallback((mentionAtIdx: number, query: string) => {
    setMentionPickerOpen(true)
    setMentionQuery(query)
    setMentionStartIdx(mentionAtIdx)
    setMentionHighlightIdx(0)
  }, [])

  const closeMentionPicker = useCallback(() => {
    setMentionPickerOpen(false)
    setMentionQuery('')
    setMentionStartIdx(-1)
  }, [])

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
    const before = userInput.slice(0, mentionStartIdx)
    const after = userInput.slice(cursor)
    const newInput = before + '@' + agentName + ' ' + after
    setUserInput(newInput)
    closeMentionPicker()
    const target = agents.find(a => a.name === agentName)
    if (target) {
      setSelectedRecipientId(target.id)
      telemetry('ui:mention:pick', { roomId, agentName, agentId: target.id, agentRole: target.role })
    }
    setTimeout(() => {
      const newPos = mentionStartIdx + agentName.length + 2
      ta.focus()
      ta.setSelectionRange(newPos, newPos)
    }, 0)
  }, [userInput, mentionStartIdx, closeMentionPicker, agents])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    const cursor = e.target.selectionStart ?? val.length
    setUserInput(val)
    const textBefore = val.slice(0, cursor)
    const lineStart = textBefore.lastIndexOf('\n') + 1
    const textOnLine = textBefore.slice(lineStart)
    const lastAt = textOnLine.lastIndexOf('@')
    if (lastAt >= 0) {
      const query = textOnLine.slice(lastAt + 1)
      const atPos = lineStart + lastAt
      const charBefore = atPos > 0 ? val[atPos - 1] : ''
      if (charBefore === '' || charBefore === ' ' || charBefore === '\n') {
        openMentionPicker(atPos, query)
        return
      }
    }
    closeMentionPicker()
  }, [openMentionPicker, closeMentionPicker])

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
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionHighlightIdx(i => (i + 1) % count) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMentionHighlightIdx(i => (i - 1 + count) % count) }
    else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      if (filteredAgents[mentionHighlightIdx]) selectMentionAgent(filteredAgents[mentionHighlightIdx].name)
    } else if (e.key === 'Escape') { e.preventDefault(); closeMentionPicker() }
  }, [mentionPickerOpen, filteredAgents, mentionHighlightIdx, selectMentionAgent, closeMentionPicker])

  const handleSendMessage = async () => {
    if (!roomId || !userInput.trim() || sending) return
    setMentionPickerOpen(false)
    setSending(true)
    const content = userInput.trim()
    const mentionMatch = content.match(/(?:^|\s)[@＠]([^\s@＠]{1,40})/)
    const mentionName = mentionMatch?.[1]?.trim()
    const mentionedAgent = mentionName ? agents.find(a => a.name.toLowerCase() === mentionName.toLowerCase()) : undefined
    const managerId = agents.find(a => a.role === 'MANAGER')?.id ?? null
    const recipientId = mentionedAgent?.id ?? selectedRecipientId ?? managerId
    const recipientName = agents.find(a => a.id === recipientId)?.name ?? '主持人'
    telemetry('ui:msg:send', {
      roomId, contentLength: content.length,
      contentSnippet: content.length > 80 ? content.slice(0, 80) + '…' : content,
      toAgentId: recipientId, toAgentName: recipientName,
      toAgentRole: mentionedAgent ? 'WORKER' : (recipientId === managerId ? 'MANAGER' : 'WORKER'),
      mentionText: mentionName ?? null,
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
        setUserInput(content)
        setSendError('发送失败，请重试')
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
  }
  sendMessageRef.current = handleSendMessage

  const toggleMobileMenu = () => setMobileMenuOpen(o => !o)

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <CreateRoomModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
      <div className="h-[100dvh] flex bg-bg overflow-hidden text-ink font-sans">

        {/* Left sidebar */}
        <RoomListSidebarDesktop
          rooms={rooms}
          currentRoomId={roomId}
          roomsAgentsMap={roomsAgentsMap}
          roomsLastToAgentMap={roomsLastToAgentMap}
          onNewRoom={() => setIsCreateModalOpen(true)}
          onSelectRoom={id => router.push(`/room/${id}`)}
          onDeleteRoom={async (id) => {
            const res = await fetch(`${API}/api/rooms/${id}/archive`, { method: 'PATCH' })
            if (!res.ok) return
            if (id === roomId) router.push('/')
            else setRooms(rooms => rooms.filter(r => r.id !== id))
          }}
        />

        {/* Mobile menu overlay */}
        <RoomListSidebarMobile
          rooms={rooms}
          currentRoomId={roomId}
          roomsAgentsMap={roomsAgentsMap}
          roomsLastToAgentMap={roomsLastToAgentMap}
          onNewRoom={() => setIsCreateModalOpen(true)}
          onSelectRoom={id => router.push(`/room/${id}`)}
          onDeleteRoom={async (id) => {
            const res = await fetch(`${API}/api/rooms/${id}/archive`, { method: 'PATCH' })
            if (!res.ok) return
            if (id === roomId) router.push('/')
            else setRooms(rooms => rooms.filter(r => r.id !== id))
          }}
          mobileMenuOpen={mobileMenuOpen}
          onToggleMobileMenu={toggleMobileMenu}
          onCloseMobileMenu={() => setMobileMenuOpen(false)}
        />

        {/* Center: Main Discussion */}
        <div className="flex-1 flex flex-col relative min-w-0">
          {/* Main Header */}
          <div className="h-[60px] md:h-16 bg-nav-bg backdrop-blur-xl border-b border-line px-4 md:px-6 flex items-center justify-between sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <button className="md:hidden p-2 -ml-2 text-ink-soft hover:text-ink" onClick={toggleMobileMenu}>
                <Menu className="w-5 h-5" />
              </button>
              <h1 className="text-lg font-bold text-ink hidden sm:block">AI 智囊团</h1>
            </div>
            <div className="flex items-center gap-2 md:gap-4">
              {roomId && (
                <div className="hidden sm:flex items-center gap-2 mr-2">
                  <span className="px-2.5 py-1 bg-surface-muted rounded-full text-[11px] font-semibold text-ink-soft uppercase tracking-wide">状态</span>
                  <span className="px-3 py-1 bg-accent/10 border border-accent/20 rounded-full text-xs font-bold text-accent">{STATE_LABELS[state]}</span>
                </div>
              )}
              <button
                onClick={() => { setSettingsInitialTab('agent'); setSettingsOpen(true) }}
                className="p-2 text-ink-soft hover:text-ink transition-colors"
                title="设置"
              >
                <Settings className="w-5 h-5" />
              </button>
              {mounted && (
                <button
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="p-2 text-ink-soft hover:text-ink transition-colors"
                  title={theme === 'dark' ? '切换亮色模式' : '切换暗色模式'}
                >
                  {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </button>
              )}
              <button
                onClick={() => setShowInviteDrawer(true)}
                className="p-2 text-ink-soft hover:text-accent transition-colors"
                title="邀请专家入群"
>
                <UserPlus className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Message list */}
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6 scroll-smooth custom-scrollbar" ref={messagesContainerRef} onScroll={handleScroll}>
            {([...messages].sort((a, b) => a.timestamp - b.timestamp)).map(msg => {
              const isUser = msg.agentRole === 'USER'
              const isSystem = msg.type === 'system'
              const isStreaming = !isUser && !isSystem && (msg.type === 'streaming' || msg.duration_ms === undefined)
              const agentColor = AGENT_COLORS[msg.agentName]?.bg || DEFAULT_AGENT_COLOR.bg
              const agentAvatar = AGENT_COLORS[msg.agentName]?.avatar || DEFAULT_AGENT_COLOR.avatar

              if (isUser) {
                const toRecipient = msg.toAgentId ? agents.find(a => a.id === msg.toAgentId) : null
                const toColors = toRecipient ? AGENT_COLORS[toRecipient.name] || DEFAULT_AGENT_COLOR : null
                return (
                  <div key={msg.id} className="flex justify-end gap-3 mb-6 items-start">
                    <div className="w-full max-w-[85%] md:max-w-[70%]">
                      <div className="flex justify-end items-center gap-2 mb-1.5">
                        <span className="text-[11px] text-ink-soft">
                          {new Date(msg.timestamp).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isStreaming && <span className="text-[11px] text-accent animate-pulse font-medium">● 回答中</span>}
                        <span className="text-[12px] font-bold px-2 py-0.5 rounded-md bg-accent/20 text-accent">你</span>
                        {toRecipient && toColors && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ backgroundColor: `${toColors.bg}15`, color: toColors.bg }}>
                            <span>→</span>
                            <img src={toColors.avatar} alt="" className="w-3 h-3 rounded-full" />
                            {toRecipient.name}
                          </span>
                        )}
                      </div>
                      <div className="rounded-2xl rounded-tr-sm px-4 py-3.5 bg-surface border border-line shadow-sm">
                        <div className="text-[14px] break-words leading-relaxed text-ink">
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
                        </div>
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

              return (
                <div key={msg.id} className="group flex gap-3 mb-6 items-start">
                  <div className="w-8 h-8 rounded-full flex-shrink-0 shadow-sm mt-1 overflow-hidden">
                    <img src={agentAvatar} alt={msg.agentName} className="w-full h-full" />
                  </div>
                  <div className="w-full max-w-[85%] md:max-w-[70%]">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-[13px] font-bold px-2 py-0.5 rounded-md" style={{ backgroundColor: `${agentColor}20`, color: agentColor }}>
                        {msg.agentName}
                      </span>
                      <span className="text-[11px] text-ink-soft">
                        {new Date(msg.timestamp).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {isStreaming && (
                        <span className="text-[11px] text-emerald-500 font-medium flex items-center gap-1">
                          <span className="animate-pulse">● 回答中</span>
                        </span>
                      )}
                    </div>
                    <div className="rounded-2xl rounded-tl-sm px-4 py-3.5 bg-surface border border-line shadow-sm">
                      <BubbleSection label="思考过程" icon="brain" content={msg.thinking ?? ''} isStreaming={isStreaming} agentColor={agentColor} />
                      <BubbleSection label="回复" icon="output" content={msg.content} isStreaming={isStreaming} agentColor={agentColor} />
                      {extractMentions(msg.content).length > 0 && (
                        <div className="flex items-center gap-1.5 text-xs font-medium flex-wrap" style={{ color: agentColor }}>
                          <span className="opacity-50 mr-0.5">@点名</span>
                          {extractMentions(msg.content).map(name => (
                            <span key={name} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ backgroundColor: `${agentColor}20`, color: agentColor }}>
                              {name}
                            </span>
                          ))}
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

            {messages.length === 0 && roomId && (
              <div className="flex flex-col items-center justify-center h-40 text-ink-soft gap-3 opacity-60">
                <BrainCircuit className="w-8 h-8" />
                <p className="text-sm">输入消息开始讨论，或 @mention 专家</p>
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
            {/* F0050: 发言队列 — 输入框上层 */}
            {roomId && state !== 'DONE' && (
              <MentionQueue
                queue={mentionQueue}
                agents={agents}
                streamingAgentIds={streamingAgentIds}
              />
            )}
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
                    agents={agents}
                    query={mentionQuery}
                    highlightIndex={mentionHighlightIdx}
                    onSelect={selectMentionAgent}
                    onHighlight={setMentionHighlightIdx}
                  />
                )}
                <div className="flex gap-3">
                  <textarea
                    ref={textareaRef}
                    className="flex-1 bg-surface border border-line rounded-xl px-4 py-3 text-[14px] text-ink placeholder:text-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all resize-none h-12 leading-relaxed"
                    placeholder="输入消息，或 @mention 专家..."
                    value={userInput}
                    onChange={handleInputChange}
                    onKeyDown={handleInputKeyDown}
                    disabled={sending}
                  />
                  <button
                    type="button"
                    className="bg-accent text-white font-semibold px-5 py-3 rounded-xl hover:bg-accent-deep transition-all disabled:opacity-50 text-[14px] shadow-sm self-end"
                    onClick={handleSendMessage}
                    disabled={sending || !userInput.trim()}
                  >
                    {sending ? '发送中...' : '发送'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Right sidebar: Agents + Debug */}
        <AgentPanel
          roomId={roomId}
          agents={agents}
          messages={messages}
          state={state}
          debugOpen={debugOpen}
          debugLogs={debugLogs}
          onToggleDebug={() => setDebugOpen(o => !o)}
        />

      </div>
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} initialTab={settingsInitialTab} />
      {showInviteDrawer && roomId && (
        <AgentInviteDrawer
          roomId={roomId}
          currentAgentIds={agents.map(a => a.configId ?? '')}
          onClose={() => setShowInviteDrawer(false)}
          onInvited={() => {}}
        />
      )}
    </>
  )
}
