'use client'

import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { ChevronDown, Crown, GripVertical, Users, X } from 'lucide-react'
import { AgentAvatar } from './AgentAvatar'
import { AGENT_COLORS, DEFAULT_AGENT_COLOR, type Agent } from '../lib/agents'
import { WorkspaceSidebar } from './WorkspaceSidebar'

interface RoomSkillSummary {
  effectiveSkills: Array<{
    name: string
    mode: 'auto' | 'required'
    sourceLabel: string
  }>
  globalSkillCount: number
  workspaceDiscoveredCount: number
}

interface AgentPanelProps {
  roomId?: string
  agents: Agent[]
  workspace?: string
  skillSummary?: RoomSkillSummary
  isMobileOpen?: boolean
  onMobileClose?: () => void
  desktopWidth?: number
  desktopCollapsed?: boolean
  onDesktopWidthChange?: (width: number) => void
}

// ── Section 1: Compact agent card ─────────────────────────────────────────────
function AgentItem({ agent }: { agent: Agent }) {
  const isBusy = agent.status === 'thinking' || agent.status === 'waiting'
  const statusMeta = agent.status === 'thinking'
    ? { label: '执行中', className: 'tone-success-pill border', dotClassName: 'tone-success-dot animate-pulse' }
    : agent.status === 'waiting'
      ? { label: '等待中', className: 'tone-warning-pill border', dotClassName: 'bg-[color:var(--warning)] opacity-80' }
      : agent.status === 'done'
        ? { label: '已完成', className: 'bg-surface text-ink-soft border border-line', dotClassName: 'bg-ink-soft/35' }
        : { label: '待命', className: 'bg-surface text-ink-soft border border-line', dotClassName: 'bg-ink-soft/40' }
  const isManager = agent.role === 'MANAGER'
  const avatarColors = AGENT_COLORS[agent.name] ?? DEFAULT_AGENT_COLOR

  return (
    <div className={`app-window-surface rounded-2xl border px-2.5 py-2.5 transition-all ${
      isBusy ? 'shadow-[0_12px_24px_rgba(0,0,0,0.12)]' : 'shadow-sm'
    }`}>
      <div className="flex items-start gap-2.5">
        <div className="relative mt-0.5 h-9 w-9 shrink-0 overflow-hidden rounded-xl shadow-sm">
          <AgentAvatar
            name={agent.name}
            color={avatarColors.bg}
            textColor={avatarColors.text}
            size={36}
            className="h-full w-full rounded-xl"
          />
          <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface ${statusMeta.dotClassName}`} />
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-ink">{agent.name}</p>
              <p className="truncate text-[11px] text-ink-soft/65">{agent.domainLabel || '通用协作'}</p>
            </div>
            {isManager ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium tone-warning-pill border">
                <Crown className="h-3 w-3" />
                主持
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statusMeta.className}`}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusMeta.dotClassName}`} />
              {statusMeta.label}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── AgentPanel ────────────────────────────────────────────────────────────────
export function AgentPanel({
  roomId,
  agents,
  workspace,
  skillSummary,
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
        className="relative z-20 hidden h-full shrink-0 overflow-visible transition-[width] duration-200 ease-out lg:block"
        style={{ width: desktopCollapsed ? 0 : desktopWidth }}
        aria-hidden={desktopCollapsed}
      >
        {!desktopCollapsed && (
          <>
            <button
              type="button"
              onMouseDown={handleResizeStart}
              className="absolute inset-y-0 left-0 z-10 flex w-3 -translate-x-1/2 items-center justify-center text-ink-soft/40 transition-colors hover:text-accent"
              aria-label="调整讨论成员面板宽度"
              title="拖拽调整面板宽度"
            >
              <GripVertical className="h-4 w-4 rounded-full bg-bg" />
            </button>
            <div className="app-islands-panel h-full flex flex-col">
              <PanelContent roomId={roomId} agents={agents} workspace={workspace} skillSummary={skillSummary} />
            </div>
          </>
        )}
      </div>

      {/* Mobile: fixed right drawer */}
      {isMobileOpen && (
        <div className="lg:hidden fixed inset-0 z-[200] flex">
          <div className="absolute inset-0 bg-[color:var(--overlay-scrim)]" onClick={onMobileClose} />
          <div className="relative z-10 ml-auto flex h-full w-[280px] flex-col border-l border-line bg-surface shadow-2xl">
            <div className="flex items-center justify-end border-b border-line px-3 py-3">
              <button
                type="button"
                onClick={onMobileClose}
                className="p-1.5 text-ink-soft hover:text-ink hover:bg-surface-muted rounded-lg transition-colors"
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <PanelContent roomId={roomId} agents={agents} workspace={workspace} skillSummary={skillSummary} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function PanelContent({
  roomId,
  agents,
  workspace,
  skillSummary,
}: {
  roomId?: string
  agents: Agent[]
  workspace?: string
  skillSummary?: RoomSkillSummary
}) {
  const [skillsCollapsed, setSkillsCollapsed] = useState(true)
  const hasSkills = Boolean(
    skillSummary &&
    (
      skillSummary.effectiveSkills.length > 0 ||
      skillSummary.globalSkillCount > 0 ||
      skillSummary.workspaceDiscoveredCount > 0
    ),
  )

  return (
    <>
      <div className="border-b border-line px-3 py-3 space-y-1.5">
        {roomId && (
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(roomId)}
            title="点击复制对话 ID"
            className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-muted px-2 py-1.5 text-[11px] text-ink-soft transition-colors cursor-pointer group w-full hover:border-accent/30 hover:text-accent"
          >
            <span className="opacity-60 group-hover:opacity-100 shrink-0">ID:</span>
            <span className="font-mono truncate group-hover:text-accent">{roomId.slice(0, 8)}…</span>
            <span className="text-[10px] opacity-40 ml-auto">📋</span>
          </button>
        )}
        <h2 className="pt-0.5 text-[15px] font-bold text-ink">讨论成员</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-2.5 space-y-2.5 custom-scrollbar">
        {agents.length === 0 ? (
          <div className="app-window-surface rounded-2xl border border-dashed px-3 py-5 text-center">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-2xl border border-line bg-surface text-ink-soft/60">
              <Users className="h-4 w-4" />
            </div>
            <p className="text-[12px] font-medium text-ink-soft">选择讨论室后显示讨论成员</p>
          </div>
        ) : (
          <div className="space-y-2">
            {agents.map(agent => (
              <AgentItem key={agent.id} agent={agent} />
            ))}
          </div>
        )}

        {hasSkills && skillSummary && (
          <section className="rounded-2xl border border-line bg-surface-muted px-2.5 py-2.5 space-y-2">
            <button
              type="button"
              onClick={() => setSkillsCollapsed(value => !value)}
              className="w-full flex items-center justify-between gap-2 px-0.5 text-left"
              aria-expanded={!skillsCollapsed}
              aria-label={skillsCollapsed ? '展开 Skills' : '收起 Skills'}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft/45">Skills</p>
              <div className="flex items-center gap-2 text-[10px] text-ink-soft/50">
                <span>{skillSummary.effectiveSkills.length}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${skillsCollapsed ? '-rotate-90' : 'rotate-0'}`} />
              </div>
            </button>
            {!skillsCollapsed && (
              <>
                <div className="flex flex-wrap gap-2">
                  {skillSummary.effectiveSkills.map(skill => (
                    <span
                      key={`${skill.name}:${skill.sourceLabel}`}
                      className={`text-[11px] px-2 py-1 rounded-lg border ${
                        skill.mode === 'required'
                          ? 'bg-accent/12 border-accent/25 text-accent'
                          : 'bg-surface border-line text-ink-soft'
                      }`}
                    >
                      {skill.name}
                      {skill.mode === 'required' ? ' · required' : ''}
                      {skill.sourceLabel === 'Global' ? ' · global' : ''}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {skillSummary.globalSkillCount > 0 && (
                    <span className="text-[11px] px-2 py-1 rounded-lg bg-surface border border-line text-ink-soft">
                      Global discovered {skillSummary.globalSkillCount}
                    </span>
                  )}
                  {skillSummary.workspaceDiscoveredCount > 0 && (
                    <span className="text-[11px] px-2 py-1 rounded-lg bg-surface border border-line text-ink-soft">
                      Workspace discovered {skillSummary.workspaceDiscoveredCount}
                    </span>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {workspace && (
          <WorkspaceSidebar workspacePath={workspace} />
        )}
      </div>
    </>
  )
}
