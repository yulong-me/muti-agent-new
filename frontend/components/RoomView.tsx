'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'

import { API_URL } from '@/lib/api'
import { debug, info, warn } from '@/lib/logger'
import type { Agent } from '@/lib/agents'
import CreateRoomModal from './CreateRoomModal'
import SettingsModal from './SettingsModal'
import { RoomListSidebarDesktop, RoomListSidebarMobile } from './RoomListSidebar'
import { AgentPanel } from './AgentPanel'
import { AgentInviteDrawer } from './AgentInviteDrawer'
import { MessageList } from './MessageList'
import type { RoomComposerHandle } from './RoomComposer'
import { RoomActionArea } from './room-view/RoomActionArea'
import { RoomHeader } from './room-view/RoomHeader'
import { useRoomList } from './room-view/useRoomList'
import { useRoomMessaging } from './room-view/useRoomMessaging'
import { useRoomRealtime } from './room-view/useRoomRealtime'

const API = API_URL

interface RoomViewProps {
  roomId?: string
  defaultCreateOpen?: boolean
}

const AGENT_PANEL_DEFAULT_WIDTH = 320
const AGENT_PANEL_MIN_WIDTH = 280
const AGENT_PANEL_MAX_WIDTH = 560
const AGENT_PANEL_WIDTH_KEY = 'opencouncil.agent-panel-width'
const AGENT_PANEL_COLLAPSED_KEY = 'opencouncil.agent-panel-collapsed'

function clampAgentPanelWidth(width: number) {
  return Math.min(AGENT_PANEL_MAX_WIDTH, Math.max(AGENT_PANEL_MIN_WIDTH, Math.round(width)))
}

