'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { io, type Socket } from 'socket.io-client'
import { useTheme } from 'next-themes'
import { Menu, X, Plus, Download, MessageSquare, ChevronUp, ChevronDown, ChevronRight, BrainCircuit, Sun, Moon, Settings } from 'lucide-react'
import CreateRoomModal from '@/components/CreateRoomModal'
import SettingsModal from '@/components/SettingsModal'

function SettingsButton({ onOpen }: { onOpen: () => void }) {
  const [mounted, setMounted] = useState(false)
  const { theme, setTheme } = useTheme()

  useEffect(() => setMounted(true), [])

  function handleOpen() {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      window.location.href = '/settings'
    } else {
      onOpen()
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={handleOpen}
        className="w-8 h-8 rounded-full flex items-center justify-center text-ink-soft hover:text-ink hover:bg-surface-muted transition-colors"
        aria-label="打开设置"
      >
        <Settings className="w-4 h-4" aria-hidden/>
      </button>
      {mounted && (
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="w-8 h-8 rounded-full flex items-center justify-center text-ink-soft hover:text-ink hover:bg-surface-muted transition-colors"
          aria-label={theme === 'dark' ? '切换亮色模式' : '切换暗色模式'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" aria-hidden/> : <Moon className="w-4 h-4" aria-hidden/>}
        </button>
      )}
    </div>
  )
}

function BubbleSection({
  label,
  icon,
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
  const [isExpanded, setIsExpanded] = useState(false)
  const lineCount = content.split('\n').length
  const isEmpty = !content.trim()

  const expandIcon = (
    <div
      className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded-[4px] transition-colors"
      style={{ backgroundColor: `${agentColor}20`, color: agentColor }}
    >
      {isExpanded ? <ChevronDown className="w-3 h-3" aria-hidden/> : <ChevronRight className="w-3 h-3" aria-hidden/>}
    </div>
  )

  const statusText = isEmpty
    ? '等待输出...'
    : isStreaming
    ? `${lineCount} 行 · 输出中...`
    : `${lineCount} 行`

  const streamingCursor = isStreaming ? (
    <span className="inline-block w-1.5 h-3.5 bg-current animate-pulse ml-1.5 rounded-sm opacity-60 align-middle" />
  ) : null

  if (isEmpty && !isStreaming) return null

  return (
    <div className={icon === 'brain' ? 'mb-3' : 'mb-1'}>
      <button
        onClick={() => setIsExpanded(e => !e)}
        aria-expanded={isExpanded}
        className="flex items-center gap-2 text-xs font-medium w-full group/section hover:opacity-80 transition-opacity"
        style={{ color: agentColor }}
      >
        {expandIcon}
        <span className="opacity-90 tracking-wide flex items-center gap-1.5">
          {icon === 'brain' && <BrainCircuit className="w-3 h-3" aria-hidden/>}
          {label}
        </span>
        <span className="text-[11px] opacity-50 ml-1 font-normal tracking-wider">{statusText}</span>
        {streamingCursor}
      </button>

      {isExpanded && (
        <div
          className={`mt-2 ml-2 pl-3.5 border-l-2 text-[14px] leading-relaxed ${
            icon === 'brain'
              ? 'font-mono text-ink-soft bg-surface-muted/50 py-2.5 px-3 rounded-r-lg text-[13px] overflow-x-auto'
              : 'text-ink py-0.5'
          }`}
          style={{ borderColor: `${agentColor}40` }}
        >
          {icon === 'output' ? (
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={mdComponents}>{content}</ReactMarkdown>
          ) : (
            <span className="whitespace-pre-wrap opacity-80">{content}</span>
          )}
        </div>
      )}
    </div>
  )
}

function ExpandableText({ text, clampClass = 'line-clamp-3', className = '' }: { text: string; clampClass?: string; className?: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <span>
      <span className={expanded ? 'whitespace-normal' : clampClass}>
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={mdComponents}>{text}</ReactMarkdown>
      </span>
      <button
        className={`mt-1 inline-flex items-center gap-1 text-accent/80 hover:text-accent transition-colors ${className}`}
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? <ChevronUp className="w-3 h-3" aria-hidden/> : <ChevronDown className="w-3 h-3" aria-hidden/>}
      </button>
    </span>
  )
}

const mdComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="text-base font-bold mb-2 mt-3 text-ink first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold mb-2 mt-3 text-ink first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-2 text-ink first:mt-0">{children}</h3>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5 text-ink">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5 text-ink">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-line pl-3 my-2 italic text-ink-soft">{children}</blockquote>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline break-all">{children}</a>,
  pre: ({ children }) => <pre className="bg-[#1e1e1e] text-[#d4d4d4] rounded-lg p-3 overflow-x-auto text-xs font-mono my-2">{children}</pre>,
  code: ({ children }) => <code className="bg-surface-muted text-ink rounded px-1.5 py-0.5 text-[0.85em] font-mono border border-line">{children}</code>,
}

