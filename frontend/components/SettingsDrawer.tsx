'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Play, Server, Users, Trash2, Edit2, Check, CheckCircle2 } from 'lucide-react'

const API = 'http://localhost:7001'

type ProviderName = 'claude-code' | 'opencode'

interface ProviderConfig {
  name: string
  label: string
  cliPath: string
  defaultModel: string
  apiKey: string
  baseUrl: string
  timeout: number
  thinking: boolean
  lastTested: number | null
  lastTestResult: { success: boolean; version?: string; error?: string } | null
}

interface AgentConfig {
  id: string
  name: string
  roleLabel: string
  role: 'MANAGER' | 'WORKER'
  provider: ProviderName
  providerOpts: { model?: string; thinking?: boolean; [key: string]: unknown }
  systemPrompt: string
  enabled: boolean
}

const PROVIDER_LABELS: Record<ProviderName, string> = {
  'claude-code': 'Claude Code',
  'opencode': 'OpenCode',
}

function ProviderTab({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API}/api/providers`)
      .then(r => r.json())
      .then((data: Record<string, ProviderConfig>) => {
        setProviders(data)
        if (!selected && Object.keys(data).length > 0) setSelected(Object.keys(data)[0])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const current = selected ? providers[selected] : null

  return (
    <div className="flex flex-col md:flex-row gap-6 h-full">
      <div className="w-full md:w-[200px] flex-shrink-0 flex flex-col gap-2">
        {loading ? (
          <p className="text-[13px] text-ink-soft">加载中…</p>
        ) : (
          Object.values(providers).map(p => (
            <button
              key={p.name}
              onClick={() => setSelected(p.name)}
              className={`w-full text-left px-4 py-3 rounded-xl transition-all text-[14px] font-medium border ${
                selected === p.name
                  ? 'bg-surface border-accent text-accent shadow-sm'
                  : 'bg-bg border-line text-ink hover:bg-surface-muted'
              }`}
            >
              {p.label}
            </button>
          ))
        )}
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        {current ? (
          <ProviderForm key={current.name} provider={current} />
        ) : (
          <div className="h-full flex items-center justify-center text-ink-soft text-[14px]">
            请在左侧选择一个 Provider
          </div>
        )}
      </div>
    </div>
  )
}

function ProviderForm({ provider }: { provider: ProviderConfig }) {
  const [testDetail, setTestDetail] = useState<{ cli: string; output?: string; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => { setTestDetail(null) }, [provider])

  function handleTest() {
    setTesting(true)
    fetch(`${API}/api/providers/${provider.name}/test`, { method: 'POST' })
      .then(r => r.json())
      .then((result: { success: boolean; cli: string; output?: string; error?: string }) => {
        setTestDetail({ cli: result.cli, output: result.output, error: result.error })
        setTesting(false)
      })
      .catch(err => {
        setTestDetail({ cli: '', error: err.message })
        setTesting(false)
      })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-surface rounded-xl border border-line p-5">
        <h3 className="text-[15px] font-bold text-ink mb-1">{provider.label}</h3>
        <p className="text-[13px] text-ink-soft mb-4">测试基础连接和流式输出。</p>
        
        <button onClick={handleTest} disabled={testing}
          className="w-full py-3 text-[14px] bg-ink text-bg rounded-xl hover:opacity-90 disabled:opacity-50 transition-all font-bold flex items-center justify-center gap-2 shadow-sm active:scale-[0.99]">
          <Play className="w-4 h-4 fill-current" />
          {testing ? '测试中…' : (testDetail ? '重新测试' : '测试连接')}
        </button>
      </div>

      {testDetail && (
        <div className="border border-line rounded-xl overflow-hidden shadow-sm">
          <div className="bg-[#1e1e1e] px-4 py-2 font-mono text-[12px] text-gray-400 border-b border-[#333]">
            命令
          </div>
          <div className="bg-[#1e1e1e] px-4 py-3 font-mono text-[13px] text-emerald-400 whitespace-pre-wrap break-all">
            {testDetail.cli}
          </div>
          <div className="bg-[#1e1e1e] px-4 py-2 font-mono text-[12px] border-t border-[#333] flex items-center gap-2">
            输出状态: {testDetail.error
              ? <span className="text-red-400 flex items-center gap-1"><X className="w-3 h-3"/> {testDetail.error}</span>
              : <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> 成功</span>}
          </div>
          {testDetail.output && (
            <div className="bg-[#1e1e1e] px-4 py-3 font-mono text-[13px] text-emerald-300/90 whitespace-pre-wrap break-all border-t border-[#333] max-h-60 overflow-y-auto custom-scrollbar">
              {testDetail.output}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AgentTab() {
  const router = useRouter()
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-surface rounded-2xl border border-line">
      <Users className="w-12 h-12 text-ink-soft mb-4" />
      <h3 className="text-lg font-bold text-ink mb-2">Agent 高级配置</h3>
      <p className="text-[14px] text-ink-soft mb-6 max-w-md">
        我们已将 Agent 管理移动到专门的配置页面，以便提供更丰富的功能和更好的体验。
      </p>
      <button 
        onClick={() => router.push('/settings/agents')}
        className="bg-accent text-white px-6 py-3 rounded-xl font-bold hover:bg-accent-deep transition-all shadow-sm active:scale-[0.99]"
      >
        前往 Agent 管理中心 →
      </button>
    </div>
  )
}

export default function SettingsDrawer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [tab, setTab] = useState<'provider' | 'agent'>('provider')

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity" onClick={onClose} />

      <div className="fixed right-0 top-0 bottom-0 w-full md:w-[720px] bg-bg border-l border-line shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between px-6 py-4 bg-nav-bg backdrop-blur-xl border-b border-line">
          <div className="flex gap-2 bg-surface-muted rounded-xl p-1.5 border border-line">
            <button
              onClick={() => setTab('provider')}
              className={`px-4 py-1.5 rounded-lg text-[13px] font-bold transition-all flex items-center gap-2 ${
                tab === 'provider' ? 'bg-bg shadow-sm text-ink' : 'text-ink-soft hover:text-ink'
              }`}
            >
              <Server className="w-4 h-4" /> Provider
            </button>
            <button
              onClick={() => setTab('agent')}
              className={`px-4 py-1.5 rounded-lg text-[13px] font-bold transition-all flex items-center gap-2 ${
                tab === 'agent' ? 'bg-bg shadow-sm text-ink' : 'text-ink-soft hover:text-ink'
              }`}
            >
              <Users className="w-4 h-4" /> Agents
            </button>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-ink-soft hover:text-ink hover:bg-surface transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden p-6 md:p-8">
          {tab === 'provider' ? <ProviderTab onClose={onClose} /> : <AgentTab />}
        </div>
      </div>
    </>
  )
}
