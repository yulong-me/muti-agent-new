'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

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

interface CreateRoomModalProps {
  isOpen: boolean
  onClose: () => void
}

type Domain = 'history' | 'tech'

interface AgentCard {
  id: string
  name: string
  title: string
  domain: Domain
}

const HISTORY_AGENTS: AgentCard[] = [
  { id: 'simaqian', name: '司马迁', title: '历史学家', domain: 'history' },
  { id: 'zhugeliang', name: '诸葛亮', title: '战略家', domain: 'history' },
  { id: 'licheng', name: '李世民', title: '帝王', domain: 'history' },
  { id: 'confucius', name: '孔子', title: '思想家', domain: 'history' },
  { id: 'caocao', name: '曹操', title: '政治家', domain: 'history' },
]

const TECH_AGENTS: AgentCard[] = [
  { id: 'musk', name: '马斯克', title: '科技企业家', domain: 'tech' },
  { id: 'jobs', name: '乔布斯', title: '产品大师', domain: 'tech' },
  { id: 'einstein', name: '爱因斯坦', title: '物理学家', domain: 'tech' },
  { id: 'turing', name: '图灵', title: '计算机科学家', domain: 'tech' },
  { id: 'mayun', name: '马云', title: '商业领袖', domain: 'tech' },
]

const ALL_AGENTS = [...HISTORY_AGENTS, ...TECH_AGENTS]

const AGENT_COLORS: Record<string, string> = {
  simaqian: '#8B4513', zhugeliang: '#2E8B57', licheng: '#B8860B',
  confucius: '#556B2F', caocao: '#8B0000',
  musk: '#007AFF', jobs: '#5856D6', einstein: '#1E90FF',
  turing: '#4169E1', mayun: '#FF9500',
}

export default function CreateRoomModal({ isOpen, onClose }: CreateRoomModalProps) {
  const [topic, setTopic] = useState('')
  const [activeTab, setActiveTab] = useState<Domain>('history')
  const [selected, setSelected] = useState<AgentCard[]>([])
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (!isOpen) {
      setTopic(''); setSelected([]); setLoading(false); setActiveTab('history')
    }
  }, [isOpen])

  if (!isOpen) return null

  const currentAgents = activeTab === 'history' ? HISTORY_AGENTS : TECH_AGENTS

  const toggleAgent = (ag: AgentCard) => {
    if (selected.find(s => s.id === ag.id)) {
      setSelected(selected.filter(s => s.id !== ag.id))
    } else {
      setSelected([...selected, ag])
    }
  }

  const handleSubmit = async () => {
    if (!topic.trim() || selected.length < 2) return
    telemetry('room:create:submit', { topic, agentCount: selected.length, agents: selected.map(a => a.name) });
    setLoading(true)
    try {
      const res = await fetch('http://localhost:7001/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          agentADomain: selected[0].name,
          agentBDomain: selected[1].name,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        telemetry('room:create:error', { status: res.status, error: err.error || res.statusText });
        return;
      }
      const room = await res.json()
      telemetry('room:create:ok', { roomId: room.id, topic });
      onClose()
      router.push(`/room/${room.id}`)
    } catch (err) {
      telemetry('room:create:error', { error: String(err) });
    } finally {
      setLoading(false);
    }
  }

  const color = (id: string) => AGENT_COLORS[id] || '#666'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-apple-text">发起新讨论</h1>
            <p className="text-apple-secondary mt-1">选择 Agent，开启多视角协作</p>
          </div>
          <button onClick={onClose} className="text-apple-secondary hover:text-apple-text transition-colors text-sm">
            取消
          </button>
        </div>

        {/* Domain Tabs */}
        <div className="flex gap-1 mb-5 bg-apple-bg rounded-xl p-1">
          {(['history', 'tech'] as Domain[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                activeTab === tab
                  ? 'bg-white text-apple-primary shadow-sm'
                  : 'text-apple-secondary hover:text-apple-text'
              }`}
            >
              {tab === 'history' ? '历史领域' : '科技领域'}
            </button>
          ))}
        </div>

        {/* Agent Cards */}
        <div className="grid grid-cols-5 gap-2 mb-5">
          {currentAgents.map(ag => {
            const isSelected = !!selected.find(s => s.id === ag.id)
            return (
              <button
                key={ag.id}
                onClick={() => toggleAgent(ag)}
                className={`flex flex-col items-center p-3 rounded-2xl border-2 transition-all ${
                  isSelected
                    ? 'border-apple-primary bg-apple-primary/5'
                    : 'border-apple-border bg-white hover:border-apple-primary/50 hover:bg-apple-bg'
                }`}
              >
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white text-base font-bold mb-2"
                  style={{ backgroundColor: color(ag.id) }}
                >
                  {ag.name.slice(0, 1)}
                </div>
                <p className="text-sm font-semibold text-apple-text">{ag.name}</p>
                <p className="text-xs text-apple-secondary">{ag.title}</p>
              </button>
            )
          })}
        </div>

        {/* Selected Summary */}
        <div className="mb-5">
          <p className="text-sm font-semibold text-apple-text mb-2">
            已选 {selected.length} 位 Agent {selected.length < 2 ? '（至少选 2 位）' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {selected.map(ag => (
              <div
                key={ag.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm"
                style={{ backgroundColor: color(ag.id) + '20', border: `1.5px solid ${color(ag.id)}` }}
              >
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: color(ag.id) }}>
                  {ag.name.slice(0, 1)}
                </div>
                <span className="font-medium" style={{ color: color(ag.id) }}>{ag.name}</span>
                <button onClick={() => toggleAgent(ag)} className="ml-1 opacity-50 hover:opacity-100">×</button>
              </div>
            ))}
            {selected.length === 0 && (
              <p className="text-sm text-apple-secondary">点击上方卡片选择 Agent</p>
            )}
          </div>
        </div>

        {/* Topic */}
        <div className="mb-5">
          <label className="block text-sm font-semibold text-apple-text mb-2">讨论议题</label>
          <textarea
            className="w-full bg-apple-bg rounded-xl px-4 py-3 text-apple-text placeholder-apple-secondary resize-none focus:outline-none focus:ring-2 focus:ring-apple-primary"
            rows={2}
            placeholder="例如：折叠屏手机是否是未来趋势？"
            value={topic}
            onChange={e => setTopic(e.target.value)}
          />
        </div>

        {/* Submit */}
        <button
          className="w-full bg-apple-primary text-white font-semibold py-4 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
          onClick={handleSubmit}
          disabled={loading || selected.length < 2 || !topic.trim()}
        >
          {loading ? '创建中...' : '开始讨论'}
        </button>
      </div>
    </div>
  )
}
