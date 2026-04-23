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
    if (!ta || mentionStartIdx < 0) return
    const cursor = ta.selectionStart ?? userInput.length
    const { nextValue, nextCursor } = insertMention(userInput, mentionStartIdx, cursor, agentName)
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
  }, [agents, closeMentionPicker, mentionStartIdx, onRecipientSelected, roomId, setDraft, userInput])

  const submitDraft = useCallback(async () => {
    if (sending) return
    const content = userInput.trim()
    if (!content) return
    if (extractUserMentionsFromAgents(content, agentNames).length === 0) {
      const cursor = textareaRef.current?.selectionStart ?? content.length
      setMentionStartIdx(cursor)
      setMentionQuery('')
      setMentionHighlightIdx(0)
      setMentionPickerOpen(true)
      onSendError('先选择要发给哪位专家：输入 @ 或点一个专家名称')
      focus()
      return
    }
    setMentionPickerOpen(false)
    const sent = await onSend(content)
    if (sent) {
      setDraft('')
    }
  }, [agentNames, focus, onSend, onSendError, sending, setDraft, userInput])

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  return (
    <div className="flex flex-col gap-2 relative">
      {sendError && <div className="tone-danger-text px-1 text-xs">{sendError}</div>}
      {mentionPickerOpen && (
        <MentionPicker
          agents={filteredAgents}
          highlightIndex={mentionHighlightIdx}
          onSelect={selectMentionAgent}
          onHighlight={setMentionHighlightIdx}
        />
      )}
      <div className="flex gap-3">
        <textarea
          ref={textareaRef}
          className="app-islands-input flex-1 bg-surface border border-line rounded-xl px-4 py-3 text-[14px] text-ink placeholder:text-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent resize-none min-h-12 max-h-48 leading-relaxed"
          placeholder="输入消息，或 @mention 专家…"
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
          className="app-islands-item bg-accent text-white font-semibold px-5 py-3 rounded-xl hover:bg-accent-deep transition-all disabled:opacity-50 text-[14px] shadow-sm self-end"
          onClick={() => void submitDraft()}
          disabled={sending || !userInput.trim()}
        >
          {sending ? '发送中…' : queueMode ? '加入队列' : '发送'}
        </button>
      </div>
    </div>
  )
}))