// Debug log store: keep last 100 entries
const DEBUG_MAX = 100
const debugLogRef = { current: [] as { ts: string; event: string; meta?: Record<string, unknown> }[] }
function telemetry(event: string, meta?: Record<string, unknown>) {
  const ts = new Date().toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })
  const entry = { ts, event, meta }
  debugLogRef.current = [entry, ...debugLogRef.current].slice(0, DEBUG_MAX)
  if (meta) console.log(`[${ts}] [FE] ${event} ${JSON.stringify(meta)}`)
  else console.log(`[${ts}] [FE] ${event}`)
}

type DiscussionState = 'RUNNING' | 'DONE'
type AgentRole = 'MANAGER' | 'WORKER' | 'USER'

interface Agent {
  id: string; role: AgentRole; name: string; domainLabel: string; status: 'idle' | 'thinking' | 'waiting' | 'done'
}

interface Message {
  id: string; agentRole: AgentRole | 'USER'; agentName: string; content: string; timestamp: number; type: string;
  thinking?: string; duration_ms?: number; total_cost_usd?: number; input_tokens?: number; output_tokens?: number
}

const STATE_LABELS: Record<DiscussionState, string> = {
  RUNNING: '讨论中', DONE: '已完成',
}

const AGENT_COLORS: Record<string, { bg: string; text: string }> = {
  主持人: { bg: '#4F46E5', text: '#FFFFFF' }, // Indigo
  司马迁: { bg: '#D97706', text: '#FFFFFF' }, // Amber
  诸葛亮: { bg: '#059669', text: '#FFFFFF' }, // Emerald
  李世民: { bg: '#DC2626', text: '#FFFFFF' }, // Red
  孔子: { bg: '#4D7C0F', text: '#FFFFFF' }, // Olive
  曹操: { bg: '#9F1239', text: '#FFFFFF' }, // Rose
  马斯克: { bg: '#2563EB', text: '#FFFFFF' }, // Blue
  乔布斯: { bg: '#7C3AED', text: '#FFFFFF' }, // Violet
  爱因斯坦: { bg: '#0284C7', text: '#FFFFFF' }, // Sky
  图灵: { bg: '#0D9488', text: '#FFFFFF' }, // Teal
  马云: { bg: '#EA580C', text: '#FFFFFF' }, // Orange
}

const DEFAULT_AGENT_COLOR = { bg: '#10B981', text: '#FFFFFF' } // Emerald

const STATE_BUTTONS: Partial<Record<DiscussionState, { label: string; choice?: string }[]>> = {}

interface RoomViewProps { roomId?: string; defaultCreateOpen?: boolean }

