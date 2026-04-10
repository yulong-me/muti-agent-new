'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { io, type Socket } from 'socket.io-client'
import CreateRoomModal from '@/components/CreateRoomModal'

// ── BubbleSection: a single collapsible section within a message bubble ───────
// States: collapsed (1 line) | expanded (full)
// Props: label, icon, content, isStreaming, agentColor
function BubbleSection({
  label,
  icon,          // 'brain' | 'output'
  content,
  isStreaming,
  agentColor,
}: {
  label: string
  icon: 'brain' | 'output'
  content: string
  isStreaming: boolean
  agentColor: string
}) {
  const [expanded, setExpanded] = useState(false)
  const lineCount = content.split('\n').length
  const isEmpty = !content.trim()

  const iconEl = icon === 'brain' ? (
    // Brain / lightbulb icon
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
    </svg>
  ) : (
    // Chat bubble icon
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
      <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
    </svg>
  )

  const expandIcon = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={`w-3 h-3 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`}
    >
      <path fillRule="evenodd" d="M4.646 1.646a.5.5 0 01.708 0l6 6a.5.5 0 010 .708l-6 6a.5.5 0 01-.708-.708L10.293 8 4.646 2.354a.5.5 0 010-.708z" clipRule="evenodd" />
    </svg>
  )

  const statusText = isEmpty
    ? '等待输出...'
    : isStreaming
    ? `${lineCount} 行 · 输出中...`
    : `${lineCount} 行`

  const streamingCursor = isStreaming ? (
    <span className="inline-block w-1 h-3 bg-current animate-pulse ml-1 rounded-sm opacity-60 align-middle" />
  ) : null

  if (isEmpty && !isStreaming) return null

  return (
    <div className={icon === 'brain' ? 'mb-2' : ''}>
      {/* Section header — always visible */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1.5 text-xs font-medium w-full group/section"
        style={{ color: agentColor }}
        aria-label={`${expanded ? '收起' : '展开'}${label}`}
      >
        {iconEl}
        <span className="opacity-80">{label}</span>
        <span className="text-xs opacity-50 ml-0.5">{statusText}</span>
        {streamingCursor}
        <span className="ml-auto opacity-40 group-hover/section:opacity-80">
          {expandIcon}
        </span>
      </button>

      {/* Section body */}
      {expanded && (
        <div
          className={`mt-1.5 ml-1 pl-3 border-l-2 rounded text-sm leading-relaxed ${
            icon === 'brain'
              ? 'text-xs italic font-mono text-apple-secondary bg-gray-50 py-2 pr-2'
              : 'text-apple-text'
          }`}
          style={{ borderColor: `${agentColor}40` }}
        >
          {icon === 'output' ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks]}
              components={mdComponents}
            >{content}</ReactMarkdown>
          ) : (
            <span className="whitespace-pre-wrap">{content}</span>
          )}
        </div>
      )}
    </div>
  )
}

// ── ExpandableText: icon button to expand / collapse long content ──────────────
// (kept for compatibility — not used in the new two-section bubble design)
// ── Markdown components matching cat-cafe style ──────────────────────────────
function ExpandableText({
  text,
  clampClass = 'line-clamp-3',
  className = '',
}: {
  text: string
  clampClass?: string
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <span>
      <span className={expanded ? 'whitespace-normal' : clampClass}>
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={mdComponents}>{text}</ReactMarkdown>
      </span>
      {/* Icon button for expand/collapse */}
      <button
        className={`mt-1 inline-flex items-center gap-1 text-apple-primary/60 hover:text-apple-primary transition-colors ${className}`}
        onClick={() => setExpanded(e => !e)}
        aria-label={expanded ? '收起' : '展开'}
      >
        {expanded ? (
          // chevron up
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
        ) : (
          // chevron down
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        )}
      </button>
    </span>
  )
}

// ── Markdown components matching cat-cafe style ──────────────────────────────
const mdComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold mb-2 mt-3 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-2 first:mt-0">{children}</h3>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-gray-300 pl-3 my-2 italic opacity-80">{children}</blockquote>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline break-all">{children}</a>,
  pre: ({ children }) => <pre className="bg-gray-900 text-gray-100 rounded-lg p-3 overflow-x-auto text-xs font-mono my-2">{children}</pre>,
  code: ({ children }) => <code className="bg-gray-100 rounded px-1 py-0.5 text-xs font-mono">{children}</code>,
}

