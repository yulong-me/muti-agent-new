'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import CreateRoomModal from '@/components/CreateRoomModal'

// ── Telemetry ────────────────────────────────────────────────────────────────
function telemetry(event: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [FE]`;
  if (meta) {
    console.log(`${prefix} ${event} ${JSON.stringify(meta)}`);
  } else {
    console.log(`${prefix} ${event}`);
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
  const [started, setStarted] = useState(false)
  const startRequestedRef = useRef(false)  // prevent duplicate /start calls
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }
  useEffect(() => { scrollToBottom() }, [messages])

  // Load room list
  useEffect(() => {
    telemetry('room:list:load');
    fetch('http://localhost:7001/api/rooms')
      .then(r => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        return r.json();
      })
      .then((data: { id: string; topic: string; createdAt: number }[]) => {
        setRooms(data);
        telemetry('room:list:ok', { count: data.length });
      })
      .catch((err) => {
        telemetry('room:list:error', { error: err.message });
      });
  }, []);

  // Poll for updates (only when roomId is set)
  useEffect(() => {
    if (!roomId) return
    telemetry('room:poll:start', { roomId });
    const poll = async () => {
      try {
        const res = await fetch(`http://localhost:7001/api/rooms/${roomId}/messages`)
        if (!res.ok) {
          telemetry('room:poll:error', { roomId, status: res.status });
          return;
        }
        const data = await res.json()
        const prevState = data.state
        setState(data.state || 'INIT')
        setMessages(data.messages || [])
        setAgents(data.agents || [])
        setReport(data.report || '')
        if (data.state === 'INIT' && !started && !startRequestedRef.current) {
          startRequestedRef.current = true;
          setStarted(true)
          telemetry('room:auto:start', { roomId });
          await fetch(`http://localhost:7001/api/rooms/${roomId}/start`, { method: 'POST' })
        }
        telemetry('room:poll:ok', { roomId, state: data.state, messageCount: (data.messages || []).length, agentCount: (data.agents || []).length });
      } catch (err) {
        telemetry('room:poll:error', { roomId, error: String(err) });
      }
    }
    poll()
    const interval = setInterval(poll, 2000)
    return () => {
      clearInterval(interval)
      telemetry('room:poll:stop', { roomId });
    }
  }, [roomId, started])

  const handleAdvance = async (choice?: string) => {
    if (!roomId) return
    telemetry('room:advance', { roomId, state, choice });
    setAdvancing(true)
    try {
      const res = await fetch(`http://localhost:7001/api/rooms/${roomId}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userChoice: choice }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        telemetry('room:advance:error', { roomId, status: res.status, error: err.error });
      } else {
        telemetry('room:advance:ok', { roomId, choice });
      }
    } catch (err) {
      telemetry('room:advance:error', { roomId, error: String(err) });
    } finally {
      setAdvancing(false)
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
            <span className="px-4 py-1.5 bg-apple-bg rounded-full text-sm font-medium text-apple-primary">
              {STATE_LABELS[state]}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4">
          {messages.map(msg => {
            const colors = msg.agentRole === 'USER'
              ? { bg: '#86868B' }
              : (AGENT_COLORS[msg.agentName] || DEFAULT_AGENT_COLOR)
            return (
              <div key={msg.id} className="flex gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                  style={{ backgroundColor: colors.bg }}
                >
                  {msg.agentName.slice(0, 1)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold" style={{ color: colors.bg }}>{msg.agentName}</span>
                    <span className="text-xs text-apple-secondary">{new Date(msg.timestamp).toLocaleTimeString('zh')}</span>
                  </div>
                  <div className="bg-white rounded-2xl rounded-tl-sm px-5 py-3 shadow-sm border border-apple-border">
                    <p className="text-sm text-apple-text whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  </div>
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
              {(STATE_BUTTONS[state] || []).map(btn => (
                <button
                  key={btn.label}
                  className="flex-1 bg-apple-primary text-white font-semibold py-3 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
                  onClick={() => handleAdvance(btn.choice)}
                  disabled={advancing}
                >
                  {advancing ? '处理中...' : btn.label}
                </button>
              ))}
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
            const statusLabels: Record<string, string> = { idle: '待命', thinking: '思考中...', waiting: '等待发言', done: '已完成' }
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
                <p className="text-xs text-apple-secondary">
                  <span className={`inline-block w-2 h-2 rounded-full mr-1 ${
                    agent.status === 'thinking' ? 'bg-yellow-400 animate-pulse' :
                    agent.status === 'waiting' ? 'bg-orange-400' :
                    agent.status === 'done' ? 'bg-green-400' : 'bg-gray-300'
                  }`}></span>
                  {statusLabels[agent.status]}
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
