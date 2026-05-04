'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { Loader2, X } from 'lucide-react'

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
import { EmptyRoomQuickStart, type QuickStartTemplate } from './room-view/EmptyRoomQuickStart'
import { RoomActionArea } from './room-view/RoomActionArea'
import { RoomHeader } from './room-view/RoomHeader'
import { EvolutionReviewModal } from './room-view/EvolutionReviewModal'
import { useRoomList } from './room-view/useRoomList'
import { useRoomMessaging } from './room-view/useRoomMessaging'
import { useRoomRealtime } from './room-view/useRoomRealtime'
import type { EvolutionChangeDecision, EvolutionProposal } from './room-view/types'

const API = API_URL

interface RoomViewProps {
  roomId?: string
  defaultCreateOpen?: boolean
}

type EvolutionProposalStreamEvent =
  | { type: 'delta'; text: string; timestamp?: number }
  | { type: 'proposal'; proposal: EvolutionProposal }
  | { type: 'error'; error: string; code?: string }

const AGENT_PANEL_DEFAULT_WIDTH = 240
const AGENT_PANEL_MIN_WIDTH = 220
const AGENT_PANEL_MAX_WIDTH = 360
const AGENT_PANEL_WIDTH_KEY = 'opencouncil.agent-panel-width'
const AGENT_PANEL_COLLAPSED_KEY = 'opencouncil.agent-panel-collapsed'

function clampAgentPanelWidth(width: number) {
  return Math.min(AGENT_PANEL_MAX_WIDTH, Math.max(AGENT_PANEL_MIN_WIDTH, Math.round(width)))
}

