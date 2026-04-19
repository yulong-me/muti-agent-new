'use client'

import { useCallback, useEffect, useState } from 'react'
import { API_URL } from '@/lib/api'
import { AGENT_COLORS, DEFAULT_AGENT_COLOR, type Agent, type Message, type DiscussionState } from '../lib/agents'
import { X, Folder, File, ChevronRight, ChevronLeft } from 'lucide-react'

interface BrowseEntry {
  name: string
  path: string
  isDirectory: boolean
}

interface AgentPanelProps {
  roomId?: string
  agents: Agent[]
  messages: Message[]
  state: DiscussionState
  workspace?: string
  isMobileOpen?: boolean
  onMobileClose?: () => void
}

// ── Section 1: Compact agent card ─────────────────────────────────────────────
function AgentItem({ agent }: { agent: Agent }) {
  const isBusy = agent.status === 'thinking' || agent.status === 'waiting'
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
      <span
        className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
          isBusy
            ? 'bg-emerald-500 animate-pulse shadow-[0_0_4px_rgba(16,185,129,0.5)]'
            : 'bg-ink-soft/40'
        }`}
      />
      <span className="text-[13px] font-medium text-ink truncate">{agent.name}</span>
    </div>
  )
}

// ── Section 2: Workspace file list ────────────────────────────────────────────
function WorkspaceFiles({ workspacePath }: { workspacePath: string }) {
  const [currentPath, setCurrentPath] = useState(workspacePath)
  const [entries, setEntries] = useState<BrowseEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Reset to workspace root when workspacePath changes
  useEffect(() => { setCurrentPath(workspacePath) }, [workspacePath])

  const fetchFiles = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/browse?path=${encodeURIComponent(path)}`)
      if (!res.ok) { setError('无法读取'); return }
      const data = await res.json()
      setEntries(data.entries || [])
    } catch {
      setError('连接失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchFiles(currentPath) }, [currentPath, fetchFiles])

  const isAtRoot = currentPath === workspacePath
  const folderCount = entries.filter(e => e.isDirectory).length

  return (
    <div className="pt-3 border-t border-line">
      <div className="flex items-center gap-1.5 mb-2">
        <Folder className="w-3.5 h-3.5 text-ink-soft" />
        <span className="text-[11px] font-semibold text-ink-soft">工作目录</span>
        {/* Back button */}
        {!isAtRoot && (
          <button
            type="button"
            onClick={() => setCurrentPath(p => p.substring(0, p.lastIndexOf('/')) || workspacePath)}
            className="ml-auto p-0.5 rounded hover:bg-white/[0.06] text-ink-soft hover:text-ink transition-colors"
            title="返回上级"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Current path breadcrumb */}
      {!isAtRoot && (
        <div className="mb-1.5 px-1">
          <span className="text-[10px] text-ink-soft/60 truncate" title={currentPath}>
            …{currentPath.slice(workspacePath.length)}
          </span>
        </div>
      )}

      {loading && <p className="text-[11px] text-ink-soft/60 py-1">加载中…</p>}
      {error && <p className="text-[11px] text-red-500 py-1">{error}</p>}
      {!loading && !error && entries.length === 0 && (
        <p className="text-[11px] text-ink-soft/60 py-1">空目录</p>
      )}
      {!loading && !error && entries.length > 0 && (
        <div className="space-y-0.5 max-h-48 overflow-y-auto custom-scrollbar">
          {entries.map(entry => (
            <button
              key={entry.path}
              type="button"
              title={entry.path}
              onClick={() => {
                if (entry.isDirectory) {
                  setCurrentPath(entry.path)
                } else {
                  navigator.clipboard.writeText(entry.path)
                }
              }}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              {entry.isDirectory
                ? <Folder className="w-3.5 h-3.5 text-[#c4a882] shrink-0" />
                : <File className="w-3.5 h-3.5 text-ink-soft/40 shrink-0" />
              }
              <span className="text-[12px] text-ink truncate flex-1 text-left">{entry.name}</span>
              <ChevronRight className="w-3 h-3 text-ink-soft/30 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── AgentPanel ────────────────────────────────────────────────────────────────
export function AgentPanel({
  roomId,
  agents,
  messages,
  state,
  workspace,
  isMobileOpen,
  onMobileClose,
}: AgentPanelProps) {
  return (
    <>
      {/* Desktop: fixed right sidebar */}
      <div className="hidden lg:flex app-islands-panel w-[260px] bg-surface border-l border-line flex-col z-20 h-full shrink-0">
        <PanelContent roomId={roomId} agents={agents} workspace={workspace} />
      </div>

      {/* Mobile: fixed right drawer */}
      {isMobileOpen && (
        <div className="lg:hidden fixed inset-0 z-[200] flex">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-xl" onClick={onMobileClose} />
          <div className="relative z-10 ml-auto w-[280px] h-full bg-surface border-l border-line flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-4 py-4 border-b border-white/[0.06]">
              {roomId && (
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(roomId)}
                  className="flex items-center gap-1.5 text-[11px] text-ink-soft hover:text-accent transition-colors cursor-pointer group"
                >
                  <span className="opacity-60">ID:</span>
                  <span className="font-mono truncate group-hover:text-accent">{roomId.slice(0, 8)}…</span>
                </button>
              )}
              <h2 className="text-[15px] font-bold text-ink">参与 Agent</h2>
              <button
                type="button"
                onClick={onMobileClose}
                className="p-1.5 text-ink-soft hover:text-ink hover:bg-white/[0.06] rounded-lg transition-colors"
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              <PanelContent roomId={roomId} agents={agents} workspace={workspace} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function PanelContent({ roomId, agents, workspace }: { roomId?: string; agents: Agent[]; workspace?: string }) {
  return (
    <>
      <div className="p-5 border-b border-line space-y-1.5">
        {roomId && (
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(roomId)}
            title="点击复制对话 ID"
            className="flex items-center gap-1.5 text-[11px] text-ink-soft hover:text-accent transition-colors cursor-pointer group w-full"
          >
            <span className="opacity-60 group-hover:opacity-100 shrink-0">ID:</span>
            <span className="font-mono truncate group-hover:text-accent">{roomId.slice(0, 8)}…</span>
            <span className="text-[10px] opacity-40 ml-auto">📋</span>
          </button>
        )}
        <h2 className="text-[15px] font-bold text-ink pt-1">参与 Agent</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
        {/* Section 1: Agent list — compact dot + name */}
        <div className="space-y-0.5">
          {agents.length === 0 ? (
            <p className="text-[12px] text-ink-soft/60 text-center py-2">选择讨论室后显示参与者</p>
          ) : (
            agents.map(agent => (
              <AgentItem key={agent.id} agent={agent} />
            ))
          )}
        </div>

        {/* Section 2: Workspace files */}
        {workspace && (
          <WorkspaceFiles workspacePath={workspace} />
        )}
      </div>
    </>
  )
}
