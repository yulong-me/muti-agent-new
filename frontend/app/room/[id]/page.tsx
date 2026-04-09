'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'

type DiscussionState = 'INIT' | 'RESEARCH' | 'DEBATE' | 'CONVERGING' | 'DONE'
type AgentRole = 'HOST' | 'SPECIALIST_A' | 'SPECIALIST_B'

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

const AGENT_COLORS: Record<AgentRole, { bg: string; text: string; light: string }> = {
  HOST: { bg: '#0071E3', text: '#FFFFFF', light: '#E8F4FD' },
  SPECIALIST_A: { bg: '#34C759', text: '#FFFFFF', light: '#E8F8ED' },
  SPECIALIST_B: { bg: '#FF9500', text: '#FFFFFF', light: '#FFF4E5' },
}

const STATE_BUTTONS: Partial<Record<DiscussionState, { label: string; choice?: string; variant?: string }[]>> = {
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

export default function RoomPage() {
  const { id } = useParams()
  const [state, setState] = useState<DiscussionState>('INIT')
  const [messages, setMessages] = useState<Message[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [report, setReport] = useState<string>('')
  const [rooms, setRooms] = useState<{ id: string; topic: string; createdAt: number }[]>([])
  const [advancing, setAdvancing] = useState(false)
  const [started, setStarted] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => { scrollToBottom() }, [messages])

  // Load room list
  useEffect(() => {
    fetch('http://localhost:3004/api/rooms')
      .then(r => r.json())
      .then((data: { id: string; topic: string; createdAt: number }[]) => setRooms(data))
      .catch(() => {})
  }, [])

  // Poll for updates
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`http://localhost:3004/api/rooms/${id}/messages`)
        const data = await res.json()
        setState(data.state)
        setMessages(data.messages || [])
        setAgents(data.agents || [])
        setReport(data.report || '')
        if (data.state === 'INIT' && !started) {
          // Auto-start INIT phase
          setStarted(true)
          await fetch(`http://localhost:3004/api/rooms/${id}/start`, { method: 'POST' })
        }
      } catch {}
    }
    poll()
    const interval = setInterval(poll, 2000)
    return () => clearInterval(interval)
  }, [id, started])

  const handleAdvance = async (choice?: string) => {
    setAdvancing(true)
    try {
      await fetch(`http://localhost:3004/api/rooms/${id}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userChoice: choice }),
      })
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
    <div className="h-screen flex bg-apple-bg overflow-hidden">
      {/* Left: Session List */}
      <div className="w-[260px] bg-white border-r border-apple-border flex flex-col">
        <div className="p-5 border-b border-apple-border">
          <h2 className="text-sm font-semibold text-apple-text">讨论历史</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {rooms.map(room => (
            <div key={room.id} className={`p-3 rounded-xl mb-2 cursor-pointer ${room.id === id ? 'bg-apple-bg' : 'hover:bg-apple-bg'}`}>
              <p className="text-sm font-medium text-apple-text truncate">{room.topic}</p>
              <p className="text-xs text-apple-secondary">{new Date(room.createdAt).toLocaleDateString('zh')}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Center: Main Discussion */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="h-20 bg-white border-b border-apple-border px-8 flex items-center justify-between">
          <h1 className="text-xl font-bold text-apple-text">AI 智囊团</h1>
          <span className="px-4 py-1.5 bg-apple-bg rounded-full text-sm font-medium text-apple-primary">
            {STATE_LABELS[state]}
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4">
          {messages.map(msg => {
            const colors = msg.agentRole === 'USER' ? { bg: '#86868B', text: '#FFF', light: '#F5F5F7' } : AGENT_COLORS[msg.agentRole as AgentRole]
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
          ) : (
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
          )}
        </div>
      </div>

      {/* Right: Agent States */}
      <div className="w-[300px] bg-white border-l border-apple-border flex flex-col">
        <div className="p-5 border-b border-apple-border">
          <h2 className="text-sm font-semibold text-apple-text">参与 Agent</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {agents.map(agent => {
            const colors = AGENT_COLORS[agent.role]
            const statusLabels = { idle: '待命', thinking: '思考中...', waiting: '等待发言', done: '已完成' }
            return (
              <div key={agent.id} className="bg-apple-bg rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: colors.bg }}>
                    {agent.name.slice(0, 1)}
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: colors.bg }}>{agent.domainLabel}</p>
                    <p className="text-xs text-apple-secondary">{agent.role === 'HOST' ? '主持人' : `Agent ${agent.role === 'SPECIALIST_A' ? 'A' : 'B'}`}</p>
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
        </div>
      </div>
    </div>
  )
}