export default function RoomView({ roomId, defaultCreateOpen = false }: RoomViewProps) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(defaultCreateOpen)
  const router = useRouter()
  const [state, setState] = useState<DiscussionState>('RUNNING')
  const [messages, setMessages] = useState<Message[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [report, setReport] = useState<string>('')
  const [rooms, setRooms] = useState<{ id: string; topic: string; createdAt: number }[]>([])
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<'agent' | 'provider'>('agent')
  const [debugOpen, setDebugOpen] = useState(false)
  const [debugLogs, setDebugLogs] = useState<{ ts: string; event: string; meta?: Record<string, unknown> }[]>([])
  const [userInput, setUserInput] = useState('')
  const [sending, setSending] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollStateRef = useRef<{ state: DiscussionState; agents: Agent[] }>({ state: 'RUNNING' as DiscussionState, agents: [] as Agent[] })
  const streamingMessagesRef = useRef<Map<string, Message>>(new Map())
  const streamingThinkingRef = useRef<Map<string, string>>(new Map())
  const userScrolledRef = useRef(false)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const streamingCountRef = useRef(0)
  const socketRef = useRef<Socket | null>(null)

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
  }

  useEffect(() => { scrollToBottom() }, [messages])

  // Sync debug logs from ref to state every 500ms
  useEffect(() => {
    const sync = () => setDebugLogs([...debugLogRef.current])
    sync()
    const interval = setInterval(sync, 500)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const socket = io('http://localhost:7001', { transports: ['websocket', 'polling'] })
    socketRef.current = socket

    socket.on('connect', () => telemetry('socket:connect'))
    socket.on('stream_start', (data: any) => {
      if (data.roomId !== roomId) return
      streamingCountRef.current++
      streamingThinkingRef.current.set(data.agentId, '')
      telemetry('socket:stream_start', { agentName: data.agentName, id: data.id })
      const tempMsg: Message = { id: data.id, agentRole: data.agentRole as AgentRole, agentName: data.agentName, content: '', timestamp: data.timestamp, type: 'streaming' }
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
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, thinking: streamingThinkingRef.current.get(data.agentId) } : m))
      }
    })
    socket.on('stream_end', (data: any) => {
      if (data.roomId !== roomId) return
      streamingCountRef.current = Math.max(0, streamingCountRef.current - 1)
      telemetry('socket:stream_end', { id: data.id, duration_ms: data.duration_ms })
      const msg = streamingMessagesRef.current.get(data.agentId)
      if (msg) {
        msg.duration_ms = data.duration_ms
        msg.total_cost_usd = data.total_cost_usd
        msg.input_tokens = data.input_tokens
        msg.output_tokens = data.output_tokens
        setMessages(prev => prev.map(m => m.id === data.id ? { ...msg, type: m.type !== 'streaming' ? m.type : 'statement' } : m))
      }
    })
    socket.on('agent_status', (data: any) => {
      if (data.roomId !== roomId) return
      setAgents(prev => prev.map(a => a.id === data.agentId ? { ...a, status: data.status as Agent['status'] } : a))
    })

    return () => { socket.disconnect(); socketRef.current = null }
  }, [roomId])

  useEffect(() => {
    if (!roomId || !socketRef.current) return
    socketRef.current.emit('join-room', roomId)
    telemetry('socket:join_room', { roomId })
    return () => { if (socketRef.current) socketRef.current.emit('leave-room', roomId) }
  }, [roomId])

  useEffect(() => {
    telemetry('room:list:load')
    fetch('http://localhost:7001/api/rooms').then(r => r.ok ? r.json() : []).then(data => setRooms(data)).catch(console.error)
  }, [])

  useEffect(() => {
    if (!roomId) return
    const poll = async () => {
      try {
        const res = await fetch(`http://localhost:7001/api/rooms/${roomId}/messages`)
        if (!res.ok) return
        const data = await res.json()
        const newState = data.state || 'RUNNING'
        const newAgents = data.agents || []
        pollStateRef.current = { state: newState, agents: newAgents }
        setState(newState)
        setAgents(newAgents)
        setReport(data.report || '')

        setMessages(prev => {
          // F004: dedup by message id - keep streaming ones, add new ones
          const existingIds = new Set(prev.map(m => m.id))
          const newMsgs = (data.messages || []).filter((m: Message) => !existingIds.has(m.id))
          return [...prev, ...newMsgs]
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

  const handleSendMessage = async () => {
    if (!roomId || !userInput.trim() || sending) return
    setSending(true)
    const content = userInput.trim()
    setUserInput('')
    try {
      await fetch(`http://localhost:7001/api/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
    } catch {} finally {
      setSending(false)
    }
  }

  const toggleMobileMenu = () => setMobileMenuOpen(o => !o)

  return (
    <>
      <CreateRoomModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
      <div className="h-[100dvh] flex bg-bg overflow-hidden text-ink font-sans">
        
        {/* Left Sidebar (Desktop) */}
        <div className="hidden md:flex w-[280px] bg-surface border-r border-line flex-col z-20">
          <div className="p-5 border-b border-line flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-ink">讨论历史</h2>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="w-8 h-8 rounded-full bg-surface-muted flex items-center justify-center text-ink hover:text-accent hover:bg-line transition-colors"
              title="发起讨论"
            >
              <Plus className="w-4 h-4" aria-hidden/>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
            {rooms.map(room => (
              <div
                key={room.id}
                onClick={() => router.push(`/room/${room.id}`)}
                className={`p-3.5 rounded-xl mb-2 cursor-pointer transition-colors border ${room.id === roomId ? 'bg-surface-muted border-line' : 'border-transparent hover:bg-surface-muted/50'}`}
              >
                <p className="text-[14px] font-medium text-ink truncate flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5 opacity-60" aria-hidden/>
                  {room.topic}
                </p>
                <p className="text-[12px] text-ink-soft mt-1.5 ml-5.5">{new Date(room.createdAt).toLocaleDateString('zh')}</p>
              </div>
            ))}
            {rooms.length === 0 && (
              <p className="text-xs text-ink-soft text-center mt-6">暂无讨论记录</p>
            )}
          </div>
        </div>

        {/* Mobile Menu Overlay */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={toggleMobileMenu}>
            <div className="w-[80%] max-w-[300px] h-full bg-surface border-r border-line flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="p-5 border-b border-line flex items-center justify-between">
                <h2 className="text-[15px] font-bold text-ink">讨论历史</h2>
                <button onClick={toggleMobileMenu} aria-label="关闭菜单" className="p-2 text-ink-soft hover:text-ink"><X className="w-5 h-5" aria-hidden/></button>
              </div>
              <div className="p-3">
                 <button
                  onClick={() => { setIsCreateModalOpen(true); toggleMobileMenu(); }}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent text-white hover:bg-accent-deep transition-colors text-sm font-medium"
                >
                  <Plus className="w-4 h-4" aria-hidden/> 发起新讨论
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                {rooms.map(room => (
                  <div
                    key={room.id}
                    onClick={() => { router.push(`/room/${room.id}`); toggleMobileMenu(); }}
                    className={`p-3.5 rounded-xl mb-2 border ${room.id === roomId ? 'bg-surface-muted border-line' : 'border-transparent hover:bg-surface-muted/50'}`}
                  >
                    <p className="text-[14px] font-medium text-ink truncate">{room.topic}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Center: Main Discussion */}
        <div className="flex-1 flex flex-col relative min-w-0">
          {/* Main Header */}
          <div className="h-[60px] md:h-16 bg-nav-bg backdrop-blur-xl border-b border-line px-4 md:px-6 flex items-center justify-between sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <button className="md:hidden p-2 -ml-2 text-ink-soft hover:text-ink" onClick={toggleMobileMenu}>
                <Menu className="w-5 h-5" aria-hidden/>
              </button>
              <h1 className="text-lg font-bold text-ink hidden sm:block">AI 智囊团</h1>
            </div>
            
            <div className="flex items-center gap-2 md:gap-4">
              {roomId && (
                <div className="hidden sm:flex items-center gap-2 mr-2" aria-label={`当前状态: ${STATE_LABELS[state]}`}>
                  <span className="px-2.5 py-1 bg-surface-muted rounded-full text-[11px] font-semibold text-ink-soft uppercase tracking-wide">
                    状态
                  </span>
                  <span className="px-3 py-1 bg-accent/10 border border-accent/20 rounded-full text-xs font-bold text-accent">
                    {STATE_LABELS[state]}
                  </span>
                </div>
              )}
              
              <SettingsButton onOpen={() => { setSettingsInitialTab('agent'); setSettingsOpen(true) }} />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6 scroll-smooth custom-scrollbar" ref={messagesContainerRef} onScroll={handleScroll}>
            {messages.map(msg => {
              const isUser = msg.agentRole === 'USER'
              const isStreaming = msg.type === 'streaming' || msg.duration_ms === undefined
              const agentColor = AGENT_COLORS[msg.agentName]?.bg || DEFAULT_AGENT_COLOR.bg
              
              if (isUser) {
                return (
                  <div key={msg.id} className="flex justify-end gap-3 mb-6 items-start">
                    <div className="w-full max-w-[85%] md:max-w-[70%]">
                      <div className="flex justify-end items-center gap-2 mb-1.5">
                        <span className="text-[11px] text-ink-soft">
                          {new Date(msg.timestamp).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isStreaming && <span className="text-[11px] text-accent animate-pulse font-medium">● 回答中</span>}
                        <span className="text-[12px] font-bold text-ink">你</span>
                      </div>
                      <div className="rounded-2xl rounded-tr-sm px-4 py-3.5 bg-ink text-bg shadow-sm border border-line/10">
                        <div className="text-[14px] break-words leading-relaxed text-bg">
                          {msg.content.length > 300 && !isStreaming ? (
                            <ExpandableText text={msg.content} className="text-accent hover:text-accent-deep" />
                          ) : (
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={{...mdComponents, p: ({children}) => <p className="mb-2 last:mb-0 text-bg">{children}</p>, a: ({href, children}) => <a href={href} target="_blank" className="underline underline-offset-2 opacity-90 hover:opacity-100">{children}</a>}}>{msg.content}</ReactMarkdown>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              }

              return (
                <div key={msg.id} className="group flex gap-3 mb-6 items-start">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-sm mt-1"
                    style={{ backgroundColor: agentColor }}
                  >
                    {msg.agentName.slice(0, 1)}
                  </div>
                  <div className="w-full max-w-[85%] md:max-w-[70%]">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-[13px] font-bold" style={{ color: agentColor }}>{msg.agentName}</span>
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
                      <BubbleSection
                        label="思考过程"
                        icon="brain"
                        content={msg.thinking ?? ''}
                        isStreaming={isStreaming}
                        agentColor={agentColor}
                      />
                      <BubbleSection
                        label="回复"
                        icon="output"
                        content={msg.content}
                        isStreaming={isStreaming}
                        agentColor={agentColor}
                      />
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
                <BrainCircuit className="w-8 h-8" aria-hidden/>
                <p className="text-sm">等待主持人发言...</p>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Action Area */}
          <div className="bg-nav-bg backdrop-blur-xl border-t border-line px-4 md:px-8 py-4">
            {state === 'DONE' ? (
              <button
                type="button"
                className="w-full bg-ink text-bg font-semibold py-3.5 rounded-xl hover:opacity-90 transition-opacity flex items-center justify-center gap-2 shadow-sm"
                onClick={handleDownload}
              >
                <Download className="w-4 h-4" aria-hidden/> 下载讨论报告
              </button>
            ) : roomId ? (
              <div className="flex gap-3">
                <input
                  type="text"
                  className="flex-1 bg-surface border border-line rounded-xl px-4 py-3 text-[14px] text-ink placeholder:text-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                  placeholder="输入消息，或 @mention 专家..."
                  value={userInput}
                  onChange={e => setUserInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                  disabled={sending}
                />
                <button
                  type="button"
                  className="bg-accent text-white font-semibold px-5 py-3 rounded-xl hover:bg-accent-deep transition-all disabled:opacity-50 text-[14px] shadow-sm"
                  onClick={handleSendMessage}
                  disabled={sending || !userInput.trim()}
                >
                  {sending ? '发送中...' : '发送'}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Right Sidebar (Agents) */}
        <div className="hidden lg:flex w-[260px] bg-surface border-l border-line flex-col z-20">
          <div className="p-5 border-b border-line">
            <h2 className="text-[15px] font-bold text-ink">参与 Agent</h2>
            {roomId && (
              <button
                onClick={() => navigator.clipboard.writeText(roomId)}
                title="点击复制 Room ID"
                className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-soft hover:text-accent transition-colors cursor-pointer group"
              >
                <span className="font-mono opacity-60 group-hover:opacity-100">Room:</span>
                <span className="font-mono truncate max-w-[120px] group-hover:text-accent">{roomId.slice(0, 8)}…</span>
                <span className="text-[10px] opacity-40">📋</span>
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {agents.map(agent => {
              const colors = AGENT_COLORS[agent.name] || DEFAULT_AGENT_COLOR
              return (
                <div key={agent.id} className="bg-bg border border-line rounded-xl p-3 shadow-sm">
                  <div className="flex items-center gap-3 mb-2.5">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-sm" style={{ backgroundColor: colors.bg }}>
                      {agent.name.slice(0, 1)}
                    </div>
                    <div>
                      <p className="text-[14px] font-bold leading-none mb-1 text-ink">{agent.name}</p>
                      <p className="text-[11px] text-ink-soft leading-none">{agent.role === 'MANAGER' ? '主持人' : agent.domainLabel}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 bg-surface-muted px-2 py-1 rounded-md max-w-fit">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      agent.status === 'thinking' || agent.status === 'waiting'
                        ? 'bg-emerald-500 animate-pulse shadow-[0_0_4px_rgba(16,185,129,0.5)]'
                        : 'bg-ink-soft/40'
                    }`}></span>
                    <span className="text-[11px] font-medium text-ink-soft">
                      {agent.status === 'thinking' ? '工作中' : agent.status === 'waiting' ? '等待中' : '空闲'}
                    </span>
                  </div>
                  {/* 当前消息 ID：点击可复制 */}
                  {(() => {
                    const activeMsg = messages.find(m => m.agentRole === agent.role && m.agentName === agent.name && (m.type === 'streaming' || m.duration_ms === undefined))
                      || messages.filter(m => m.agentRole === agent.role && m.agentName === agent.name).sort((a, b) => b.timestamp - a.timestamp)[0]
                    if (!activeMsg) return null
                    return (
                      <button
                        onClick={() => navigator.clipboard.writeText(activeMsg.id)}
                        title="点击复制消息 ID"
                        className="mt-1 flex items-center gap-1 text-[10px] text-ink-soft/50 hover:text-accent transition-colors cursor-pointer group font-mono"
                      >
                        <span>ID:</span>
                        <span className="truncate max-w-[100px] group-hover:text-accent">{activeMsg.id.slice(0, 8)}…</span>
                        <span className="opacity-40">📋</span>
                      </button>
                    )
                  })()}
                </div>
              )
            })}
            {agents.length === 0 && (
              <p className="text-[12px] text-ink-soft text-center mt-6">选择讨论室后显示参与者</p>
            )}

          {/* Debug 日志面板 */}
          {roomId && (
            <div className="border-t border-line mt-2">
              <button
                onClick={() => setDebugOpen(o => !o)}
                className="w-full px-4 py-2.5 flex items-center justify-between text-[12px] font-bold text-ink hover:bg-surface-muted/50 transition-colors"
              >
                <span>🔍 Debug 日志</span>
                <span className="text-[11px] opacity-60">{debugOpen ? '▲' : '▼'}</span>
              </button>
              {debugOpen && (
                <div className="max-h-60 overflow-y-auto px-3 pb-3 custom-scrollbar">
                  {debugLogs.length === 0 && (
                    <p className="text-[11px] text-ink-soft/50 font-mono text-center py-2">暂无日志</p>
                  )}
                  {debugLogs.map((log, i) => (
                    <div key={i} className="mb-1.5 font-mono">
                      <div className="flex items-start gap-1.5">
                        <span className="text-[10px] text-ink-soft/40 flex-shrink-0">{log.ts}</span>
                        <span className="text-[11px] font-semibold text-accent/80">{log.event}</span>
                      </div>
                      {log.meta && Object.keys(log.meta).length > 0 && (
                        <pre className="text-[10px] text-ink-soft/60 ml-5 whitespace-pre-wrap break-all max-w-[200px]">
                          {JSON.stringify(log.meta, (k, v) => {
                            if (typeof v === 'string' && v.length > 40) return v.slice(0, 40) + '…'
                            return v
                          }, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          </div>
        </div>

      </div>
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} initialTab={settingsInitialTab} />
    </>
  )
}
