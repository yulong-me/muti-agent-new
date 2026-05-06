import { useCallback, useEffect, useMemo, useState } from 'react'

import { API_URL } from '@/lib/api'
import { warn } from '@/lib/logger'
import { readEvolutionProposalStream } from './evolutionStream'
import type { EvolutionChangeDecision, EvolutionProposal } from './types'

const API = API_URL

interface UseEvolutionProposalsOptions {
  roomId?: string
}

export function useEvolutionProposals({ roomId }: UseEvolutionProposalsOptions) {
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

  const pendingEvolutionProposals = useMemo(
    () => evolutionProposals.filter(proposal => proposal.status === 'pending' || proposal.status === 'in-review'),
    [evolutionProposals],
  )
  const activeEvolutionProposal = useMemo(
    () => evolutionProposals.find(proposal => proposal.id === selectedEvolutionId) ?? pendingEvolutionProposals[0],
    [evolutionProposals, pendingEvolutionProposals, selectedEvolutionId],
  )

  const refreshEvolutionProposals = useCallback(async () => {
    if (!roomId) {
      setEvolutionProposals([])
      return []
    }
    const response = await fetch(`${API}/api/rooms/${roomId}/evolution-proposals`)
    const data = await response.json().catch(() => []) as EvolutionProposal[] | { error?: string }
    if (!response.ok) {
      throw new Error(!Array.isArray(data) && data.error ? data.error : '读取改进建议失败')
    }
    const proposals = Array.isArray(data) ? data : []
    setEvolutionProposals(proposals)
    return proposals
  }, [roomId])

  useEffect(() => {
    setEvolutionProposals([])
    setSelectedEvolutionId(null)
    setEvolutionError(null)
    setEvolutionOutput('')
  }, [roomId])

  useEffect(() => {
    if (!roomId) return
    let cancelled = false
    refreshEvolutionProposals()
      .then(() => {
        if (cancelled) return
      })
      .catch(error => {
        if (!cancelled) {
          warn('ui:evolution:list_failed', { roomId, error })
        }
      })
    return () => {
      cancelled = true
    }
  }, [roomId, refreshEvolutionProposals])

  const openEvolutionFeedback = useCallback(async () => {
    setEvolutionError(null)
    setEvolutionOutput('')
    setEvolutionFeedbackDraft('')
    setEvolutionFeedbackOpen(true)
  }, [])

  const handleCreateEvolutionProposal = useCallback(async (feedback: string) => {
    if (!roomId || creatingEvolutionProposal) return
    const trimmedFeedback = feedback.trim()
    if (!trimmedFeedback) {
      setEvolutionError('请先写下这支 Team 下次怎么做会更好')
      return
    }
    setCreatingEvolutionProposal(true)
    setEvolutionError(null)
    setEvolutionOutput('')
    try {
      const response = await fetch(`${API}/api/rooms/${roomId}/evolution-proposals/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: trimmedFeedback }),
      })
      const proposal = await readEvolutionProposalStream(response, {
        onDelta: text => setEvolutionOutput(previous => `${previous}${text}`),
      })
      setEvolutionProposals(previous => [proposal, ...previous.filter(item => item.id !== proposal.id)])
      setSelectedEvolutionId(proposal.id)
      setEvolutionFeedbackOpen(false)
      setEvolutionFeedbackDraft('')
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成改进建议失败'
      setEvolutionError(message)
      warn('ui:evolution:create_failed', { roomId, error })
    } finally {
      setCreatingEvolutionProposal(false)
    }
  }, [creatingEvolutionProposal, roomId])

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
    if (!roomId || !activeEvolutionProposal || regeneratingEvolutionProposal) return
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
      const response = await fetch(`${API}/api/rooms/${roomId}/evolution-proposals/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback: trimmedFeedback,
          replacesProposalId: replacedProposalId,
        }),
      })
      const proposal = await readEvolutionProposalStream(response, {
        onDelta: text => setEvolutionOutput(previous => `${previous}${text}`),
      })
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
        warn('ui:evolution:regenerate_refresh_failed', { proposalId: replacedProposalId, roomId, error: refreshError })
      }
      warn('ui:evolution:regenerate_failed', { proposalId: activeEvolutionProposal.id, roomId, error })
    } finally {
      setRegeneratingEvolutionProposal(false)
    }
  }, [activeEvolutionProposal, refreshEvolutionProposals, regeneratingEvolutionProposal, roomId])

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

  return {
    activeEvolutionProposal,
    creatingEvolutionProposal,
    decidingEvolutionChangeId,
    evolutionError,
    evolutionFeedbackDraft,
    evolutionFeedbackOpen,
    evolutionOutput,
    handleCreateEvolutionProposal,
    handleEvolutionDecision,
    handleMergeEvolutionProposal,
    handleRegenerateEvolutionProposal,
    handleRejectEvolutionProposal,
    mergingEvolutionProposal,
    openEvolutionFeedback,
    pendingEvolutionProposals,
    regeneratingEvolutionProposal,
    rejectingEvolutionProposal,
    selectedEvolutionId,
    setEvolutionFeedbackDraft,
    setEvolutionFeedbackOpen,
    setSelectedEvolutionId,
  }
}
