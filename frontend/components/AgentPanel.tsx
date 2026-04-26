'use client'

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Check, ChevronDown, Clock3, Copy, Crown, GripVertical, Users, X } from 'lucide-react'
import { AgentAvatar } from './AgentAvatar'
import { AGENT_COLORS, DEFAULT_AGENT_COLOR, type Agent, type SessionTelemetry } from '../lib/agents'
import { formatCompactTokenCount, formatLatencyMs, getRemainingContextRatio } from '../lib/telemetry'
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
  sessionTelemetryByAgent?: Record<string, SessionTelemetry>
  stoppingAgentIds?: Set<string>
  onStopAgent?: (agent: Agent) => Promise<void> | void
  isMobileOpen?: boolean
  onMobileClose?: () => void
  desktopWidth?: number
  desktopCollapsed?: boolean
  onDesktopWidthChange?: (width: number) => void
}

// ── Section 1: Compact agent card ─────────────────────────────────────────────
function AgentItem({
  agent,
  sessionTelemetry,
  stoppingAgentIds,
  onStopAgent,
}: {
  agent: Agent
  sessionTelemetry?: SessionTelemetry
  stoppingAgentIds?: Set<string>
  onStopAgent?: (agent: Agent) => Promise<void> | void
}) {
  const isBusy = agent.status === 'thinking' || agent.status === 'waiting'
  const stopping = stoppingAgentIds?.has(agent.id) ?? false
  const statusMeta = agent.status === 'thinking'
    ? { label: '执行中', className: 'tone-success-pill border', dotClassName: 'tone-success-dot animate-pulse' }
    : agent.status === 'waiting'
      ? { label: '等待中', className: 'tone-warning-pill border', dotClassName: 'bg-[color:var(--warning)] opacity-80' }
      : agent.status === 'done'
        ? { label: '已结束', className: 'bg-surface text-ink-soft border border-line', dotClassName: 'bg-ink-soft/35' }
        : { label: '待命', className: 'bg-surface text-ink-soft border border-line', dotClassName: 'bg-ink-soft/40' }
  const isManager = agent.role === 'MANAGER'
  const avatarColors = AGENT_COLORS[agent.name] ?? DEFAULT_AGENT_COLOR
  const hasSessionTelemetry = Boolean(sessionTelemetry)
  const contextHealth = sessionTelemetry?.contextHealth
  const headerStatusLabel = contextHealth
    ? '有上下文快照'
    : hasSessionTelemetry
      ? '会话中'
      : statusMeta.label
  const headerStatusDotClassName = contextHealth
    ? 'bg-[color:var(--success)]'
    : hasSessionTelemetry
      ? 'bg-[color:var(--accent)]'
      : statusMeta.dotClassName

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

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-ink">{agent.name}</p>
              <div className="mt-1 inline-flex max-w-full items-center gap-1.5 text-[11px] text-ink-soft/72">
                <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${headerStatusDotClassName}`} />
                <span className="truncate">{headerStatusLabel}</span>
              </div>
            </div>
            {sessionTelemetry ? (
              <div className="shrink-0">
                <TelemetryRingTrigger telemetry={sessionTelemetry} />
              </div>
            ) : isManager ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium tone-warning-pill border">
                <Crown className="h-3 w-3" />
                主持
              </span>
            ) : null}
          </div>

          {((isBusy && !isManager && onStopAgent) || (agent.domainLabel && !hasSessionTelemetry)) ? (
            <div className="flex items-center gap-2 flex-wrap">
              {agent.domainLabel && !hasSessionTelemetry ? (
                <span className="truncate text-[10px] text-ink-soft/58">{agent.domainLabel}</span>
              ) : null}
              {isBusy && !isManager && onStopAgent ? (
                <button
                  type="button"
                  onClick={() => { void onStopAgent(agent) }}
                  disabled={stopping}
                  className="inline-flex items-center rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-medium text-ink transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {stopping ? '停止中…' : '停止'}
                </button>
              ) : null}
            </div>
          ) : null}

          {!sessionTelemetry ? (
            <div className="border-t border-line/70 pt-2">
              <div className="rounded-2xl border border-dashed border-line bg-surface-muted/45 px-3 py-2 text-[11px] text-ink-soft/70">
                等待首轮上下文遥测…
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ContextRing({
  contextHealth,
  size = 52,
  label = true,
}: {
  contextHealth: NonNullable<SessionTelemetry['contextHealth']>
  size?: number
  label?: boolean
}) {
  const strokeWidth = size >= 60 ? 6 : 5
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const remainingRatio = getRemainingContextRatio(contextHealth)
  const strokeDashoffset = circumference * (1 - remainingRatio)
  const strokeColor = contextHealth.state === 'danger'
    ? 'var(--danger)'
    : contextHealth.state === 'warn'
      ? 'var(--warning)'
      : 'var(--success)'

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="color-mix(in srgb, var(--line) 85%, transparent)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className={`${size >= 60 ? 'text-[13px]' : 'text-[12px]'} font-semibold text-ink`}>{contextHealth.leftPct}%</span>
        {label ? (
          <span className="text-[9px] uppercase tracking-[0.16em] text-ink-soft/70">left</span>
        ) : null}
      </div>
    </div>
  )
}

function TelemetryRingTrigger({
  telemetry,
}: {
  telemetry?: SessionTelemetry
}) {
  const [detailsPinned, setDetailsPinned] = useState(false)
  const [hoverActive, setHoverActive] = useState(false)
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const hoverCloseTimeoutRef = useRef<number | null>(null)
  const contextHealth = telemetry?.contextHealth

  const clearHoverCloseTimeout = useCallback(() => {
    if (hoverCloseTimeoutRef.current !== null) {
      window.clearTimeout(hoverCloseTimeoutRef.current)
      hoverCloseTimeoutRef.current = null
    }
  }, [])

  const syncAnchorRect = useCallback(() => {
    if (!triggerRef.current) return
    setAnchorRect(triggerRef.current.getBoundingClientRect())
  }, [])

  const handleHoverEnter = useCallback(() => {
    clearHoverCloseTimeout()
    syncAnchorRect()
    setHoverActive(true)
  }, [clearHoverCloseTimeout, syncAnchorRect])

  const handleHoverLeave = useCallback(() => {
    clearHoverCloseTimeout()
    hoverCloseTimeoutRef.current = window.setTimeout(() => {
      setHoverActive(false)
    }, 120)
  }, [clearHoverCloseTimeout])

  useEffect(() => {
    setPortalRoot(document.body)
  }, [])

  useEffect(() => () => {
    if (hoverCloseTimeoutRef.current !== null) {
      window.clearTimeout(hoverCloseTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    const detailsVisible = detailsPinned || hoverActive
    if (!detailsVisible) return

    const updatePosition = () => syncAnchorRect()
    updatePosition()

    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [detailsPinned, hoverActive, syncAnchorRect])

  useEffect(() => {
    if (!detailsPinned) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setDetailsPinned(false)
        setHoverActive(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [detailsPinned])

  useEffect(() => {
    if (!detailsPinned) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setDetailsPinned(false)
        setHoverActive(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [detailsPinned])

  if (!telemetry) {
    return (
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface-muted text-[10px] font-semibold text-ink-soft/70">
        --
      </div>
    )
  }

  const detailsVisible = detailsPinned || hoverActive

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={detailsVisible}
        aria-label={detailsVisible ? '收起 telemetry 详情' : '展开 telemetry 详情'}
        onClick={() => {
          clearHoverCloseTimeout()
          syncAnchorRect()
          if (detailsPinned) {
            setDetailsPinned(false)
            setHoverActive(false)
            return
          }
          setHoverActive(true)
          setDetailsPinned(true)
        }}
        onMouseEnter={handleHoverEnter}
        onMouseLeave={handleHoverLeave}
        className="group relative inline-flex h-[60px] w-[60px] items-center justify-center rounded-full transition-transform hover:scale-[1.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        title={contextHealth ? `Context left ${contextHealth.leftPct}%` : 'Context telemetry pending'}
      >
        {contextHealth ? (
          <ContextRing contextHealth={contextHealth} size={56} />
        ) : (
          <div className="flex h-[56px] w-[56px] items-center justify-center rounded-full border border-dashed border-line bg-surface text-[13px] font-semibold text-ink-soft/60 shadow-sm">
            --
          </div>
        )}
      </button>
      <TelemetryPopover
        telemetry={telemetry}
        visible={detailsVisible}
        anchorRect={anchorRect}
        portalRoot={portalRoot}
        popoverRef={popoverRef}
        onMouseEnter={handleHoverEnter}
        onMouseLeave={handleHoverLeave}
        onRequestClose={() => {
          clearHoverCloseTimeout()
          setDetailsPinned(false)
          setHoverActive(false)
        }}
      />
    </div>
  )
}

function TelemetryPopover({
  telemetry,
  visible,
  anchorRect,
  portalRoot,
  popoverRef,
  onMouseEnter,
  onMouseLeave,
  onRequestClose,
}: {
  telemetry: SessionTelemetry
  visible: boolean
  anchorRect: DOMRect | null
  portalRoot: HTMLElement | null
  popoverRef: MutableRefObject<HTMLDivElement | null>
  onMouseEnter: () => void
  onMouseLeave: () => void
  onRequestClose: () => void
}) {
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [copied, setCopied] = useState(false)
  const invocationUsage = telemetry.invocationUsage
  const contextHealth = telemetry.contextHealth
  const providerLabel = invocationUsage?.provider ?? invocationUsage?.model ?? 'Session'
  const modelLabel = invocationUsage?.model && invocationUsage.model !== invocationUsage.provider
    ? invocationUsage.model
    : undefined

  useEffect(() => {
    if (!visible || !anchorRect || !popoverRef.current) return

    const updatePosition = () => {
      const node = popoverRef.current
      if (!node) return

      const margin = 16
      const gap = 12
      const width = node.offsetWidth
      const height = node.offsetHeight
      const maxLeft = Math.max(margin, window.innerWidth - margin - width)
      const preferredLeft = anchorRect.right - width
      const left = Math.min(Math.max(preferredLeft, margin), maxLeft)
      let top = anchorRect.bottom + gap

      if (top + height > window.innerHeight - margin) {
        top = Math.max(margin, anchorRect.top - gap - height)
      }

      setPosition({ top, left })
    }

    updatePosition()
    const rafId = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRect, popoverRef, visible])

  useEffect(() => {
    if (!copied) return
    const timeoutId = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(timeoutId)
  }, [copied])

  if (!visible || !portalRoot || !anchorRect) return null

  const fallbackTop = anchorRect.bottom + 12
  const fallbackLeft = Math.max(16, anchorRect.right - 320)

  async function handleCopySessionId() {
    try {
      await navigator.clipboard.writeText(telemetry.sessionId)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return createPortal((
    <div className="fixed inset-0 z-[260] pointer-events-none">
      <div
        ref={(node) => {
          popoverRef.current = node
        }}
        className="pointer-events-auto absolute w-[min(21rem,calc(100vw-1.5rem))] select-text overflow-hidden rounded-[28px] border border-line transition-[opacity,transform] duration-150"
        style={{
          top: position.top || fallbackTop,
          left: position.left || fallbackLeft,
          background: 'linear-gradient(180deg, var(--panel) 0%, color-mix(in srgb, var(--panel) 88%, var(--panel-muted)) 100%)',
          boxShadow: '0 28px 70px rgba(18, 14, 11, 0.22), 0 10px 28px rgba(18, 14, 11, 0.12)',
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className="pointer-events-none absolute inset-[1px] rounded-[27px] bg-[linear-gradient(180deg,rgba(255,255,255,0.36),transparent_28%)] opacity-70 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent_24%)]" />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
          background: [
              'linear-gradient(135deg, color-mix(in srgb, var(--accent) 6%, transparent) 0%, transparent 48%)',
            ].join(', '),
          }}
        />
        <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--line)_78%,transparent),transparent)]" />
        <div className="relative z-10 p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft/46">上下文详情</p>
              <p className="mt-2 text-[13px] text-ink-soft/72">
                {contextHealth
                  ? `${formatCompactTokenCount(contextHealth.leftTokens)} left · ${formatCompactTokenCount(contextHealth.windowSize)} window`
                  : '等待窗口快照'}
              </p>
            </div>
            <button
              type="button"
              onClick={onRequestClose}
              className="rounded-full border border-line bg-surface p-1.5 text-ink-soft shadow-sm transition-colors hover:border-accent/30 hover:bg-surface-muted hover:text-ink"
              aria-label="收起 telemetry 详情"
              title="收起"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 space-y-2.5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TelemetryInfoCard
                label="服务"
                value={providerLabel}
                secondaryValue={modelLabel}
              />
              <TelemetryInfoCard
                label="窗口"
                value={contextHealth
                  ? `${formatCompactTokenCount(contextHealth.windowSize)}`
                  : '待补充'}
                secondaryValue={contextHealth ? `${formatCompactTokenCount(contextHealth.usedTokens)} used` : undefined}
              />
              {typeof invocationUsage?.inputTokens === 'number' && invocationUsage.inputTokens > 0 ? (
                <TelemetryInfoCard
                  label="Last In"
                  value={formatCompactTokenCount(invocationUsage.inputTokens)}
                  icon={<ArrowDown className="h-3.5 w-3.5" />}
                />
              ) : null}
              {typeof invocationUsage?.outputTokens === 'number' && invocationUsage.outputTokens > 0 ? (
                <TelemetryInfoCard
                  label="Last Out"
                  value={formatCompactTokenCount(invocationUsage.outputTokens)}
                  icon={<ArrowUp className="h-3.5 w-3.5" />}
                />
              ) : null}
              {typeof invocationUsage?.latencyMs === 'number' && invocationUsage.latencyMs > 0 ? (
                <TelemetryInfoCard
                  label="Latency"
                  value={formatLatencyMs(invocationUsage.latencyMs)}
                  icon={<Clock3 className="h-3.5 w-3.5" />}
                />
              ) : null}
            </div>

            <div
              className="rounded-[22px] border border-line px-3 py-2.5 shadow-[0_12px_28px_rgba(0,0,0,0.10)]"
              style={{
                background: 'linear-gradient(180deg, color-mix(in srgb, var(--surface) 98%, var(--panel)) 0%, color-mix(in srgb, var(--surface-muted) 88%, var(--panel)) 100%)',
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft/52">会话 ID</span>
                <button
                  type="button"
                  onClick={() => { void handleCopySessionId() }}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-ink-soft transition-colors hover:border-accent/35 hover:text-accent"
                  title="复制 session id"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              <p className="mt-2 break-all font-mono text-[11px] leading-5 text-ink">
                {telemetry.sessionId}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  ), portalRoot)
}

function TelemetryInfoCard({
  label,
  value,
  secondaryValue,
  icon,
}: {
  label: string
  value: string
  secondaryValue?: string
  icon?: ReactNode
}) {
  return (
    <div
      className="rounded-[18px] border border-line px-3 py-2.5 shadow-[0_12px_24px_rgba(0,0,0,0.10)]"
      style={{
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--surface) 98%, var(--panel)) 0%, color-mix(in srgb, var(--surface-muted) 90%, var(--panel)) 100%)',
      }}
    >
      <div className="flex items-center gap-2">
        {icon ? (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-soft shadow-sm">
            {icon}
          </span>
        ) : null}
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft/52">
          {label}
        </span>
      </div>
      <p className="mt-2 text-[14px] font-semibold leading-5 text-ink">{value}</p>
      {secondaryValue ? (
        <p className="mt-1 text-[10px] leading-4 text-ink-soft/66 break-all">{secondaryValue}</p>
      ) : null}
    </div>
  )
}

// ── AgentPanel ────────────────────────────────────────────────────────────────
export function AgentPanel({
  roomId,
  agents,
  workspace,
  skillSummary,
  sessionTelemetryByAgent,
  stoppingAgentIds,
  onStopAgent,
  isMobileOpen,
  onMobileClose,
  desktopWidth = 240,
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
              <PanelContent
                roomId={roomId}
                agents={agents}
                workspace={workspace}
                skillSummary={skillSummary}
                sessionTelemetryByAgent={sessionTelemetryByAgent}
                stoppingAgentIds={stoppingAgentIds}
                onStopAgent={onStopAgent}
              />
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
              <PanelContent
                roomId={roomId}
                agents={agents}
                workspace={workspace}
                skillSummary={skillSummary}
                sessionTelemetryByAgent={sessionTelemetryByAgent}
                stoppingAgentIds={stoppingAgentIds}
                onStopAgent={onStopAgent}
              />
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
  sessionTelemetryByAgent,
  stoppingAgentIds,
  onStopAgent,
}: {
  roomId?: string
  agents: Agent[]
  workspace?: string
  skillSummary?: RoomSkillSummary
  sessionTelemetryByAgent?: Record<string, SessionTelemetry>
  stoppingAgentIds?: Set<string>
  onStopAgent?: (agent: Agent) => Promise<void> | void
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
        <h2 className="pt-0.5 text-title text-ink">本房成员</h2>
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
              <AgentItem
                key={agent.id}
                agent={agent}
                sessionTelemetry={sessionTelemetryByAgent?.[agent.configId ?? agent.name]}
                stoppingAgentIds={stoppingAgentIds}
                onStopAgent={onStopAgent}
              />
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