function parseRoomIdFromPath(pathname: string): string | undefined {
  const match = pathname.match(/^\/room\/([^/?#]+)/)
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

function buildRoomPath(nextRoomId?: string): string {
  return nextRoomId ? `/room/${encodeURIComponent(nextRoomId)}` : '/'
}

export default function RoomView({ roomId, defaultCreateOpen = false }: RoomViewProps) {
  const composerRef = useRef<RoomComposerHandle>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const queuedDispatchPendingRef = useRef(false)
  const userScrolledRef = useRef(false)

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(defaultCreateOpen)
  const [createInitialTopic, setCreateInitialTopic] = useState<string | undefined>(undefined)
  const [createInitialTeamId, setCreateInitialTeamId] = useState<string | undefined>(undefined)
  const [createInitialWorkerIds, setCreateInitialWorkerIds] = useState<string[] | undefined>(undefined)
  const [activeRoomId, setActiveRoomId] = useState<string | undefined>(roomId)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<'team' | 'provider'>('team')
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [showInviteDrawer, setShowInviteDrawer] = useState(false)
  const [agentPanelWidth, setAgentPanelWidth] = useState(AGENT_PANEL_DEFAULT_WIDTH)
  const [agentPanelCollapsed, setAgentPanelCollapsed] = useState(false)
  const [evolutionProposals, setEvolutionProposals] = useState<EvolutionProposal[]>([])
  const [selectedEvolutionId, setSelectedEvolutionId] = useState<string | null>(null)
  const [creatingEvolutionProposal, setCreatingEvolutionProposal] = useState(false)
  const [decidingEvolutionChangeId, setDecidingEvolutionChangeId] = useState<string | null>(null)
  const [mergingEvolutionProposal, setMergingEvolutionProposal] = useState(false)
  const [rejectingEvolutionProposal, setRejectingEvolutionProposal] = useState(false)
  const [regeneratingEvolutionProposal, setRegeneratingEvolutionProposal] = useState(false)
  const [evolutionError, setEvolutionError] = useState<string | null>(null)
  const [evolutionFeedbackOpen, setEvolutionFeedbackOpen] = useState(false)
  const [evolutionFeedbackDraft, setEvolutionFeedbackDraft] = useState('')
  const [evolutionOutput, setEvolutionOutput] = useState('')

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
    teamId,
    teamVersionId,
    teamName,
    teamVersionNumber,
    effectiveSkills,
    globalSkillCount,
    workspaceDiscoveredCount,
    sessionTelemetryByAgent,
  } = useRoomRealtime({ roomId: activeRoomId, queuedDispatchPendingRef })
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
    roomId: activeRoomId,
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
  const currentRoomTopic = useMemo(
    () => rooms.find(room => room.id === activeRoomId)?.topic,
    [activeRoomId, rooms],
  )
  const lastActiveWorkerId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message.agentRole !== 'WORKER') continue
      return agents.find(agent => agent.name === message.agentName)?.id ?? null
    }
    return null
  }, [messages, agents])
  const pendingEvolutionProposals = useMemo(
    () => evolutionProposals.filter(proposal => proposal.status === 'pending' || proposal.status === 'in-review'),
    [evolutionProposals],
  )
  const activeEvolutionProposal = useMemo(
    () => evolutionProposals.find(proposal => proposal.id === selectedEvolutionId) ?? pendingEvolutionProposals[0],
    [evolutionProposals, pendingEvolutionProposals, selectedEvolutionId],
  )

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
    setActiveRoomId(roomId)
  }, [roomId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handlePopState = () => {
      setActiveRoomId(parseRoomIdFromPath(window.location.pathname))
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
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
    setEvolutionProposals([])
    setSelectedEvolutionId(null)
    setEvolutionError(null)
    setEvolutionOutput('')
  }, [activeRoomId])

  const refreshEvolutionProposals = useCallback(async () => {
    if (!activeRoomId) {
      setEvolutionProposals([])
      return []
    }
    const response = await fetch(`${API}/api/rooms/${activeRoomId}/evolution-proposals`)
    const data = await response.json().catch(() => []) as EvolutionProposal[] | { error?: string }
    if (!response.ok) {
      throw new Error(!Array.isArray(data) && data.error ? data.error : '读取改进建议失败')
    }
    const proposals = Array.isArray(data) ? data : []
    setEvolutionProposals(proposals)
    return proposals
  }, [activeRoomId])

  useEffect(() => {
    if (!activeRoomId) return
    let cancelled = false
    refreshEvolutionProposals()
      .then(() => {
        if (cancelled) return
      })
      .catch(error => {
        if (!cancelled) {
          warn('ui:evolution:list_failed', { roomId: activeRoomId, error })
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeRoomId, refreshEvolutionProposals])

  useEffect(() => {
    if (!activeRoomId) return
    const roomBusy = streamingAgentIds.size > 0 ||
      agents.some(agent => agent.status === 'thinking' || agent.status === 'waiting')
    const activityState = state === 'DONE' ? 'done' : roomBusy ? 'busy' : 'open'
    setRooms(previous => previous.map(room =>
      room.id === activeRoomId
        ? { ...room, state, activityState }
        : room,
    ))
  }, [activeRoomId, agents, setRooms, state, streamingAgentIds])

  const toggleTheme = useCallback(() => {
    info('ui:theme:toggle', { nextTheme: currentTheme === 'dark' ? 'light' : 'dark' })
    setTheme(currentTheme === 'dark' ? 'light' : 'dark')
  }, [currentTheme, setTheme])

  const openSystemSettings = useCallback(() => {
    debug('ui:settings:open', { tab: 'team' })
    setSettingsInitialTab('team')
    setSettingsOpen(true)
  }, [])

  const navigateToRoom = useCallback((nextRoomId?: string) => {
    setActiveRoomId(nextRoomId)
    if (typeof window === 'undefined') return
    const nextPath = buildRoomPath(nextRoomId)
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, '', nextPath)
    }
  }, [])

  const openRoom = useCallback((id: string) => {
    setMobileMenuOpen(false)
    info('ui:room:open', { roomId: id })
    navigateToRoom(id)
  }, [navigateToRoom])

  const handleArchiveRoom = useCallback(async (id: string, source: 'desktop_sidebar' | 'mobile_sidebar') => {
    info('ui:room:archive', { roomId: id, source })
    const response = await fetch(`${API}/api/rooms/${id}/archive`, { method: 'PATCH' })
    if (!response.ok) {
      warn('ui:room:archive_failed', { roomId: id, source, status: response.status })
      return
    }
    setRooms(previous => previous.filter(room => room.id !== id))
    if (id === activeRoomId) {
      navigateToRoom(undefined)
    }
  }, [activeRoomId, navigateToRoom, setRooms])

  const handleChangeDepth = useCallback(async (newDepth: number | null) => {
    if (!activeRoomId) return
    const previousMaxDepth = maxA2ADepth
    const previousEffectiveMaxDepth = effectiveMaxDepth
    info('ui:room:a2a_depth_change', { roomId: activeRoomId, nextDepth: newDepth })
    setMaxA2ADepth(newDepth)
    if (newDepth !== null) {
      setEffectiveMaxDepth(newDepth)
    }
    try {
      const response = await fetch(`${API}/api/rooms/${activeRoomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxA2ADepth: newDepth }),
      })
      if (!response.ok) {
        throw new Error(`PATCH /api/rooms/${activeRoomId} failed: ${response.status}`)
      }
      const data = await response.json()
      if (Object.prototype.hasOwnProperty.call(data, 'maxA2ADepth')) {
        setMaxA2ADepth(data.maxA2ADepth)
      }
      if (Object.prototype.hasOwnProperty.call(data, 'effectiveMaxDepth')) {
        setEffectiveMaxDepth(data.effectiveMaxDepth)
      }
    } catch (error) {
      warn('ui:room:a2a_depth_change_failed', { roomId: activeRoomId, nextDepth: newDepth, error })
      setMaxA2ADepth(previousMaxDepth)
      setEffectiveMaxDepth(previousEffectiveMaxDepth)
    }
  }, [activeRoomId, effectiveMaxDepth, maxA2ADepth, setEffectiveMaxDepth, setMaxA2ADepth])

  const handleAgentPanelWidthChange = useCallback((nextWidth: number) => {
    setAgentPanelWidth(clampAgentPanelWidth(nextWidth))
  }, [])

  const toggleAgentPanel = useCallback(() => {
    setAgentPanelCollapsed(previous => !previous)
  }, [])

  const toggleMobileMenu = useCallback(() => {
    setMobileMenuOpen(open => !open)
  }, [])

  const openCreateRoom = useCallback((preset?: Pick<QuickStartTemplate, 'topic' | 'teamId' | 'agentIds'>) => {
    setCreateInitialTopic(preset?.topic)
    setCreateInitialTeamId(preset?.teamId)
    setCreateInitialWorkerIds(preset?.agentIds)
    setIsCreateModalOpen(true)
  }, [])

  const closeCreateRoom = useCallback(() => {
    setIsCreateModalOpen(false)
    setCreateInitialTopic(undefined)
    setCreateInitialTeamId(undefined)
    setCreateInitialWorkerIds(undefined)
  }, [])

  const handleStartTemplate = useCallback((template: QuickStartTemplate) => {
    openCreateRoom(template)
  }, [openCreateRoom])

  const openAgentDrawer = useCallback(() => {
    debug('ui:agent_panel:open_mobile', { roomId: activeRoomId })
    setAgentDrawerOpen(true)
  }, [activeRoomId])

  const openInviteDrawer = useCallback(() => {
    debug('ui:agent_invite:open', { roomId: activeRoomId })
    setShowInviteDrawer(true)
  }, [activeRoomId])

  const handleGenerateTitleSuggestions = useCallback(async () => {
    if (!activeRoomId) return []

    info('ui:room:title_suggestions:start', { roomId: activeRoomId })
    const response = await fetch(`${API}/api/rooms/${activeRoomId}/title-suggestions`, {
      method: 'POST',
    })
    const data = await response.json().catch(() => ({})) as { titles?: string[]; error?: string }
    if (!response.ok) {
      warn('ui:room:title_suggestions:failed', {
        roomId: activeRoomId,
        status: response.status,
        error: data.error ?? 'unknown_error',
      })
      throw new Error(data.error ?? 'AI 标题生成失败，请重试')
    }

    const titles = Array.isArray(data.titles) ? data.titles.filter(title => typeof title === 'string') : []
    info('ui:room:title_suggestions:success', { roomId: activeRoomId, titleCount: titles.length })
    return titles
  }, [activeRoomId])

  const handleRenameRoom = useCallback(async (nextTopic: string) => {
    if (!activeRoomId) return

    const trimmedTopic = nextTopic.trim()
    if (!trimmedTopic) {
      throw new Error('标题不能为空')
    }

    const previousTopic = currentRoomTopic
    setRooms(previous => previous.map(room =>
      room.id === activeRoomId
        ? { ...room, topic: trimmedTopic }
        : room,
    ))

    try {
      const response = await fetch(`${API}/api/rooms/${activeRoomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: trimmedTopic }),
      })
      const data = await response.json().catch(() => ({})) as { topic?: string; error?: string }
      if (!response.ok) {
        throw new Error(data.error ?? `PATCH /api/rooms/${activeRoomId} failed: ${response.status}`)
      }

      const savedTopic = typeof data.topic === 'string' && data.topic.trim() ? data.topic.trim() : trimmedTopic
      setRooms(previous => previous.map(room =>
        room.id === activeRoomId
          ? { ...room, topic: savedTopic }
          : room,
      ))
      info('ui:room:title_update:success', { roomId: activeRoomId, topicLength: savedTopic.length })
    } catch (error) {
      warn('ui:room:title_update:failed', { roomId: activeRoomId, nextTopic: trimmedTopic, error })
      if (previousTopic) {
        setRooms(previous => previous.map(room =>
          room.id === activeRoomId
            ? { ...room, topic: previousTopic }
            : room,
        ))
      }
      throw error instanceof Error ? error : new Error('标题更新失败，请重试')
    }
  }, [activeRoomId, currentRoomTopic, setRooms])

  function handleEvolutionStreamEvent(event: EvolutionProposalStreamEvent): EvolutionProposal | null {
    if (event.type === 'delta') {
      setEvolutionOutput(previous => `${previous}${event.text}`)
      return null
    }
    if (event.type === 'proposal') {
      return event.proposal
    }
    throw new Error(event.error || '生成改进建议失败')
  }

  async function readEvolutionProposalStream(response: Response): Promise<EvolutionProposal> {
    if (!response.body) {
      const data = await response.json().catch(() => ({})) as EvolutionProposal | { error?: string }
      if (!response.ok) throw new Error('error' in data && data.error ? data.error : '生成改进建议失败')
      return data as EvolutionProposal
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finalProposal: EvolutionProposal | null = null

    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const event = JSON.parse(trimmed) as EvolutionProposalStreamEvent
        finalProposal = handleEvolutionStreamEvent(event) ?? finalProposal
      }

      if (done) break
    }

    if (buffer.trim()) {
      const event = JSON.parse(buffer.trim()) as EvolutionProposalStreamEvent
      finalProposal = handleEvolutionStreamEvent(event) ?? finalProposal
    }

    if (!finalProposal) throw new Error('生成改进建议失败，请重试')
    return finalProposal
  }

  const handleCreateEvolutionProposal = useCallback(async (feedback: string) => {
    if (!activeRoomId || creatingEvolutionProposal) return
    const trimmedFeedback = feedback.trim()
    if (!trimmedFeedback) {
      setEvolutionError('请先写下这支 Team 下次怎么做会更好')
      return
    }
    setCreatingEvolutionProposal(true)
    setEvolutionError(null)
    setEvolutionOutput('')
    try {
      const response = await fetch(`${API}/api/rooms/${activeRoomId}/evolution-proposals/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: trimmedFeedback }),
      })
      const proposal = await readEvolutionProposalStream(response)
      setEvolutionProposals(previous => [proposal, ...previous.filter(item => item.id !== proposal.id)])
      setSelectedEvolutionId(proposal.id)
      setEvolutionFeedbackOpen(false)
      setEvolutionFeedbackDraft('')
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成改进建议失败'
      setEvolutionError(message)
      warn('ui:evolution:create_failed', { roomId: activeRoomId, error })
    } finally {
      setCreatingEvolutionProposal(false)
    }
  }, [activeRoomId, creatingEvolutionProposal])

  const handleEvolutionDecision = useCallback(async (changeId: string, decision: EvolutionChangeDecision) => {
    if (!activeEvolutionProposal || decidingEvolutionChangeId) return
    setDecidingEvolutionChangeId(changeId)
    setEvolutionError(null)
    try {
      const response = await fetch(`${API}/api/teams/evolution-proposals/${activeEvolutionProposal.id}/changes/${changeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      const data = await response.json().catch(() => ({})) as EvolutionProposal | { error?: string }
      if (!response.ok) {
        throw new Error('error' in data && data.error ? data.error : '更新 change decision 失败')
      }
      const proposal = data as EvolutionProposal
      setEvolutionProposals(previous => previous.map(item => item.id === proposal.id ? proposal : item))
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新 change decision 失败'
      setEvolutionError(message)
      warn('ui:evolution:decision_failed', { proposalId: activeEvolutionProposal.id, changeId, decision, error })
    } finally {
      setDecidingEvolutionChangeId(null)
    }
  }, [activeEvolutionProposal, decidingEvolutionChangeId])

  const handleRejectEvolutionProposal = useCallback(async () => {
    if (!activeEvolutionProposal || rejectingEvolutionProposal) return
    setRejectingEvolutionProposal(true)
    setEvolutionError(null)
    try {
      const response = await fetch(`${API}/api/teams/evolution-proposals/${activeEvolutionProposal.id}/reject`, {
        method: 'POST',
      })
      const data = await response.json().catch(() => ({})) as EvolutionProposal | { error?: string }
      if (!response.ok) {
        throw new Error('error' in data && data.error ? data.error : '放弃改进建议失败')
      }
      const proposal = data as EvolutionProposal
      setEvolutionProposals(previous => previous.map(item => item.id === proposal.id ? proposal : item))
      setSelectedEvolutionId(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : '放弃改进建议失败'
      setEvolutionError(message)
      warn('ui:evolution:reject_failed', { proposalId: activeEvolutionProposal.id, error })
    } finally {
      setRejectingEvolutionProposal(false)
    }
  }, [activeEvolutionProposal, rejectingEvolutionProposal])

  const handleRegenerateEvolutionProposal = useCallback(async (feedback: string) => {
    if (!activeRoomId || !activeEvolutionProposal || regeneratingEvolutionProposal) return
    const trimmedFeedback = feedback.trim()
    if (!trimmedFeedback) {
      setEvolutionError('请先写下你对当前提案哪里不满意')
      return
    }
    const replacedProposalId = activeEvolutionProposal.id
    setRegeneratingEvolutionProposal(true)
    setEvolutionError(null)
    setEvolutionOutput('')
    try {
      const response = await fetch(`${API}/api/rooms/${activeRoomId}/evolution-proposals/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback: trimmedFeedback,
          replacesProposalId: replacedProposalId,
        }),
      })
      const proposal = await readEvolutionProposalStream(response)
      const rejectedAt = Date.now()
      setEvolutionProposals(previous => [
        proposal,
        ...previous
          .filter(item => item.id !== proposal.id)
          .map(item => item.id === replacedProposalId
            ? { ...item, status: 'rejected' as const, updatedAt: rejectedAt }
            : item),
      ])
      setSelectedEvolutionId(proposal.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : '重新生成改进建议失败'
      setEvolutionError(message)
      try {
        await refreshEvolutionProposals()
      } catch (refreshError) {
        warn('ui:evolution:regenerate_refresh_failed', { proposalId: replacedProposalId, roomId: activeRoomId, error: refreshError })
      }
      warn('ui:evolution:regenerate_failed', { proposalId: activeEvolutionProposal.id, roomId: activeRoomId, error })
    } finally {
      setRegeneratingEvolutionProposal(false)
    }
  }, [activeEvolutionProposal, activeRoomId, refreshEvolutionProposals, regeneratingEvolutionProposal])

  const handleMergeEvolutionProposal = useCallback(async () => {
    if (!activeEvolutionProposal || mergingEvolutionProposal) return
    setMergingEvolutionProposal(true)
    setEvolutionError(null)
    try {
      const response = await fetch(`${API}/api/teams/evolution-proposals/${activeEvolutionProposal.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await response.json().catch(() => ({})) as { proposal?: EvolutionProposal; error?: string }
      if (!response.ok || !data.proposal) {
        throw new Error(data.error ?? '确认升级失败')
      }
      setEvolutionProposals(previous => previous.map(item => item.id === data.proposal!.id ? data.proposal! : item))
      if (data.proposal.status === 'applied' || data.proposal.status === 'rejected') {
        setSelectedEvolutionId(null)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '确认升级失败'
      setEvolutionError(message)
      warn('ui:evolution:merge_failed', { proposalId: activeEvolutionProposal.id, error })
    } finally {
      setMergingEvolutionProposal(false)
    }
  }, [activeEvolutionProposal, mergingEvolutionProposal])

  const handleDownload = useCallback(() => {
    if (!report) return
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(new Blob([report], { type: 'text/markdown' }))
    anchor.download = 'discussion-report.md'
    anchor.click()
  }, [report])

  return (
    <>
      <CreateRoomModal
        isOpen={isCreateModalOpen}
        onClose={closeCreateRoom}
        onRoomCreated={navigateToRoom}
        initialTopic={createInitialTopic}
        initialTeamId={createInitialTeamId}
        initialWorkerIds={createInitialWorkerIds}
      />
      <div className="app-islands-shell h-[100dvh] flex overflow-hidden text-ink font-sans">
        <RoomListSidebarDesktop
          rooms={rooms}
          currentRoomId={activeRoomId}
          onNewRoom={() => {
            debug('ui:room_create:open', { source: 'desktop_sidebar' })
            openCreateRoom()
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
          currentRoomId={activeRoomId}
          onNewRoom={() => {
            debug('ui:room_create:open', { source: 'mobile_sidebar' })
            openCreateRoom()
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
            roomId={activeRoomId}
            currentRoomTopic={currentRoomTopic}
            isTeamRoom={Boolean(teamId && teamVersionId)}
            teamName={teamName}
            teamVersionNumber={teamVersionNumber}
            maxA2ADepth={maxA2ADepth}
            currentA2ADepth={currentA2ADepth}
            displayMaxDepth={displayMaxDepth}
            onChangeDepth={newDepth => { void handleChangeDepth(newDepth) }}
            onToggleMobileMenu={toggleMobileMenu}
            onOpenAgentDrawer={openAgentDrawer}
            onOpenInviteDrawer={openInviteDrawer}
            agentPanelCollapsed={agentPanelCollapsed}
            onToggleAgentPanel={toggleAgentPanel}
            onGenerateTitleSuggestions={handleGenerateTitleSuggestions}
            onRenameRoom={handleRenameRoom}
            pendingEvolutionCount={pendingEvolutionProposals.length}
            creatingEvolutionProposal={creatingEvolutionProposal}
            onCreateEvolutionProposal={async () => {
              setEvolutionError(null)
              setEvolutionOutput('')
              setEvolutionFeedbackDraft('')
              setEvolutionFeedbackOpen(true)
            }}
            onReviewEvolution={() => {
              const proposal = pendingEvolutionProposals[0]
              if (proposal) setSelectedEvolutionId(proposal.id)
            }}
          />

          {activeRoomId ? (
            <>
              <MessageList
                roomId={activeRoomId}
                messages={messages}
                agents={agents}
                state={state}
                teamId={teamId}
                teamName={teamName}
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
                roomId={activeRoomId}
                state={state}
                report={report}
                onDownload={handleDownload}
                busyAgents={busyAgents}
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
            </>
          ) : (
            <EmptyRoomQuickStart
              onStartBlank={() => openCreateRoom()}
              onStartTemplate={handleStartTemplate}
            />
          )}
        </div>

        <AgentPanel
          roomId={activeRoomId}
          agents={agents}
          workspace={workspace}
          skillSummary={{
            effectiveSkills,
            globalSkillCount,
            workspaceDiscoveredCount,
          }}
          sessionTelemetryByAgent={sessionTelemetryByAgent}
          stoppingAgentIds={stoppingAgentIds}
          onStopAgent={handleStopAgent}
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

      {showInviteDrawer && activeRoomId && (
        <AgentInviteDrawer
          roomId={activeRoomId}
          currentAgentIds={currentAgentConfigIds}
          onClose={() => setShowInviteDrawer(false)}
          onInvited={() => {}}
        />
      )}

      {evolutionFeedbackOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 px-4">
          <div className="w-full max-w-xl rounded-lg border border-line bg-nav-bg shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase text-accent">改进建议</p>
                <h2 className="mt-1 text-base font-semibold text-ink">改进这支 Team</h2>
              </div>
              <button
                type="button"
                onClick={() => setEvolutionFeedbackOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
                aria-label="关闭改进建议"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <label className="block text-[13px] font-semibold text-ink" htmlFor="team-evolution-feedback">
                这支 Team 下次怎么做会更好？
              </label>
              <textarea
                id="team-evolution-feedback"
                value={evolutionFeedbackDraft}
                onChange={event => setEvolutionFeedbackDraft(event.target.value)}
                rows={6}
                className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[13px] leading-5 text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-accent"
                placeholder="例如：下次先问清楚限制条件，再开始给方案。"
              />
              {evolutionError && (
                <p className="rounded-lg bg-[color:var(--danger)]/8 px-3 py-2 text-[12px] text-[color:var(--danger)]">
                  {evolutionError}
                </p>
              )}
              {(creatingEvolutionProposal || evolutionOutput.trim().length > 0) && (
                <div className="rounded-lg border border-line bg-surface px-3 py-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold text-ink-soft">
                    {creatingEvolutionProposal && <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}
                    Team Architect
                  </p>
                  <div
                    className="custom-scrollbar mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-surface-muted px-3 py-2 text-[12px] leading-relaxed text-ink-soft"
                    aria-live="polite"
                  >
                    {evolutionOutput}
                    {creatingEvolutionProposal && <span className="ml-0.5 animate-pulse text-accent">|</span>}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEvolutionFeedbackOpen(false)}
                  className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-surface-muted"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => { void handleCreateEvolutionProposal(evolutionFeedbackDraft) }}
                  disabled={creatingEvolutionProposal || !evolutionFeedbackDraft.trim()}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-[13px] font-semibold text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {creatingEvolutionProposal && <Loader2 className="h-4 w-4 animate-spin" />}
                  生成改进建议
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeEvolutionProposal && selectedEvolutionId && (
        <EvolutionReviewModal
          proposal={activeEvolutionProposal}
          teamName={teamName}
          currentVersionNumber={teamVersionNumber}
          decidingChangeId={decidingEvolutionChangeId}
          merging={mergingEvolutionProposal}
          rejecting={rejectingEvolutionProposal}
          regenerating={regeneratingEvolutionProposal}
          error={evolutionError}
          onClose={() => setSelectedEvolutionId(null)}
          onDecide={handleEvolutionDecision}
          onMerge={handleMergeEvolutionProposal}
          onReject={handleRejectEvolutionProposal}
          onRegenerate={handleRegenerateEvolutionProposal}
        />
      )}
    </>
  )
}