export default function RoomView({ roomId, defaultCreateOpen = false }: RoomViewProps) {
  const router = useRouter()
  const composerRef = useRef<RoomComposerHandle>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const queuedDispatchPendingRef = useRef(false)
  const userScrolledRef = useRef(false)

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(defaultCreateOpen)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<'agent' | 'provider'>('agent')
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [showInviteDrawer, setShowInviteDrawer] = useState(false)
  const [agentPanelWidth, setAgentPanelWidth] = useState(AGENT_PANEL_DEFAULT_WIDTH)
  const [agentPanelCollapsed, setAgentPanelCollapsed] = useState(false)

  const { theme, resolvedTheme, setTheme } = useTheme()
  const currentTheme = resolvedTheme ?? theme

  const { rooms, setRooms } = useRoomList()
  const {
    state,
    messages,
    agents,
    report,
    streamingAgentIds,
    messageErrorMap,
    orphanErrors,
    maxA2ADepth,
    setMaxA2ADepth,
    currentA2ADepth,
    setCurrentA2ADepth,
    effectiveMaxDepth,
    setEffectiveMaxDepth,
    workspace,
    effectiveSkills,
    globalSkillCount,
    workspaceDiscoveredCount,
  } = useRoomRealtime({ roomId, queuedDispatchPendingRef })
  const {
    sending,
    sendError,
    stoppingAgentIds,
    outgoingQueue,
    recallableQueueItemId,
    composerDraft,
    busyAgents,
    showSendError,
    setComposerDraft,
    cancelQueuedItem,
    recallQueuedItem,
    sendPreparedContent,
    restoreFailedInput,
    handleRetryFailedMessage,
    prefillMention,
    handleRecipientSelected,
    handleTryAnotherAgent,
    handleCopyFailedPrompt,
    handleStopAgent,
  } = useRoomMessaging({
    roomId,
    agents,
    streamingAgentIds,
    composerRef,
    queuedDispatchPendingRef,
    resetA2ADepth: () => setCurrentA2ADepth(0),
  })

  const displayMaxDepth = maxA2ADepth !== null ? maxA2ADepth : effectiveMaxDepth
  const currentAgentConfigIds = useMemo(
    () => agents.map(agent => agent.configId ?? ''),
    [agents],
  )
  const lastActiveWorkerId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message.agentRole !== 'WORKER') continue
      return agents.find(agent => agent.name === message.agentName)?.id ?? null
    }
    return null
  }, [messages, agents])

  const scrollMessageListToBottom = useCallback((behavior: ScrollBehavior) => {
    const el = messagesContainerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  const scrollToBottom = useCallback(() => {
    if (userScrolledRef.current) return
    scrollMessageListToBottom('auto')
  }, [scrollMessageListToBottom])

  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    userScrolledRef.current = distFromBottom > 100
    setShowScrollBtn(distFromBottom > 100)
  }, [])

  const handleScrollToBottom = useCallback(() => {
    userScrolledRef.current = false
    setShowScrollBtn(false)
    scrollMessageListToBottom('smooth')
  }, [scrollMessageListToBottom])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const storedWidth = Number.parseInt(localStorage.getItem(AGENT_PANEL_WIDTH_KEY) ?? '', 10)
    if (Number.isFinite(storedWidth)) {
      setAgentPanelWidth(clampAgentPanelWidth(storedWidth))
    }
    setAgentPanelCollapsed(localStorage.getItem(AGENT_PANEL_COLLAPSED_KEY) === '1')
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(AGENT_PANEL_WIDTH_KEY, String(agentPanelWidth))
  }, [agentPanelWidth])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(AGENT_PANEL_COLLAPSED_KEY, agentPanelCollapsed ? '1' : '0')
  }, [agentPanelCollapsed])

  useEffect(() => {
    userScrolledRef.current = false
    setShowScrollBtn(false)
  }, [roomId])

  const toggleTheme = useCallback(() => {
    info('ui:theme:toggle', { nextTheme: currentTheme === 'dark' ? 'light' : 'dark' })
    setTheme(currentTheme === 'dark' ? 'light' : 'dark')
  }, [currentTheme, setTheme])

  const openSystemSettings = useCallback(() => {
    debug('ui:settings:open', { tab: 'agent' })
    setSettingsInitialTab('agent')
    setSettingsOpen(true)
  }, [])

  const openRoom = useCallback((id: string) => {
    setMobileMenuOpen(false)
    info('ui:room:open', { roomId: id })
    router.push(`/room/${id}`, { scroll: false })
  }, [router])

  const handleArchiveRoom = useCallback(async (id: string, source: 'desktop_sidebar' | 'mobile_sidebar') => {
    info('ui:room:archive', { roomId: id, source })
    const response = await fetch(`${API}/api/rooms/${id}/archive`, { method: 'PATCH' })
    if (!response.ok) {
      warn('ui:room:archive_failed', { roomId: id, source, status: response.status })
      return
    }
    if (id === roomId) {
      router.push('/')
      return
    }
    setRooms(previous => previous.filter(room => room.id !== id))
  }, [roomId, router, setRooms])

  const handleChangeDepth = useCallback(async (newDepth: number | null) => {
    if (!roomId) return
    const previousMaxDepth = maxA2ADepth
    const previousEffectiveMaxDepth = effectiveMaxDepth
    info('ui:room:a2a_depth_change', { roomId, nextDepth: newDepth })
    setMaxA2ADepth(newDepth)
    if (newDepth !== null) {
      setEffectiveMaxDepth(newDepth)
    }
    try {
      const response = await fetch(`${API}/api/rooms/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxA2ADepth: newDepth }),
      })
      if (!response.ok) {
        throw new Error(`PATCH /api/rooms/${roomId} failed: ${response.status}`)
      }
      const data = await response.json()
      if (Object.prototype.hasOwnProperty.call(data, 'maxA2ADepth')) {
        setMaxA2ADepth(data.maxA2ADepth)
      }
      if (Object.prototype.hasOwnProperty.call(data, 'effectiveMaxDepth')) {
        setEffectiveMaxDepth(data.effectiveMaxDepth)
      }
    } catch (error) {
      warn('ui:room:a2a_depth_change_failed', { roomId, nextDepth: newDepth, error })
      setMaxA2ADepth(previousMaxDepth)
      setEffectiveMaxDepth(previousEffectiveMaxDepth)
    }
  }, [effectiveMaxDepth, maxA2ADepth, roomId, setEffectiveMaxDepth, setMaxA2ADepth])

  const handleAgentPanelWidthChange = useCallback((nextWidth: number) => {
    setAgentPanelWidth(clampAgentPanelWidth(nextWidth))
  }, [])

  const toggleAgentPanel = useCallback(() => {
    setAgentPanelCollapsed(previous => !previous)
  }, [])

  const toggleMobileMenu = useCallback(() => {
    setMobileMenuOpen(open => !open)
  }, [])

  const openAgentDrawer = useCallback(() => {
    debug('ui:agent_panel:open_mobile', { roomId })
    setAgentDrawerOpen(true)
  }, [roomId])

  const openInviteDrawer = useCallback(() => {
    debug('ui:agent_invite:open', { roomId })
    setShowInviteDrawer(true)
  }, [roomId])

  const handleDownload = useCallback(() => {
    if (!report) return
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(new Blob([report], { type: 'text/markdown' }))
    anchor.download = 'discussion-report.md'
    anchor.click()
  }, [report])

  return (
    <>
      <CreateRoomModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
      <div className="app-islands-shell h-[100dvh] flex overflow-hidden text-ink font-sans">
        <RoomListSidebarDesktop
          rooms={rooms}
          currentRoomId={roomId}
          onNewRoom={() => {
            debug('ui:room_create:open', { source: 'desktop_sidebar' })
            setIsCreateModalOpen(true)
          }}
          onSelectRoom={openRoom}
          onDeleteRoom={async id => {
            await handleArchiveRoom(id, 'desktop_sidebar')
          }}
          theme={currentTheme}
          mounted={mounted}
          onToggleTheme={toggleTheme}
          onOpenSystemSettings={openSystemSettings}
        />

        <RoomListSidebarMobile
          rooms={rooms}
          currentRoomId={roomId}
          onNewRoom={() => {
            debug('ui:room_create:open', { source: 'mobile_sidebar' })
            setIsCreateModalOpen(true)
          }}
          onSelectRoom={openRoom}
          onDeleteRoom={async id => {
            await handleArchiveRoom(id, 'mobile_sidebar')
          }}
          theme={currentTheme}
          mounted={mounted}
          onToggleTheme={toggleTheme}
          onOpenSystemSettings={openSystemSettings}
          mobileMenuOpen={mobileMenuOpen}
          onToggleMobileMenu={toggleMobileMenu}
          onCloseMobileMenu={() => setMobileMenuOpen(false)}
        />

        <div className="app-islands-panel flex-1 flex flex-col relative min-w-0">
          <RoomHeader
            roomId={roomId}
            maxA2ADepth={maxA2ADepth}
            currentA2ADepth={currentA2ADepth}
            displayMaxDepth={displayMaxDepth}
            onChangeDepth={newDepth => { void handleChangeDepth(newDepth) }}
            onToggleMobileMenu={toggleMobileMenu}
            onOpenAgentDrawer={openAgentDrawer}
            onOpenInviteDrawer={openInviteDrawer}
            agentPanelCollapsed={agentPanelCollapsed}
            onToggleAgentPanel={toggleAgentPanel}
          />

          <MessageList
            roomId={roomId}
            messages={messages}
            agents={agents}
            state={state}
            sending={sending}
            messageErrorMap={messageErrorMap}
            orphanErrors={orphanErrors}
            showScrollBtn={showScrollBtn}
            containerRef={messagesContainerRef}
            onScroll={handleScroll}
            onScrollToBottom={handleScrollToBottom}
            onPrefillMention={prefillMention}
            onRetryFailedMessage={handleRetryFailedMessage}
            onRestoreFailedInput={restoreFailedInput}
            onCopyFailedPrompt={handleCopyFailedPrompt}
            onTryAnotherAgent={handleTryAnotherAgent}
          />

          <RoomActionArea
            roomId={roomId}
            state={state}
            report={report}
            onDownload={handleDownload}
            busyAgents={busyAgents}
            stoppingAgentIds={stoppingAgentIds}
            onStopAgent={handleStopAgent}
            outgoingQueue={outgoingQueue}
            recallableQueueItemId={recallableQueueItemId}
            composerDraft={composerDraft}
            sending={sending}
            sendError={sendError}
            agents={agents}
            lastActiveWorkerId={lastActiveWorkerId}
            composerRef={composerRef}
            onCancelQueuedItem={cancelQueuedItem}
            onRecallQueuedItem={recallQueuedItem}
            onSend={sendPreparedContent}
            onSendError={showSendError}
            onDraftChange={setComposerDraft}
            onRecipientSelected={handleRecipientSelected}
          />
        </div>

        <AgentPanel
          roomId={roomId}
          agents={agents}
          workspace={workspace}
          skillSummary={{
            effectiveSkills,
            globalSkillCount,
            workspaceDiscoveredCount,
          }}
          isMobileOpen={agentDrawerOpen}
          onMobileClose={() => setAgentDrawerOpen(false)}
          desktopWidth={agentPanelWidth}
          desktopCollapsed={agentPanelCollapsed}
          onDesktopWidthChange={handleAgentPanelWidthChange}
        />
      </div>

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialTab={settingsInitialTab}
      />

      {showInviteDrawer && roomId && (
        <AgentInviteDrawer
          roomId={roomId}
          currentAgentIds={currentAgentConfigIds}
          onClose={() => setShowInviteDrawer(false)}
          onInvited={() => {}}
        />
      )}
    </>
  )
}