// ── Telemetry ────────────────────────────────────────────────────────────────
function telemetry(event: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString()
  const prefix = `[${ts}] [FE]`
  if (meta) {
    console.log(`${prefix} ${event} ${JSON.stringify(meta)}`)
  } else {
    console.log(`${prefix} ${event}`)
  }
}

type DiscussionState = 'INIT' | 'RESEARCH' | 'DEBATE' | 'CONVERGING' | 'DONE'
type AgentRole = 'HOST' | 'AGENT'

interface Agent {
  id: string
  role: AgentRole
  name: string
  domainLabel: string
  status: 'idle' | 'thinking' | 'waiting' | 'done'
}

interface Message {
  id: string
  agentRole: AgentRole | 'USER'
  agentName: string
  content: string
  timestamp: number
  type: string
  /** Reasoning/thinking content (populated after streaming completes) */
  thinking?: string
  /** Streaming timing (populated after streaming completes) */
  duration_ms?: number
  total_cost_usd?: number
  input_tokens?: number
  output_tokens?: number
  /** Temporary ID used during streaming */
  tempMsgId?: string
}

const STATE_LABELS: Record<DiscussionState, string> = {
  INIT: '初始化',
  RESEARCH: '调查中',
  DEBATE: '辩论中',
  CONVERGING: '收敛中',
  DONE: '已完成',
}

const AGENT_COLORS: Record<string, { bg: string; text: string }> = {
  主持人: { bg: '#0071E3', text: '#FFFFFF' },
  司马迁: { bg: '#8B4513', text: '#FFFFFF' },
  诸葛亮: { bg: '#2E8B57', text: '#FFFFFF' },
  李世民: { bg: '#B8860B', text: '#FFFFFF' },
  孔子: { bg: '#556B2F', text: '#FFFFFF' },
  曹操: { bg: '#8B0000', text: '#FFFFFF' },
  马斯克: { bg: '#007AFF', text: '#FFFFFF' },
  乔布斯: { bg: '#5856D6', text: '#FFFFFF' },
  爱因斯坦: { bg: '#1E90FF', text: '#FFFFFF' },
  图灵: { bg: '#4169E1', text: '#FFFFFF' },
  马云: { bg: '#FF9500', text: '#FFFFFF' },
}

const DEFAULT_AGENT_COLOR = { bg: '#34C759', text: '#FFFFFF' }

const STATE_BUTTONS: Partial<Record<DiscussionState, { label: string; choice?: string }[]>> = {
  INIT: [{ label: '确认议题方向', choice: 'confirm' }],
  RESEARCH: [
    { label: '进入辩论', choice: 'debate' },
    { label: '继续调查', choice: 'research' },
  ],
  DEBATE: [
    { label: '进入收敛', choice: 'converge' },
    { label: '继续辩论', choice: 'continue' },
  ],
  CONVERGING: [
    { label: '确认收敛', choice: 'converge' },
    { label: '继续辩论', choice: 'debate' },
    { label: '继续调查', choice: 'research' },
  ],
}

interface RoomViewProps {
  roomId?: string
  defaultCreateOpen?: boolean
}

