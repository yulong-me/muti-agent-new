'use client'

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Loader2,
  Send,
  X,
} from 'lucide-react'
import {
  AGENT_COLORS,
  DEFAULT_AGENT_COLOR,
  extractUserMentionsFromAgents,
  findActiveMentionTrigger,
  insertMention,
  type Agent,
} from '../lib/agents'
import { telemetry } from '../lib/logger'
import MentionPicker from './MentionPicker'

export interface RoomComposerHandle {
  focus: () => void
  getDraft: () => string
  hasDraft: () => boolean
  setDraft: (value: string) => void
  prefillMention: (agent: Agent) => void
}

interface RoomComposerProps {
  roomId?: string
  agents: Agent[]
  lastActiveWorkerId: string | null
  sending: boolean
  queueMode?: boolean
  sendError: string | null
  onSend: (rawContent: string) => Promise<boolean>
  onSendError: (message: string, timeoutMs?: number) => void
  onDraftChange?: (value: string) => void
  onRecipientSelected: (agentId: string | null) => void
}

export const RoomComposer = memo(forwardRef<RoomComposerHandle, RoomComposerProps>(function RoomComposer({
  roomId,
  agents,
  lastActiveWorkerId,
  sending,
  queueMode = false,
  sendError,
  onSend,
  onSendError,
  onDraftChange,
  onRecipientSelected,
}, ref) {
  const [userInput, setUserInput] = useState('')
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStartIdx, setMentionStartIdx] = useState(-1)
  const [mentionHighlightIdx, setMentionHighlightIdx] = useState(0)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pendingInputRef = useRef({ value: '', cursor: 0 })
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const compositionRef = useRef(false)

  const agentNames = useMemo(() => agents.map(a => a.name), [agents])
  const selectedRecipient = useMemo(() => {
    const mentionNames = extractUserMentionsFromAgents(userInput, agentNames)
    const targetName = mentionNames[0]
    return targetName ? agents.find(agent => agent.name === targetName) ?? null : null
  }, [agentNames, agents, userInput])
  const selectedRecipientColors = selectedRecipient
    ? AGENT_COLORS[selectedRecipient.name] ?? DEFAULT_AGENT_COLOR
    : null

  const filteredAgents = useMemo(() => {
    const base = mentionQuery
      ? agents.filter(a => a.name.toLowerCase().includes(mentionQuery.toLowerCase()))
      : agents
    if (!lastActiveWorkerId || mentionQuery) return base
    return [
      ...base.filter(a => a.id === lastActiveWorkerId),
      ...base.filter(a => a.id !== lastActiveWorkerId),
    ]
  }, [agents, mentionQuery, lastActiveWorkerId])

  const openMentionPicker = useCallback((mentionAtIdx: number, query: string, filteredCount?: number) => {
    setMentionPickerOpen(true)
    setMentionQuery(query)
    setMentionStartIdx(mentionAtIdx)
    const defaultHighlight = query === '' && (filteredCount ?? 0) > 1
      ? (filteredCount ?? 1) - 1
      : 0
    setMentionHighlightIdx(defaultHighlight)
  }, [])

  const closeMentionPicker = useCallback(() => {
    setMentionPickerOpen(false)
    setMentionQuery('')
    setMentionStartIdx(-1)
  }, [])

  const focus = useCallback(() => {
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [])

  const setDraft = useCallback((value: string) => {
    setUserInput(value)
    pendingInputRef.current = { value, cursor: value.length }
  }, [])

  const prefillMention = useCallback((agent: Agent) => {
    setUserInput(current => current.trim() ? current : `@${agent.name} `)
    onRecipientSelected(agent.id)
    closeMentionPicker()
    focus()
  }, [closeMentionPicker, focus, onRecipientSelected])

  useImperativeHandle(ref, () => ({
    focus,
    getDraft: () => userInput,
    hasDraft: () => Boolean(userInput.trim()),
    setDraft,
    prefillMention,
  }), [focus, prefillMention, setDraft, userInput])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const maxH = 200
    const newH = Math.min(ta.scrollHeight, maxH)
    ta.style.height = `${newH}px`
    ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden'
  }, [userInput])

  useEffect(() => {
    onDraftChange?.(userInput)
  }, [onDraftChange, userInput])

  useEffect(() => {
    onRecipientSelected(selectedRecipient?.id ?? null)
  }, [onRecipientSelected, selectedRecipient?.id])

  useEffect(() => {
    if (!mentionPickerOpen) return
    const onMouseDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null
      if (!target) return
      if (textareaRef.current?.contains(target)) return
      if (target.closest('[data-mention-picker="1"]')) return
      closeMentionPicker()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [mentionPickerOpen, closeMentionPicker])

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (filteredAgents.length === 0) {
      setMentionHighlightIdx(0)
      return
    }
    setMentionHighlightIdx(current => Math.min(current, filteredAgents.length - 1))
  }, [filteredAgents.length])

  const runMentionDetection = useCallback((value: string, cursor: number) => {
    const activeMention = findActiveMentionTrigger(value, cursor, agentNames)
    if (activeMention) {
      const filteredCount = activeMention.query.length > 0
        ? agents.filter(a => a.name.toLowerCase().includes(activeMention.query.toLowerCase())).length
        : agents.length
      openMentionPicker(activeMention.start, activeMention.query, filteredCount)
    } else {
      closeMentionPicker()
    }
  }, [agentNames, agents, closeMentionPicker, openMentionPicker])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    const cursor = e.target.selectionStart ?? val.length
    setUserInput(val)
    pendingInputRef.current = { value: val, cursor }

    if (compositionRef.current) return

    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(() => {
      const { value, cursor: c } = pendingInputRef.current
      runMentionDetection(value, c)
      debounceTimerRef.current = null
    }, 150)
  }, [runMentionDetection])

  const handleCompositionStart = useCallback(() => {
    compositionRef.current = true
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
  }, [])

  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLTextAreaElement>) => {
    compositionRef.current = false
    const val = e.currentTarget.value
    const cursor = e.currentTarget.selectionStart ?? val.length
    pendingInputRef.current = { value: val, cursor }
    runMentionDetection(val, cursor)
  }, [runMentionDetection])

  const selectMentionAgent = useCallback((agentName: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const cursor = ta.selectionStart ?? userInput.length
    const selectionCursor = mentionStartIdx >= 0 ? cursor : 0
    const insertionStart = mentionStartIdx >= 0 ? mentionStartIdx : 0
    const existingRecipientPattern = selectedRecipient
      ? new RegExp(`^@${selectedRecipient.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`)
      : null
    const baseInput = mentionStartIdx >= 0
      ? userInput
      : existingRecipientPattern
        ? userInput.replace(existingRecipientPattern, '')
        : userInput
    const { nextValue, nextCursor } = insertMention(baseInput, insertionStart, selectionCursor, agentName)
    setDraft(nextValue)
    closeMentionPicker()
    const target = agents.find(a => a.name === agentName)
    if (target) {
      onRecipientSelected(target.id)
      telemetry('ui:mention:pick', { roomId, agentName, agentId: target.id, agentRole: target.role })
    }
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(nextCursor, nextCursor)
    }, 0)
  }, [agents, closeMentionPicker, mentionStartIdx, onRecipientSelected, roomId, selectedRecipient, setDraft, userInput])

  const openRecipientPicker = useCallback(() => {
    setMentionStartIdx(-1)
    setMentionQuery('')
    setMentionHighlightIdx(0)
    setMentionPickerOpen(true)
    focus()
  }, [focus])

  const clearRecipient = useCallback(() => {
    if (!selectedRecipient) return
    const pattern = new RegExp(`@${selectedRecipient.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`)
    setDraft(userInput.replace(pattern, ''))
    onRecipientSelected(null)
    focus()
  }, [focus, onRecipientSelected, selectedRecipient, setDraft, userInput])

  const submitDraft = useCallback(async () => {
    if (sending) return
    const content = userInput.trim()
    if (!content) return
    if (extractUserMentionsFromAgents(content, agentNames).length === 0) {
      openRecipientPicker()
      onSendError('消息要发给谁？按 @ 选一位专家')
      focus()
      return
    }
    setMentionPickerOpen(false)
    const sent = await onSend(content)
    if (sent) {
      setDraft('')
    }
  }, [agentNames, focus, onSend, onSendError, openRecipientPicker, sending, setDraft, userInput])

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void submitDraft()
      return
    }
    if (!mentionPickerOpen) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void submitDraft()
      }
      return
    }
    const count = filteredAgents.length
    if (count === 0) {
      if (e.key === 'Escape') { e.preventDefault(); closeMentionPicker() }
      else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        closeMentionPicker()
        void submitDraft()
      }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionHighlightIdx(i => (i + 1) % count) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMentionHighlightIdx(i => (i - 1 + count) % count) }
    else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      if (filteredAgents[mentionHighlightIdx]) selectMentionAgent(filteredAgents[mentionHighlightIdx].name)
    } else if (e.key === 'Escape') { e.preventDefault(); closeMentionPicker() }
  }, [closeMentionPicker, filteredAgents, mentionHighlightIdx, mentionPickerOpen, selectMentionAgent, submitDraft])

  const canSend = Boolean(userInput.trim()) && !sending
  const shortcutHint = mentionPickerOpen ? '↵ 选择 · esc 取消' : '↵ 发送 · ⇧↵ 换行 · Cmd+Enter 发送'

  return (
    <div className="relative flex flex-col gap-2">
      {sendError && <div className="tone-danger-text px-1 text-xs">{sendError}</div>}
      {mentionPickerOpen && (
        <MentionPicker
          agents={filteredAgents}
          highlightIndex={mentionHighlightIdx}
          onSelect={selectMentionAgent}
          onHighlight={setMentionHighlightIdx}
        />
      )}
      <div className="app-islands-input border border-line bg-surface p-2 shadow-sm transition-colors focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/[0.15]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={openRecipientPicker}
            className={`inline-flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-caption transition-colors ${
              selectedRecipient && selectedRecipientColors
                ? 'border-line bg-surface text-ink'
                : 'border-dashed border-line bg-surface-muted text-ink-soft hover:border-accent/40 hover:text-accent'
            }`}
            style={selectedRecipientColors ? {
              borderColor: `${selectedRecipientColors.bg}42`,
              backgroundColor: `${selectedRecipientColors.bg}12`,
              color: selectedRecipientColors.bg,
            } : undefined}
          >
            <span className="shrink-0 font-medium text-ink-soft">To:</span>
            <span className="min-w-0 truncate font-medium">
              {selectedRecipient ? `@${selectedRecipient.name}` : '选择一位专家'}
            </span>
          </button>
          {selectedRecipient ? (
            <button
              type="button"
              onClick={clearRecipient}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
              aria-label="清除收件人"
              title="清除收件人"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <div className="relative">
        <textarea
          ref={textareaRef}
          className="min-h-20 max-h-48 w-full resize-none border-0 bg-transparent px-1 pb-10 pr-12 pt-1 text-body text-ink placeholder:text-ink-faint focus:outline-none"
          placeholder={selectedRecipient ? `写消息给 ${selectedRecipient.name}` : '写消息给一位专家'}
          value={userInput}
          onChange={handleInputChange}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onKeyDown={handleInputKeyDown}
          disabled={sending}
          aria-label="输入消息"
        />
        <button
          type="button"
          className={`absolute bottom-1.5 right-1.5 inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
            canSend
              ? 'bg-accent text-white hover:bg-accent-deep'
              : 'cursor-not-allowed bg-surface-muted text-ink-faint'
          }`}
          onClick={() => void submitDraft()}
          disabled={!canSend}
          aria-label={queueMode ? '加入队列' : '发送'}
          title={queueMode ? '加入队列' : '发送'}
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
        </div>
        <div className="mt-1 flex justify-end px-1 font-mono text-[10px] text-ink-faint">
          {shortcutHint}
        </div>
      </div>
    </div>
  )
}))
