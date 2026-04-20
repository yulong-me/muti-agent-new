'use client'

import { useCallback, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { GripVertical, X } from 'lucide-react'
import { type Agent } from '../lib/agents'
import { WorkspaceSidebar } from './WorkspaceSidebar'

interface AgentPanelProps {
  roomId?: string
  agents: Agent[]
  workspace?: string
  isMobileOpen?: boolean
  onMobileClose?: () => void
  desktopWidth?: number
  desktopCollapsed?: boolean
  onDesktopWidthChange?: (width: number) => void
}

// ── Section 1: Compact agent card ─────────────────────────────────────────────
function AgentItem({ agent }: { agent: Agent }) {
  const isBusy = agent.status === 'thinking' || agent.status === 'waiting'
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.045] px-2.5 py-2 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
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

// ── AgentPanel ────────────────────────────────────────────────────────────────
export function AgentPanel({
  roomId,
  agents,
  workspace,
  isMobileOpen,
  onMobileClose,
  desktopWidth = 320,
  desktopCollapsed = false,
  onDesktopWidthChange,
}: AgentPanelProps) {
  const dragStartRef = useRef<{ x: number; width: number } | null>(null)

  const handleResizeStart = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!onDesktopWidthChange) return
    const handleWidthChange = onDesktopWidthChange
    event.preventDefault()
    dragStartRef.current = { x: event.clientX, width: desktopWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function handleMouseMove(moveEvent: MouseEvent) {
      const start = dragStartRef.current
      if (!start) return
      handleWidthChange(start.width - (moveEvent.clientX - start.x))
    }

    function handleMouseUp() {
      dragStartRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [desktopWidth, onDesktopWidthChange])

  return (
    <>
      {/* Desktop: fixed right sidebar */}
      <div
        className={`relative hidden lg:flex flex-col z-20 h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${
          desktopCollapsed ? 'border-l-0' : 'border-l border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.065)_0%,rgba(255,255,255,0.018)_100%)] shadow-[-16px_0_36px_rgba(0,0,0,0.18)] backdrop-blur-xl'
        }`}
        style={{ width: desktopCollapsed ? 0 : desktopWidth }}
        aria-hidden={desktopCollapsed}
      >
        {!desktopCollapsed && (
          <button
            type="button"
            onMouseDown={handleResizeStart}
            className="absolute inset-y-0 left-0 z-10 flex w-3 -translate-x-1/2 items-center justify-center text-ink-soft/40 transition-colors hover:text-accent"
            aria-label="调整参与 Agent 面板宽度"
            title="拖拽调整面板宽度"
          >
            <GripVertical className="h-4 w-4 rounded-full bg-bg/70" />
          </button>
        )}
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
      <div className="border-b border-white/[0.08] px-3 py-3 space-y-1.5">
        {roomId && (
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(roomId)}
            title="点击复制对话 ID"
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.05] bg-white/[0.03] px-2 py-1.5 text-[11px] text-ink-soft transition-colors cursor-pointer group w-full hover:border-accent/20 hover:text-accent"
          >
            <span className="opacity-60 group-hover:opacity-100 shrink-0">ID:</span>
            <span className="font-mono truncate group-hover:text-accent">{roomId.slice(0, 8)}…</span>
            <span className="text-[10px] opacity-40 ml-auto">📋</span>
          </button>
        )}
        <div className="space-y-0.5 pt-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-soft/45">Room Crew</p>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-bold text-ink">参与 Agent</h2>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-ink-soft">
              {agents.length}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-2.5 space-y-2.5 custom-scrollbar">
        <section className="rounded-2xl border border-white/[0.06] bg-black/[0.08] px-2.5 py-2.5 space-y-2">
          <div className="flex items-center justify-between px-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft/45">Participants</p>
            <span className="text-[10px] text-ink-soft/50">{agents.length || 0}</span>
          </div>
          {agents.length === 0 ? (
            <p className="text-[12px] text-ink-soft/60 text-center py-2">选择讨论室后显示参与者</p>
          ) : (
            agents.map(agent => (
              <AgentItem key={agent.id} agent={agent} />
            ))
          )}
        </section>

        {workspace && (
          <WorkspaceSidebar workspacePath={workspace} />
        )}
      </div>
    </>
  )
}