export default function RoomView({ roomId, defaultCreateOpen = false }: RoomViewProps) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(defaultCreateOpen)
  const router = useRouter()
  const [state, setState] = useState<DiscussionState>('INIT')
  const [messages, setMessages] = useState<Message[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [report, setReport] = useState<string>('')
  const [rooms, setRooms] = useState<{ id: string; topic: string; createdAt: number }[]>([])
  const [advancing, setAdvancing] = useState(false)
  const [advancingChoice, setAdvancingChoice] = useState<string | undefined>(undefined)
  const [started, setStarted] = useState(false)
  const startRequestedRef = useRef(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollStateRef = useRef<{ state: DiscussionState; agents: Agent[] }>({ state: 'INIT' as DiscussionState, agents: [] as Agent[] })

  // Streaming state: temp messages that are currently streaming
  const streamingMessagesRef = useRef<Map<string, Message>>(new Map())
  // Streaming thinking content per agent (accumulated in real-time)
  const streamingThinkingRef = useRef<Map<string, string>>(new Map())

  // Track if user has scrolled away from bottom (to avoid fighting their scroll during streaming)
  const userScrolledRef = useRef(false)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  // Count of currently active streaming messages (to know when streaming is done)
  const streamingCountRef = useRef(0)

  const scrollToBottom = () => {
    if (userScrolledRef.current) return
    // During active streaming, use instant scroll (no smooth jitter); smooth only when idle
    const behavior = streamingCountRef.current > 0 ? 'instant' : 'smooth'
    messagesEndRef.current?.scrollIntoView({ behavior })
  }

  const handleScroll = () => {
    const el = messagesContainerRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    userScrolledRef.current = distFromBottom > 100
  }

  useEffect(() => { scrollToBottom() }, [messages])

  // ── Socket.IO ───────────────────────────────────────────────────────────────
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const socket = io('http://localhost:7001', {
      transports: ['websocket', 'polling'],
    })
    socketRef.current = socket

    socket.on('connect', () => {
      telemetry('socket:connect')
    })

    // stream_start: create a placeholder message for real-time streaming
    socket.on('stream_start', (data: { roomId: string; agentId: string; agentName: string; timestamp: number; tempMsgId: string }) => {
      if (data.roomId !== roomId) return
      streamingCountRef.current++
      // Clear previous thinking buffer for this agent
      streamingThinkingRef.current.set(data.agentId, '')
      telemetry('socket:stream_start', { agentName: data.agentName, tempMsgId: data.tempMsgId })
      const tempMsg: Message = {
        id: data.tempMsgId,
        agentRole: 'AGENT',
        agentName: data.agentName,
        content: '',
        timestamp: data.timestamp,
        type: 'streaming',
        tempMsgId: data.tempMsgId,
      }
      streamingMessagesRef.current.set(data.agentId, tempMsg)
      setMessages(prev => {
        const filtered = prev.filter(m => m.tempMsgId !== data.tempMsgId)
        return [...filtered, tempMsg]
      })
    })

    // stream_delta: append text to the streaming message (keyed by tempMsgId via agentId lookup)
    socket.on('stream_delta', (data: { roomId: string; agentId: string; text: string }) => {
      if (data.roomId !== roomId) return
      // Find by agentId: streamingMessagesRef maps agentId → Message
      const msg = streamingMessagesRef.current.get(data.agentId)
      if (msg) {
        msg.content += data.text
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: msg.content } : m))
      }
    })

    // thinking_delta: accumulate thinking content for real-time display
    socket.on('thinking_delta', (data: { roomId: string; agentId: string; thinking: string }) => {
      if (data.roomId !== roomId) return
      const existing = streamingThinkingRef.current.get(data.agentId) || ''
      streamingThinkingRef.current.set(data.agentId, existing + data.thinking)
      // Update the message's thinking field in real-time
      const msg = streamingMessagesRef.current.get(data.agentId)
      if (msg) {
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, thinking: streamingThinkingRef.current.get(data.agentId) } : m))
      }
    })

    // stream_end: finalize the message with stats
    socket.on('stream_end', (data: { roomId: string; agentId: string; tempMsgId: string; duration_ms: number; total_cost_usd: number; input_tokens: number; output_tokens: number }) => {
      if (data.roomId !== roomId) return
      streamingCountRef.current = Math.max(0, streamingCountRef.current - 1)
      telemetry('socket:stream_end', { tempMsgId: data.tempMsgId, duration_ms: data.duration_ms })
      const msg = streamingMessagesRef.current.get(data.agentId)
      if (msg) {
        msg.duration_ms = data.duration_ms
        msg.total_cost_usd = data.total_cost_usd
        msg.input_tokens = data.input_tokens
        msg.output_tokens = data.output_tokens
        // Replace streaming message with finalized one (using tempMsgId as key)
        setMessages(prev => prev.map(m => m.id === data.tempMsgId ? { ...msg, type: m.type !== 'streaming' ? m.type : 'statement' } : m))
      }
    })

    // agent_status: update agent status in real-time
    socket.on('agent_status', (data: { roomId: string; agentId: string; status: string }) => {
      if (data.roomId !== roomId) return
      setAgents(prev => prev.map(a => a.id === data.agentId ? { ...a, status: data.status as Agent['status'] } : a))
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  // Join room on Socket.IO when roomId changes
  useEffect(() => {
    if (!roomId || !socketRef.current) return
    socketRef.current.emit('join-room', roomId)
    telemetry('socket:join_room', { roomId })
    return () => {
      if (socketRef.current) {
        socketRef.current.emit('leave-room', roomId)
      }
    }
  }, [roomId])

  // Load room list
  useEffect(() => {
    telemetry('room:list:load')
    fetch('http://localhost:7001/api/rooms')
      .then(r => {
        if (!r.ok) throw new Error(`status ${r.status}`)
        return r.json()
      })
      .then((data: { id: string; topic: string; createdAt: number }[]) => {
        setRooms(data)
        telemetry('room:list:ok', { count: data.length })
      })
      .catch((err) => {
        telemetry('room:list:error', { error: err.message })
      })
  }, [])

  // Poll for updates — only when roomId is set and agents are active
  useEffect(() => {
    if (!roomId) return
    telemetry('room:poll:start', { roomId })
    const poll = async () => {
      try {
        const res = await fetch(`http://localhost:7001/api/rooms/${roomId}/messages`)
        if (!res.ok) {
          telemetry('room:poll:error', { roomId, status: res.status })
          return
        }
        const data = await res.json()
        const newState = data.state || 'INIT'
        const newAgents = data.agents || []
        pollStateRef.current = { state: newState, agents: newAgents }
        setState(newState)
        setAgents(newAgents)
        setReport(data.report || '')

        // Merge REST messages with streaming messages:
        // REST messages replace streaming placeholders (matched by agentName + tempMsgId)
        // Streaming messages that haven't received final REST update stay visible
        const restMessages: Message[] = data.messages || []

        setMessages(prev => {
          const result: Message[] = []
          const replacedTemps = new Set<string>()

          // First pass: REST messages
          for (const rm of restMessages) {
            if (rm.tempMsgId) {
              replacedTemps.add(rm.tempMsgId)
              // Find the corresponding streaming message by tempMsgId
              const streamingMsg = Array.from(streamingMessagesRef.current.values())
                .find(sm => sm.tempMsgId === rm.tempMsgId)
              if (streamingMsg) {
                // Replace streaming placeholder with final REST message
                result.push({ ...rm, id: streamingMsg.id })
              } else {
                result.push(rm)
              }
            } else {
              result.push(rm)
            }
          }

          // Second pass: streaming messages not yet replaced by REST (still active)
          for (const sm of prev) {
            if (sm.tempMsgId && !replacedTemps.has(sm.tempMsgId)) {
              result.push(sm)
            }
          }

          return result
        })

        // Auto-start: only in INIT, guarded by both started state and ref
        if (data.state === 'INIT' && !started && !startRequestedRef.current) {
          startRequestedRef.current = true
          setStarted(true)
          telemetry('room:auto:start', { roomId })
          await fetch(`http://localhost:7001/api/rooms/${roomId}/start`, { method: 'POST' })
        }

        telemetry('room:poll:ok', { roomId, state: data.state, messageCount: (data.messages || []).length, agentCount: (data.agents || []).length })
      } catch (err) {
        telemetry('room:poll:error', { roomId, error: String(err) })
      }
    }
    poll()
    // Poll every 2s; skip cycles when nothing active (all agents idle/done and not INIT)
    const interval = setInterval(() => {
      const { state: s, agents: ag } = pollStateRef.current
      const anyThinking = ag.some((a: Agent) => a.status === 'thinking' || a.status === 'waiting')
      if (!anyThinking && s !== 'INIT' && s !== 'DONE') {
        telemetry('room:poll:idle_skip', { roomId, state: s })
        return
      }
      poll()
    }, 2000)
    return () => {
      clearInterval(interval)
      telemetry('room:poll:stop', { roomId })
    }
  }, [roomId, started])

  const handleAdvance = async (choice?: string) => {
    if (!roomId) return
    telemetry('room:advance', { roomId, state, choice })
    setAdvancing(true)
    setAdvancingChoice(choice)
    let success = false
    try {
      const res = await fetch(`http://localhost:7001/api/rooms/${roomId}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userChoice: choice }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        telemetry('room:advance:error', { roomId, status: res.status, error: err.error || res.statusText })
      } else {
        const data = await res.json().catch(() => ({}))
        telemetry('room:advance:ok', { roomId, choice, newState: data.state })
        success = true
      }
    } catch (err) {
      telemetry('room:advance:error', { roomId, error: String(err) })
    } finally {
      setAdvancing(false)
      setAdvancingChoice(undefined)
      // Immediately poll once to refresh state/messages after action
      if (success) {
        try {
          const res = await fetch(`http://localhost:7001/api/rooms/${roomId}/messages`)
          if (res.ok) {
            const data = await res.json()
            const newState = data.state || 'INIT'
            const newAgents = data.agents || []
            pollStateRef.current = { state: newState, agents: newAgents }
            setState(newState)
            setAgents(newAgents)
            setReport(data.report || '')
            setMessages(data.messages || [])
          }
        } catch {}
      }
    }
  }

  const handleDownload = () => {
    if (!report) return
    const blob = new Blob([report], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'discussion-report.md'
    a.click()
  }

  return (
    <>
      <CreateRoomModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
      <div className="h-screen flex bg-apple-bg overflow-hidden">
      {/* Left: Session List */}
      <div className="w-[260px] bg-white border-r border-apple-border flex flex-col">
        <div className="p-5 border-b border-apple-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-apple-text">讨论历史</h2>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="w-8 h-8 rounded-full bg-apple-bg flex items-center justify-center text-apple-primary hover:bg-gray-200 transition-colors"
            title="发起讨论"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {rooms.map(room => (
            <div
              key={room.id}
              onClick={() => router.push(`/room/${room.id}`)}
              className={`p-3 rounded-xl mb-2 cursor-pointer transition-colors ${room.id === roomId ? 'bg-apple-bg' : 'hover:bg-apple-bg'}`}
            >
              <p className="text-sm font-medium text-apple-text truncate">{room.topic}</p>
              <p className="text-xs text-apple-secondary">{new Date(room.createdAt).toLocaleDateString('zh')}</p>
            </div>
          ))}
          {rooms.length === 0 && (
            <p className="text-xs text-apple-secondary text-center mt-4">暂无讨论记录</p>
          )}
        </div>
      </div>

      {/* Center: Main Discussion */}
      <div className="flex-1 flex flex-col">
        <div className="h-20 bg-white border-b border-apple-border px-8 flex items-center justify-between">
          <h1 className="text-xl font-bold text-apple-text">AI 智囊团</h1>
          {roomId && (
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-apple-bg rounded-full text-xs font-medium text-apple-secondary">
                状态
              </span>
              <span className="px-4 py-1.5 bg-apple-primary/10 rounded-full text-sm font-bold text-apple-primary">
                {STATE_LABELS[state]}
              </span>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4" ref={messagesContainerRef} onScroll={handleScroll}>
          {messages.map(msg => {
            const isUser = msg.agentRole === 'USER'
            const isStreaming = msg.type === 'streaming' || msg.duration_ms === undefined
            const agentColor = AGENT_COLORS[msg.agentName]?.bg || DEFAULT_AGENT_COLOR.bg
            const USER_BG = '#007AFF'
            const USER_SECONDARY = '#EFF6FF'

            // cat-cafe pattern: user = flex justify-end (right), agent = flex gap-2 (left)
            if (isUser) {
              return (
                <div key={msg.id} className="flex justify-end gap-2 mb-4 items-start">
                  <div className="w-full max-w-[75%]">
                    <div className="flex justify-end items-center gap-2 mb-1">
                      <span className="text-xs text-apple-secondary">
                        {new Date(msg.timestamp).toLocaleTimeString('zh')}
                      </span>
                      {isStreaming && (
                        <span className="text-xs text-green-600 animate-pulse">● 回答中</span>
                      )}
                      <span className="text-xs font-semibold" style={{ color: USER_BG }}>你</span>
                    </div>
                    <div
                      className="rounded-2xl rounded-br-sm px-4 py-3"
                      style={{ backgroundColor: USER_SECONDARY, color: USER_BG }}
                    >
                      <div className="text-sm break-words">
                        {msg.content.length > 300 && !isStreaming ? (
                          <ExpandableText text={msg.content} className="text-sm" />
                        ) : (
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkBreaks]}
                            components={mdComponents}
                          >{msg.content}</ReactMarkdown>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Avatar on right for user */}
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{ backgroundColor: USER_BG }}
                  >
                    ME
                  </div>
                </div>
              )
            }

            // Agent message — left aligned
            return (
              <div key={msg.id} className="group flex gap-2 mb-4 items-start">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: agentColor }}
                >
                  {msg.agentName.slice(0, 1)}
                </div>
                <div className="w-full max-w-[75%]">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: agentColor }}>{msg.agentName}</span>
                    <span className="text-xs text-apple-secondary">
                      {new Date(msg.timestamp).toLocaleTimeString('zh')}
                    </span>
                    {isStreaming && (
                      <span className="text-xs text-green-600 animate-pulse">
                        ● 回答中
                        <span className="inline-block w-1 h-3.5 bg-green-600 animate-pulse ml-0.5 rounded-sm opacity-60" />
                      </span>
                    )}
                    {!isStreaming && msg.duration_ms && (
                      <span className="text-xs text-apple-secondary">· {(msg.duration_ms / 1000).toFixed(1)}s</span>
                    )}
                  </div>
                  <div className="rounded-2xl rounded-tl-sm px-4 py-3 bg-white shadow-sm border border-apple-border">
                    {/* Section 1: Thinking — collapsible, brain icon */}
                    <BubbleSection
                      label="推理过程"
                      icon="brain"
                      content={msg.thinking ?? ''}
                      isStreaming={isStreaming}
                      agentColor={agentColor}
                    />
                    {/* Section 2: Output — collapsible, bubble icon */}
                    <BubbleSection
                      label="最终输出"
                      icon="output"
                      content={msg.content}
                      isStreaming={isStreaming}
                      agentColor={agentColor}
                    />
                  </div>
                  {!isStreaming && msg.duration_ms && state === 'DONE' && (
                    <div className="mt-1 px-2 py-1 bg-gray-50 rounded-lg text-xs text-gray-500 flex flex-wrap gap-3">
                      <span>耗时: {(msg.duration_ms / 1000).toFixed(1)}s</span>
                      {msg.total_cost_usd !== undefined && msg.total_cost_usd > 0 && (
                        <span>费用: ${msg.total_cost_usd.toFixed(4)}</span>
                      )}
                      {msg.input_tokens !== undefined && msg.input_tokens > 0 && (
                        <span>输入: {msg.input_tokens} tokens</span>
                      )}
                      {msg.output_tokens !== undefined && msg.output_tokens > 0 && (
                        <span>输出: {msg.output_tokens} tokens</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {messages.length === 0 && roomId && (
            <p className="text-sm text-apple-secondary text-center mt-8">等待主持人发言...</p>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Action Area */}
        <div className="bg-white border-t border-apple-border px-8 py-5">
          {state === 'DONE' ? (
            <button
              className="w-full bg-apple-primary text-white font-semibold py-4 rounded-xl hover:opacity-90 transition-opacity"
              onClick={handleDownload}
            >
              下载报告
            </button>
          ) : roomId ? (
            <div className="flex gap-3 flex-wrap">
              {(STATE_BUTTONS[state] || []).map(btn => {
                const isActive = advancing && advancingChoice === btn.choice
                return (
                  <button
                    key={btn.label}
                    className="flex-1 bg-apple-primary text-white font-semibold py-3 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
                    onClick={() => handleAdvance(btn.choice)}
                    disabled={advancing}
                  >
                    {isActive ? '处理中...' : btn.label}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>

      {/* Right: Agent States */}
      <div className="w-[300px] bg-white border-l border-apple-border flex flex-col">
        <div className="p-5 border-b border-apple-border">
          <h2 className="text-sm font-semibold text-apple-text">参与 Agent</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {agents.map(agent => {
            const colors = AGENT_COLORS[agent.name] || DEFAULT_AGENT_COLOR
            return (
              <div key={agent.id} className="bg-apple-bg rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: colors.bg }}>
                    {agent.name.slice(0, 1)}
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: colors.bg }}>{agent.name}</p>
                    <p className="text-xs text-apple-secondary">{agent.role === 'HOST' ? '主持人' : agent.domainLabel}</p>
                  </div>
                </div>
                <p className="text-xs text-apple-secondary flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                    agent.status === 'thinking' || agent.status === 'waiting'
                      ? 'bg-green-500 animate-pulse'
                      : 'bg-gray-300'
                  }`}></span>
                  {agent.status === 'thinking' ? '工作中' : agent.status === 'waiting' ? '等待中' : '空闲'}
                </p>
              </div>
            )
          })}
          {agents.length === 0 && (
            <p className="text-xs text-apple-secondary text-center mt-4">选择讨论室后显示 Agent 状态</p>
          )}
        </div>
      </div>
    </div>
    </>
  )
}
