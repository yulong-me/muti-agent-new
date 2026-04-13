'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { io, type Socket } from 'socket.io-client'
import { useTheme } from 'next-themes'
import { Menu, X, Plus, Download, MessageSquare, ChevronUp, ChevronDown, ChevronRight, BrainCircuit, Sun, Moon, Settings } from 'lucide-react'
import CreateRoomModal from '@/components/CreateRoomModal'
import SettingsModal from '@/components/SettingsModal'

/** @mention 自动补全选择器 */
function MentionPicker({
  agents,
  query,
  highlightIndex,
  onSelect,
  onHighlight,
  position,
}: {
  agents: Agent[]
  query: string
  highlightIndex: number
  onSelect: (name: string) => void
  onHighlight: (index: number) => void
  position: { top: number; left: number }
}) {
  const filtered = query
    ? agents.filter(a => a.name.toLowerCase().includes(query.toLowerCase()))
    : agents

  if (filtered.length === 0) return null

  return (
    <div
      data-mention-picker="1"
      className="fixed z-50 bg-surface border border-line rounded-xl shadow-2xl overflow-hidden"
      style={{ top: position.top, left: Math.max(0, Math.min(position.left, typeof window !== 'undefined' ? window.innerWidth - 240 : position.left)), minWidth: 220, maxWidth: 280 }}
    >
      <div className="px-3 py-1.5 bg-surface-muted border-b border-line">
        <span className="text-[10px] font-semibold text-ink-soft uppercase tracking-wider">选择专家</span>
      </div>
      <div className="max-h-48 overflow-y-auto custom-scrollbar">
        {filtered.map((agent, i) => {
          const colors = AGENT_COLORS[agent.name] || DEFAULT_AGENT_COLOR
          const isHighlighted = i === highlightIndex
          return (
            <button
              key={agent.id}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                isHighlighted ? 'bg-accent/10' : 'hover:bg-surface-muted/60'
              }`}
              onMouseEnter={() => onHighlight(i)}
              onClick={() => onSelect(agent.name)}
            >
              <div className="w-7 h-7 rounded-full flex-shrink-0 shadow-sm overflow-hidden">
                <img src={colors.avatar} alt={agent.name} className="w-full h-full" />
              </div>
              <div className="min-w-0">
                <p className={`text-[13px] font-bold truncate ${isHighlighted ? 'text-accent' : 'text-ink'}`}>{agent.name}</p>
                <p className="text-[11px] text-ink-soft truncate">{agent.domainLabel}</p>
              </div>
              {isHighlighted && (
                <span className="ml-auto text-[10px] text-accent/60 font-mono shrink-0">↵</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Format timestamp as relative time (e.g. "2分钟前", "3小时前", "昨天") */
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时前`
  const day = Math.floor(hr / 24)
  if (day === 1) return '昨天'
  if (day < 7) return `${day}天前`
  return new Date(ts).toLocaleDateString('zh')
}

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

// Extract @mentioned agent names from markdown content
// Matches patterns like "@哲学家" or "[@经济学家](url)" in markdown
function extractMentions(content: string): string[] {
  const seen = new Set<string>()
  // Match @mentions in markdown: @name or [@name](url) or [@ name](url)
  const patterns = [
    /\[@([^\]]+)\]\([^)]+\)/g,  // [@name](url)
    /@([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef_a-zA-Z0-9]{1,20})/g, // @name (Chinese + common chars)
  ]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1].trim()
      if (name && name.length > 0 && !seen.has(name)) {
        seen.add(name)
      }
    }
  }
  return Array.from(seen)
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
  // 回复默认展开，思考默认折叠；streaming 时都展开，用户可手动切换
  const [isExpanded, setIsExpanded] = useState(icon === 'output')
  const effectiveExpanded = isExpanded || isStreaming
  const lineCount = content.split('\n').length
  const isEmpty = !content.trim()

  const expandIcon = (
    <div
      className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded-[4px] transition-colors"
      style={{ backgroundColor: `${agentColor}20`, color: agentColor }}
    >
      {effectiveExpanded ? <ChevronDown className="w-3 h-3" aria-hidden/> : <ChevronRight className="w-3 h-3" aria-hidden/>}
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
        aria-expanded={effectiveExpanded}
        className="flex items-center gap-2 text-xs font-medium w-full group/section hover:opacity-80 transition-opacity px-2 py-1 rounded-lg"
        style={{ color: agentColor, backgroundColor: `${agentColor}10` }}
      >
        {expandIcon}
        <span className="opacity-90 tracking-wide flex items-center gap-1.5">
          {icon === 'brain' && <BrainCircuit className="w-3 h-3" aria-hidden/>}
          {label}
        </span>
        <span className="text-[11px] opacity-50 ml-1 font-normal tracking-wider">{statusText}</span>
        {streamingCursor}
      </button>

      {effectiveExpanded && (
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
  pre: ({ children }) => <pre className="dark:bg-[#1e1e1e] dark:text-[#d4d4d4] bg-[#f5f5f5] text-[#333] rounded-lg p-3 overflow-x-auto text-xs font-mono my-2">{children}</pre>,
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

const AGENT_COLORS: Record<string, { bg: string; text: string; avatar: string }> = {
  主持人: { bg: '#4F46E5', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=host&backgroundColor=b6e3f4' },
  司马迁: { bg: '#D97706', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=simaqian' },
  诸葛亮: { bg: '#059669', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=zhugeliang' },
  李世民: { bg: '#DC2626', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=lishimin' },
  孔子: { bg: '#4D7C0F', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=confucius' },
  曹操: { bg: '#9F1239', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=caocao' },
  马斯克: { bg: '#2563EB', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=musk' },
  乔布斯: { bg: '#7C3AED', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jobs' },
  爱因斯坦: { bg: '#0284C7', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=einstein' },
  图灵: { bg: '#0D9488', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=turing' },
  马云: { bg: '#EA580C', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=mayun' },
}

const DEFAULT_AGENT_COLOR = { bg: '#10B981', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=agent&backgroundColor=c0aede' } // Emerald

const STATE_BUTTONS: Partial<Record<DiscussionState, { label: string; choice?: string }[]>> = {}

interface RoomViewProps { roomId?: string; defaultCreateOpen?: boolean }

export default function RoomView({ roomId, defaultCreateOpen = false }: RoomViewProps) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(defaultCreateOpen)
  const router = useRouter()
  const [state, setState] = useState<DiscussionState>('RUNNING')
  const [messages, setMessages] = useState<Message[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [report, setReport] = useState<string>('')
  const [rooms, setRooms] = useState<{ id: string; topic: string; createdAt: number; state: DiscussionState }[]>([])
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<'agent' | 'provider'>('agent')
  const [debugOpen, setDebugOpen] = useState(false)
  const [debugLogs, setDebugLogs] = useState<{ ts: string; event: string; meta?: Record<string, unknown> }[]>([])
  const [userInput, setUserInput] = useState('')
  const [sending, setSending] = useState(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  // @mention picker state
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStartIdx, setMentionStartIdx] = useState(-1)
  const [mentionHighlightIdx, setMentionHighlightIdx] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mentionPositionRef = useRef({ top: 0, left: 0 })

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollStateRef = useRef<{ state: DiscussionState; agents: Agent[] }>({ state: 'RUNNING' as DiscussionState, agents: [] as Agent[] })
  const streamingMessagesRef = useRef<Map<string, Message>>(new Map())
  const streamingThinkingRef = useRef<Map<string, string>>(new Map())
  const userScrolledRef = useRef(false)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const streamingCountRef = useRef(0)
  const socketRef = useRef<Socket | null>(null)
  const sendMessageRef = useRef<() => void>(() => {})

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
    socket.on('user_message', (data: any) => {
      if (data.roomId !== roomId) return
      const msg = data.message as Message
      setMessages(prev => {
        // Dedupe by id, insert in sorted position
        if (prev.some(m => m.id === msg.id)) return prev
        const merged = [...prev, msg]
        return merged.sort((a, b) => a.timestamp - b.timestamp)
      })
    })
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
        const accumulatedThinking = streamingThinkingRef.current.get(data.agentId)
        msg.thinking = accumulatedThinking
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, thinking: accumulatedThinking } : m))
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
        // Preserve accumulated thinking from thinking_delta (stream_end fires after last delta)
        const accumulatedThinking = streamingThinkingRef.current.get(data.agentId)
        setMessages(prev => prev.map(m => m.id === data.id ? {
          ...msg,
          thinking: accumulatedThinking ?? msg.thinking,
          type: m.type !== 'streaming' ? m.type : 'statement',
        } : m))
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
          // 合并 poll 数据与现有消息，重新排序保证顺序正确
          const existingIds = new Set(prev.map(m => m.id))
          const merged = [...prev, ...(data.messages || []).filter((m: Message) => !existingIds.has(m.id))]
          // 按时间戳正序排列
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

  // @mention picker helpers
  const filteredAgents = mentionQuery
    ? agents.filter(a => a.name.toLowerCase().includes(mentionQuery.toLowerCase()))
    : agents

  const openMentionPicker = useCallback((mentionAtIdx: number, query: string, top: number, left: number) => {
    setMentionPickerOpen(true)
    setMentionQuery(query)
    setMentionStartIdx(mentionAtIdx)
    setMentionHighlightIdx(0)
    mentionPositionRef.current = { top, left: Math.max(0, Math.min(left, typeof window !== 'undefined' ? window.innerWidth - 240 : left)) }
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
    // Restore focus and cursor after the inserted text
    setTimeout(() => {
      const newPos = mentionStartIdx + agentName.length + 2
      ta.focus()
      ta.setSelectionRange(newPos, newPos)
    }, 0)
  }, [userInput, mentionStartIdx, closeMentionPicker])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    const cursor = e.target.selectionStart ?? val.length
    setUserInput(val)

    // Find @mention trigger: last @ before cursor on current line
    const textBefore = val.slice(0, cursor)
    const lineStart = textBefore.lastIndexOf('\n') + 1
    const textOnLine = textBefore.slice(lineStart)
    const lastAt = textOnLine.lastIndexOf('@')

    if (lastAt >= 0) {
      const query = textOnLine.slice(lastAt + 1)
      // Only trigger if @ is at line start or preceded by whitespace
      const atPos = lineStart + lastAt
      const charBefore = atPos > 0 ? val[atPos - 1] : ''
      if (charBefore === '' || charBefore === ' ' || charBefore === '\n') {
        // Position the popover ABOVE the textarea, clamping to viewport top
        const rect = textareaRef.current?.getBoundingClientRect()
        if (rect) {
          const PANEL_HEIGHT = 280
          const rawTop = rect.top - PANEL_HEIGHT - 4
          const top = typeof window !== 'undefined' ? Math.max(8, rawTop) : rawTop
          const left = rect.left
          openMentionPicker(atPos, query, top, left)
        } else {
          openMentionPicker(atPos, query, 50, 50)
        }
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
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMentionPicker()
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setMentionHighlightIdx(i => (i + 1) % count)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setMentionHighlightIdx(i => (i - 1 + count) % count)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      if (filteredAgents[mentionHighlightIdx]) {
        selectMentionAgent(filteredAgents[mentionHighlightIdx].name)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeMentionPicker()
    }
  }, [mentionPickerOpen, filteredAgents, mentionHighlightIdx, selectMentionAgent, closeMentionPicker])

  const handleSendMessage = async () => {
    if (!roomId || !userInput.trim() || sending) return
    setMentionPickerOpen(false)
    setSending(true)
    const content = userInput.trim()
    setUserInput('')
    try {
      const res = await fetch(`http://localhost:7001/api/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) {
        const err = await res.text()
        console.error('[RoomView] POST /messages failed:', res.status, err)
        setUserInput(content)
        setSendError('发送失败，请重试')
        setTimeout(() => setSendError(null), 4000)
      }
    } catch (e) {
      console.error('[RoomView] POST /messages network error:', e)
      setUserInput(content)
      setSendError('发送失败，请检查网络')
      setTimeout(() => setSendError(null), 4000)
    } finally {
      setSending(false)
    }
  }
  // Keep ref in sync so keyboard handler can call the latest handleSendMessage
  sendMessageRef.current = handleSendMessage

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
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[14px] font-medium text-ink truncate flex-1 flex items-center gap-2">
                    <MessageSquare className="w-3.5 h-3.5 opacity-60 flex-shrink-0" aria-hidden/>
                    {room.topic}
                  </p>
                  <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    room.state === 'RUNNING'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-ink-soft/10 text-ink-soft'
                  }`}>
                    {room.state === 'RUNNING' ? '进行中' : '已完成'}
                  </span>
                </div>
                <p className="text-[11px] text-ink-soft mt-1 ml-5.5">{formatRelativeTime(room.createdAt)}</p>
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
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[14px] font-medium text-ink truncate">{room.topic}</p>
                      <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        room.state === 'RUNNING'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-ink-soft/10 text-ink-soft'
                      }`}>
                        {room.state === 'RUNNING' ? '进行中' : '已完成'}
                      </span>
                    </div>
                    <p className="text-[11px] text-ink-soft mt-1">{formatRelativeTime(room.createdAt)}</p>
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
            {/* USER 消息永远在前，然后按时间戳 */}
            {/* 按时间戳正序显示 */}
            {([...messages].sort((a, b) => a.timestamp - b.timestamp)).map(msg => {
              const isUser = msg.agentRole === 'USER'
              const isStreaming = !isUser && (msg.type === 'streaming' || msg.duration_ms === undefined)
              const agentColor = AGENT_COLORS[msg.agentName]?.bg || DEFAULT_AGENT_COLOR.bg
              const agentAvatar = AGENT_COLORS[msg.agentName]?.avatar || DEFAULT_AGENT_COLOR.avatar
              
              if (isUser) {
                return (
                  <div key={msg.id} className="flex justify-end gap-3 mb-6 items-start">
                    <div className="w-full max-w-[85%] md:max-w-[70%]">
                      <div className="flex justify-end items-center gap-2 mb-1.5">
                        <span className="text-[11px] text-ink-soft">
                          {new Date(msg.timestamp).toLocaleTimeString('zh', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isStreaming && <span className="text-[11px] text-accent animate-pulse font-medium">● 回答中</span>}
                        <span className="text-[12px] font-bold px-2 py-0.5 rounded-md bg-accent/20 text-accent">你</span>
                      </div>
                      <div className="rounded-2xl rounded-tr-sm px-4 py-3.5 bg-accent/10 border border-accent/20 shadow-sm">
                        <div className="text-[14px] break-words leading-relaxed text-ink">
                          {msg.content.length > 300 && !isStreaming ? (
                            <ExpandableText text={msg.content} className="text-accent hover:text-accent-deep" />
                          ) : (
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={{...mdComponents, p: ({children}) => <p className="mb-2 last:mb-0 text-ink">{children}</p>, a: ({href, children}) => <a href={href} target="_blank" className="underline underline-offset-2 opacity-90 hover:opacity-100 text-accent">{children}</a>}}>{msg.content}</ReactMarkdown>
                          )}
                        </div>
                      </div>
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
                      <span
                        className="text-[13px] font-bold px-2 py-0.5 rounded-md"
                        style={{ backgroundColor: `${agentColor}20`, color: agentColor }}
                      >{msg.agentName}</span>
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
                      {extractMentions(msg.content).length > 0 && (
                        <div className="flex items-center gap-1.5 text-xs font-medium flex-wrap" style={{ color: agentColor }}>
                          <span className="opacity-50 mr-0.5">@点名</span>
                          {extractMentions(msg.content).map((name, i) => (
                            <span
                              key={name}
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold"
                              style={{ backgroundColor: `${agentColor}20`, color: agentColor }}
                            >
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
                <BrainCircuit className="w-8 h-8" aria-hidden/>
                <p className="text-sm">输入消息开始讨论，或 @mention 专家</p>
              </div>
            )}
            <div ref={messagesEndRef} />
            {showScrollBtn && (
              <button
                onClick={handleScrollToBottom}
                className="sticky bottom-4 left-1/2 -translate-x-1/2 bg-accent text-white px-4 py-2 rounded-full text-xs font-medium shadow-lg hover:bg-accent-deep transition-colors flex items-center gap-1.5 z-10"
              >
                <ChevronDown className="w-3.5 h-3.5" aria-hidden/> 回到底部
              </button>
            )}
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
              <div className="flex flex-col gap-2 relative">
              {sendError && (
                <div className="text-xs text-red-500 px-1">{sendError}</div>
              )}
              {mentionPickerOpen && (
                <MentionPicker
                  agents={agents}
                  query={mentionQuery}
                  highlightIndex={mentionHighlightIdx}
                  onSelect={selectMentionAgent}
                  onHighlight={setMentionHighlightIdx}
                  position={mentionPositionRef.current}
                />
              )}
              <div className="flex gap-3">
                <textarea
                  ref={textareaRef}
                  className="flex-1 bg-surface border border-line rounded-xl px-4 py-3 text-[14px] text-ink placeholder:text-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all resize-none min-h-[48px] max-h-40 overflow-y-auto custom-scrollbar leading-relaxed"
                  placeholder="输入消息，或 @mention 专家..."
                  value={userInput}
                  onChange={handleInputChange}
                  onKeyDown={handleInputKeyDown}
                  disabled={sending}
                  style={{ height: '48px' }}
                  onInput={e => {
                    const ta = e.currentTarget
                    const newHeight = Math.min(ta.scrollHeight, 160)
                    if (newHeight > ta.clientHeight) {
                      ta.style.height = newHeight + 'px'
                    }
                  }}
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

        {/* Right Sidebar (Agents) */}
        <div className="hidden lg:flex w-[260px] bg-surface border-l border-line flex-col z-20">
          <div className="p-5 border-b border-line space-y-1.5">
            {roomId && (
              <button
                onClick={() => navigator.clipboard.writeText(roomId)}
                title="点击复制对话 ID"
                className="flex items-center gap-1.5 text-[11px] text-ink-soft hover:text-accent transition-colors cursor-pointer group w-full"
              >
                <span className="opacity-60 group-hover:opacity-100 shrink-0">ID:</span>
                <span className="font-mono truncate group-hover:text-accent">{roomId.slice(0, 8)}…</span>
                <span className="text-[10px] opacity-40 ml-auto">📋</span>
              </button>
            )}
            {debugOpen && (
              <button
                onClick={() => roomId && navigator.clipboard.writeText(roomId)}
                title="复制完整 Room ID"
                className="text-[10px] text-ink-soft/40 hover:text-accent/60 transition-colors cursor-pointer"
              >
                {roomId}
              </button>
            )}
            <h2 className="text-[15px] font-bold text-ink pt-1">参与 Agent</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {agents.map(agent => {
              const colors = AGENT_COLORS[agent.name] || DEFAULT_AGENT_COLOR
              return (
                <div key={agent.id} className="bg-bg border border-line rounded-xl p-3 shadow-sm">
                  <div className="flex items-center gap-3 mb-2.5">
                    <div className="w-8 h-8 rounded-full flex-shrink-0 shadow-sm overflow-hidden">
                      <img src={colors.avatar} alt={agent.name} className="w-full h-full" />
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
                  {/* 当前消息 ID：点击可复制 (debug only) */}
                  {debugOpen && (() => {
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
