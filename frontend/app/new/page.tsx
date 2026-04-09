'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function NewRoomPage() {
  const [topic, setTopic] = useState('')
  const [agentA, setAgentA] = useState('')
  const [agentB, setAgentB] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async () => {
    if (!topic.trim() || !agentA.trim() || !agentB.trim()) return
    setLoading(true)
    const res = await fetch('http://localhost:3004/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, agentADomain: agentA, agentBDomain: agentB }),
    })
    const room = await res.json()
    router.push(`/room/${room.id}`)
  }

  return (
    <main className="min-h-screen bg-apple-bg flex items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        <div className="bg-white rounded-3xl shadow-lg p-10">
          <h1 className="text-3xl font-bold text-apple-text mb-2">AI 智囊团</h1>
          <p className="text-apple-secondary mb-8">发起一场多 Agent 协作讨论</p>

          <div className="space-y-6">
            {/* Topic */}
            <div>
              <label className="block text-sm font-semibold text-apple-text mb-2">讨论议题</label>
              <textarea
                className="w-full bg-apple-bg rounded-xl px-4 py-3 text-apple-text placeholder-apple-secondary resize-none focus:outline-none focus:ring-2 focus:ring-apple-primary"
                rows={3}
                placeholder="例如：苹果应该坚持出折叠屏吗？"
                value={topic}
                onChange={e => setTopic(e.target.value)}
              />
            </div>

            {/* Agent A */}
            <div>
              <label className="block text-sm font-semibold text-apple-text mb-2">
                <span className="inline-block w-3 h-3 rounded-full bg-apple-green mr-2"></span>
                Agent A 领域
              </label>
              <input
                className="w-full bg-apple-bg rounded-xl px-4 py-3 text-apple-text placeholder-apple-secondary focus:outline-none focus:ring-2 focus:ring-apple-green"
                placeholder="例如：技术分析师 / 历史学家 / 经济学家"
                value={agentA}
                onChange={e => setAgentA(e.target.value)}
              />
            </div>

            {/* Agent B */}
            <div>
              <label className="block text-sm font-semibold text-apple-text mb-2">
                <span className="inline-block w-3 h-3 rounded-full bg-apple-orange mr-2"></span>
                Agent B 领域
              </label>
              <input
                className="w-full bg-apple-bg rounded-xl px-4 py-3 text-apple-text placeholder-apple-secondary focus:outline-none focus:ring-2 focus:ring-apple-orange"
                placeholder="例如：市场专家 / 社会学家 / 设计师"
                value={agentB}
                onChange={e => setAgentB(e.target.value)}
              />
            </div>

            <button
              className="w-full bg-apple-primary text-white font-semibold py-4 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
              onClick={handleSubmit}
              disabled={loading || !topic || !agentA || !agentB}
            >
              {loading ? '创建中...' : '开始讨论'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
