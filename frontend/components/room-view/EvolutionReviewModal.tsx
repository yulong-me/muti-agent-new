'use client'

import { useEffect, useMemo, useState } from 'react'
import { Ban, Check, Loader2, RefreshCcw, X } from 'lucide-react'

import type { EvolutionChangeDecision, EvolutionProposal, EvolutionProposalChange } from './types'

const CHANGE_KIND_LABELS: Record<EvolutionProposalChange['kind'], string> = {
  'add-agent': '招募成员',
  'edit-agent-prompt': '成员提示词',
  'edit-team-workflow': '团队流程',
  'edit-routing-policy': '路由策略',
  'add-team-memory': '团队记忆',
  'add-validation-case': '效果检查',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '空'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function renderAfterValue(change: EvolutionProposalChange) {
  if (change.kind !== 'add-agent' || !isRecord(change.after)) {
    return (
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-muted p-3 text-[12px] leading-5">
        {stringifyValue(change.after)}
      </pre>
    )
  }

  const name = textField(change.after.name) || '新成员'
  const roleLabel = textField(change.after.roleLabel) || '成员'
  const responsibility = textField(change.after.responsibility)
  const whenToUse = textField(change.after.whenToUse)
  const systemPrompt = textField(change.after.systemPrompt)

  return (
    <div className="rounded-lg border border-line bg-surface-muted p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold text-ink">{name}</p>
          <p className="mt-1 text-[12px] text-ink-soft">{roleLabel}</p>
        </div>
        <span className="rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
          新增成员
        </span>
      </div>
      {responsibility && (
        <div className="mt-4">
          <p className="text-[12px] font-semibold text-ink-soft">负责什么</p>
          <p className="mt-1 text-[13px] leading-6 text-ink">{responsibility}</p>
        </div>
      )}
      {whenToUse && (
        <div className="mt-4">
          <p className="text-[12px] font-semibold text-ink-soft">什么时候用</p>
          <p className="mt-1 text-[13px] leading-6 text-ink">{whenToUse}</p>
        </div>
      )}
      {systemPrompt && (
        <details className="mt-4 rounded-md border border-line bg-surface px-3 py-2">
          <summary className="cursor-pointer text-[12px] font-semibold text-ink-soft">查看成员提示词</summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-5 text-ink-soft">
            {systemPrompt}
          </pre>
        </details>
      )}
    </div>
  )
}

function renderBeforeValue(change: EvolutionProposalChange) {
  if (change.kind === 'add-agent' && (change.before === null || change.before === undefined)) {
    return (
      <div className="rounded-md bg-surface-muted px-3 py-3 text-[13px] leading-5 text-ink-soft">
        当前团队还没有这个成员。
      </div>
    )
  }
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-muted p-3 text-[12px] leading-5">
      {stringifyValue(change.before)}
    </pre>
  )
}

function decisionText(decision: EvolutionProposalChange['decision']): string {
  if (decision === 'accepted') return '已采纳'
  if (decision === 'rejected') return '不采纳'
  return '待决定'
}

function decisionHelpText(change: EvolutionProposalChange): string {
  if (change.decision === 'accepted') {
    return `${change.title} 已选入本次升级，确认前仍可改为不采纳。`
  }
  if (change.decision === 'rejected') {
    return `${change.title} 不会进入本次升级，确认前仍可改为采纳。`
  }
  return '这条建议尚未决定，请选择采纳或不采纳。'
}

function friendlyErrorText(error?: string | null): string | null {
  if (!error) return null

  const normalized = error.toLowerCase()
  if (normalized.includes('network') || normalized.includes('fetch')) {
    return '网络连接不稳定，刚才的操作没有完成，请稍后再试。'
  }
  if (normalized.includes('timeout') || normalized.includes('timed out')) {
    return '等待时间过长，刚才的操作没有完成，请稍后再试。'
  }
  if (normalized.includes('401') || normalized.includes('403') || normalized.includes('permission')) {
    return '当前账号没有权限完成这个操作，请检查权限后再试。'
  }
  if (normalized.includes('404') || normalized.includes('not found')) {
    return '这次升级内容已经不存在或已被处理，请刷新后再看。'
  }
  if (normalized.includes('409') || normalized.includes('conflict') || normalized.includes('stale')) {
    return '这次升级状态已经变化，请刷新后再操作。'
  }

  return '刚才的操作没有完成，请稍后重试。'
}

interface EvolutionReviewModalProps {
  proposal: EvolutionProposal
  teamName?: string
  currentVersionNumber?: number
  decidingChangeId?: string | null
  merging: boolean
  rejecting?: boolean
  regenerating?: boolean
  error?: string | null
  onClose: () => void
  onDecide: (changeId: string, decision: EvolutionChangeDecision) => Promise<void>
  onMerge: () => Promise<void>
  onReject: () => Promise<void>
  onRegenerate: (feedback: string) => Promise<void>
}

export function EvolutionReviewModal({
  proposal,
  teamName,
  currentVersionNumber,
  decidingChangeId,
  merging,
  rejecting = false,
  regenerating = false,
  error,
  onClose,
  onDecide,
  onMerge,
  onReject,
  onRegenerate,
}: EvolutionReviewModalProps) {
  const [activeChangeId, setActiveChangeId] = useState(proposal.changes[0]?.id)
  const [regenerationFeedback, setRegenerationFeedback] = useState('')
  const [regenerationOpen, setRegenerationOpen] = useState(false)

  useEffect(() => {
    setActiveChangeId(proposal.changes[0]?.id)
    setRegenerationFeedback('')
    setRegenerationOpen(false)
  }, [proposal.id, proposal.changes])

  const activeChange = useMemo(
    () => proposal.changes.find(change => change.id === activeChangeId) ?? proposal.changes[0],
    [activeChangeId, proposal.changes],
  )
  const reviewedCount = proposal.changes.filter(change => change.decision).length
  const allReviewed = reviewedCount === proposal.changes.length && proposal.changes.length > 0
  const acceptedCount = proposal.changes.filter(change => change.decision === 'accepted').length
  const canMerge = allReviewed && acceptedCount > 0 && proposal.status !== 'applied' && proposal.status !== 'rejected' && proposal.status !== 'expired'
  const actionInProgress = merging || rejecting || regenerating || Boolean(decidingChangeId)
  const displayError = friendlyErrorText(error)
  const currentVersionLabel = `v${currentVersionNumber ?? '?'}`
  const targetVersionLabel = `v${proposal.targetVersionNumber}`
  const remainingCount = proposal.changes.length - reviewedCount
  const teamLabel = teamName ?? '当前团队'
  const progressText = allReviewed
    ? acceptedCount > 0
      ? `已处理全部建议，采纳 ${acceptedCount} 条。`
      : '已处理全部建议，但没有采纳任何建议。'
    : `已处理 ${reviewedCount}/${proposal.changes.length} 条，还有 ${remainingCount} 条。`
  const mergeHelpText = allReviewed
    ? acceptedCount > 0
      ? `可以确认升级到 ${targetVersionLabel}，后续新任务会使用新版 Team。`
      : '没有采纳任何建议，不能升级。请先采纳至少一条建议，或放弃本次升级。'
    : `处理完所有建议后，才能确认升级到 ${targetVersionLabel}。`

  return (
    <div className="fixed inset-0 layer-modal overflow-auto bg-nav-bg text-ink">
      <div className="flex min-h-full flex-col">
        <div className="grid shrink-0 gap-4 border-b border-line bg-nav-bg/95 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-accent">改进建议</p>
            <h2 className="mt-1 text-xl font-semibold leading-tight text-ink">
              确认后，这支 Team 会升级到 {targetVersionLabel}
            </h2>
            <p className="mt-2 text-[13px] leading-5 text-ink-soft">
              {teamLabel} {currentVersionLabel} → {targetVersionLabel}。确认后，后续新任务会使用新版 Team；旧任务记录不受影响。
            </p>
          </div>
          <div className="flex items-center justify-between gap-2 md:justify-end">
            <span className="rounded-full border border-line bg-surface-muted px-2.5 py-1 text-[12px] text-ink-soft">
              {allReviewed ? `${acceptedCount} 条建议已采纳` : `${remainingCount} 条建议待决定`}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
              aria-label="关闭改进建议"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)_340px]">
          <aside className="min-h-0 border-b border-line bg-surface/50 xl:border-b-0 xl:border-r">
            <div className="border-b border-line p-4">
              <p className="text-[12px] font-semibold text-ink-soft">本次要做什么</p>
              <p className="mt-2 text-[13px] leading-6 text-ink">
                你正在确认是否把当前 Team 升级到 {targetVersionLabel}。确认升级后，后续新任务会使用新版 Team。
              </p>
              <div className="mt-3 grid gap-2">
                <div className="flex items-center justify-between gap-3 text-[12px] text-ink-soft">
                  <span>当前团队</span>
                  <strong className="text-ink">{currentVersionLabel}</strong>
                </div>
                <div className="flex items-center justify-between gap-3 text-[12px] text-ink-soft">
                  <span>升级后</span>
                  <strong className="text-ink">{targetVersionLabel}</strong>
                </div>
                <div className="flex items-center justify-between gap-3 text-[12px] text-ink-soft">
                  <span>生效范围</span>
                  <strong className="text-ink">新任务</strong>
                </div>
              </div>
            </div>
            <div className="border-b border-line p-4">
              <p className="text-[12px] font-semibold text-ink-soft">为什么建议改进</p>
              <p className="mt-2 text-[13px] leading-6 text-ink">{proposal.summary}</p>
              {proposal.feedback && (
                <p className="mt-3 rounded-md bg-surface-muted px-3 py-2 text-[12px] leading-5 text-ink-soft">
                  你的意见：{proposal.feedback}
                </p>
              )}
            </div>
            <div className="border-b border-line px-4 py-3">
              <p className="text-[12px] font-semibold text-ink-soft">{proposal.changes.length} 条升级建议</p>
            </div>
            <div className="max-h-[34vh] overflow-auto p-2 xl:max-h-none">
              {proposal.changes.map(change => {
                const active = change.id === activeChange?.id
                return (
                  <button
                    key={change.id}
                    type="button"
                    onClick={() => setActiveChangeId(change.id)}
                    className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                      active ? 'bg-accent/10 text-accent' : 'text-ink hover:bg-surface-muted'
                    }`}
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] ${
                      change.decision === 'accepted'
                        ? 'border-accent bg-accent text-white'
                        : change.decision === 'rejected'
                          ? 'border-line bg-surface-muted text-ink-soft'
                          : 'border-line text-ink-soft'
                    }`}>
                      {change.decision === 'accepted' ? <Check className="h-3 w-3" /> : change.decision === 'rejected' ? '×' : ''}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{change.title}</span>
                      <span className="block truncate text-[11px] text-ink-soft">{CHANGE_KIND_LABELS[change.kind]}</span>
                    </span>
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                      change.decision === 'accepted'
                        ? 'bg-accent/10 text-accent'
                        : change.decision === 'rejected'
                          ? 'bg-surface-muted text-ink-soft'
                          : 'bg-surface-muted text-ink-muted'
                    }`}>
                      {decisionText(change.decision)}
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>

          <main className="min-h-0 overflow-auto p-5">
            {activeChange && (
              <div className="mx-auto max-w-4xl">
                <ol className="mb-4 grid gap-2 md:grid-cols-3" aria-label="升级确认流程">
                  <li className="grid min-h-[68px] grid-cols-[26px_minmax(0,1fr)] gap-2 rounded-lg border border-accent/40 bg-accent/10 p-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-[12px] font-bold text-white">1</span>
                    <span>
                      <strong className="block text-[13px] text-ink">看建议</strong>
                      <small className="mt-1 block text-[11px] leading-4 text-ink-soft">先确认团队要改哪里</small>
                    </span>
                  </li>
                  <li className={`grid min-h-[68px] grid-cols-[26px_minmax(0,1fr)] gap-2 rounded-lg border p-3 ${
                    activeChange.decision ? 'border-accent/40 bg-accent/10' : 'border-line bg-surface/60'
                  }`}>
                    <span className={`flex h-6 w-6 items-center justify-center rounded-md text-[12px] font-bold ${
                      activeChange.decision ? 'bg-accent text-white' : 'bg-surface-muted text-ink-soft'
                    }`}>2</span>
                    <span>
                      <strong className="block text-[13px] text-ink">{activeChange.decision ? decisionText(activeChange.decision) : '决定建议'}</strong>
                      <small className="mt-1 block text-[11px] leading-4 text-ink-soft">可在右侧更改当前建议状态</small>
                    </span>
                  </li>
                  <li className={`grid min-h-[68px] grid-cols-[26px_minmax(0,1fr)] gap-2 rounded-lg border p-3 ${
                    canMerge ? 'border-accent/40 bg-accent/10' : 'border-line bg-surface/60'
                  }`}>
                    <span className={`flex h-6 w-6 items-center justify-center rounded-md text-[12px] font-bold ${
                      canMerge ? 'bg-accent text-white' : 'bg-surface-muted text-ink-soft'
                    }`}>3</span>
                    <span>
                      <strong className="block text-[13px] text-ink">确认升级</strong>
                      <small className="mt-1 block text-[11px] leading-4 text-ink-soft">确认后，新任务使用 {targetVersionLabel}</small>
                    </span>
                  </li>
                </ol>
                <div className="mb-4 rounded-lg border border-line bg-surface p-4">
                  <div className="min-w-0">
                    <span className="inline-flex rounded-md bg-accent/10 px-2 py-1 text-[11px] font-semibold text-accent">
                      {CHANGE_KIND_LABELS[activeChange.kind]}
                    </span>
                    <h3 className="mt-3 text-xl font-semibold leading-tight text-ink">{activeChange.title}</h3>
                    <p className="mt-2 text-[13px] leading-6 text-ink-soft">{activeChange.impact}</p>
                  </div>
                </div>

                <div className="grid gap-4">
                  <section className="rounded-lg border border-line bg-surface p-4">
                    <p className="text-[12px] font-semibold text-ink-soft">建议理由</p>
                    <p className="mt-2 text-[14px] leading-6">{activeChange.why}</p>
                  </section>
                  <section className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-lg border border-line bg-surface p-4">
                      <p className="text-[12px] font-semibold text-ink-soft">当前状态</p>
                      <div className="mt-2">{renderBeforeValue(activeChange)}</div>
                    </div>
                    <div className="rounded-lg border border-line bg-surface p-4">
                      <p className="text-[12px] font-semibold text-ink-soft">调整后</p>
                      <div className="mt-2">{renderAfterValue(activeChange)}</div>
                    </div>
                  </section>
                  <section className="rounded-lg border border-line bg-surface p-4">
                    <p className="text-[12px] font-semibold text-ink-soft">参考依据</p>
                    <p className="mt-2 break-words text-[12px] leading-5 text-ink-soft">
                      来自本次讨论中的 {activeChange.evidenceMessageIds.length} 条消息。这里不展示消息编号，避免干扰判断。
                    </p>
                  </section>
                </div>
              </div>
            )}
          </main>

          <aside className="min-h-0 border-t border-line bg-surface/50 p-4 xl:overflow-auto xl:border-l xl:border-t-0" aria-label="升级确认台">
            {activeChange && (
              <section className="rounded-lg border border-line bg-surface p-4">
                <p className="text-[12px] font-semibold text-ink-soft">当前这条建议</p>
                <p className="mt-2 text-[15px] font-semibold text-ink">
                  {activeChange.decision === 'accepted'
                    ? '已采纳这条建议'
                    : activeChange.decision === 'rejected'
                      ? '已标记为不采纳'
                      : '这条建议还未决定'}
                </p>
                <p className="mt-2 text-[12px] leading-5 text-ink-soft">{decisionHelpText(activeChange)}</p>
                <div className="mt-4 grid gap-2">
                  {activeChange.decision === 'accepted' ? (
                    <button
                      type="button"
                      onClick={() => { void onDecide(activeChange.id, 'rejected') }}
                      disabled={actionInProgress}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line px-3 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-surface-muted disabled:cursor-wait disabled:opacity-60"
                    >
                      {decidingChangeId === activeChange.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                      改为不采纳
                    </button>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                      <button
                        type="button"
                        onClick={() => { void onDecide(activeChange.id, 'accepted') }}
                        disabled={actionInProgress}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-accent px-3 text-[13px] font-semibold text-white transition-colors hover:bg-accent/90 disabled:cursor-wait disabled:opacity-60"
                      >
                        {decidingChangeId === activeChange.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        {activeChange.decision === 'rejected' ? '改为采纳' : '采纳这条建议'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void onDecide(activeChange.id, 'rejected') }}
                        disabled={actionInProgress}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line px-3 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-surface-muted disabled:cursor-wait disabled:opacity-60"
                      >
                        {decidingChangeId === activeChange.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                        不采纳
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}

            <section className={`mt-4 rounded-lg border p-4 ${
              canMerge ? 'border-accent/40 bg-accent/10' : 'border-line bg-surface'
            }`}>
              <p className="text-[12px] font-semibold text-ink-soft">整个团队升级</p>
              <p className="mt-2 text-[15px] font-semibold text-ink">{progressText}</p>
              <p className="mt-2 text-[12px] leading-5 text-ink-soft">{mergeHelpText}</p>
              {(!allReviewed || acceptedCount === 0) && (
                <p className="mt-3 rounded-lg border border-line bg-nav-bg/60 px-3 py-2 text-[12px] leading-5 text-ink-soft">
                  {acceptedCount === 0 && allReviewed ? '没有采纳任何建议，不能升级。' : '左侧还有建议未处理。'}
                </p>
              )}
              {displayError && (
                <p className="mt-3 rounded-lg border border-line bg-surface-muted px-3 py-2 text-[12px] leading-5 text-[color:var(--danger)]" aria-live="polite">
                  {displayError}
                </p>
              )}
              <button
                type="button"
                onClick={() => { void onMerge() }}
                disabled={!canMerge || actionInProgress}
                className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-semibold text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                确认升级 Team
              </button>
            </section>

            <section className="mt-4 rounded-lg border border-line bg-surface p-4">
              <p className="text-[12px] font-semibold text-ink-soft">其他选择</p>
              <p className="mt-2 text-[12px] leading-5 text-ink-soft">不满意这版，可以补充意见重新生成；也可以放弃本次升级。</p>
              {!regenerationOpen ? (
                <button
                  type="button"
                  onClick={() => setRegenerationOpen(true)}
                  disabled={actionInProgress}
                  className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-line px-3 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-surface-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCcw className="h-4 w-4" />
                  重新生成一版
                </button>
              ) : (
                <div className="mt-4">
                  <label className="text-[12px] font-semibold text-ink-soft" htmlFor="team-evolution-regeneration-feedback">
                    你希望怎么改
                  </label>
                  <textarea
                    id="team-evolution-regeneration-feedback"
                    value={regenerationFeedback}
                    onChange={event => setRegenerationFeedback(event.target.value)}
                    rows={4}
                    className="mt-2 w-full resize-none rounded-lg border border-line bg-nav-bg px-3 py-2 text-[13px] leading-5 text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-accent"
                    placeholder="例如：视觉设计师还要负责封面图，重新生成一版。"
                  />
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                    <button
                      type="button"
                      onClick={() => setRegenerationOpen(false)}
                      disabled={regenerating}
                      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-line px-3 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-surface-muted"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={() => { void onRegenerate(regenerationFeedback) }}
                      disabled={actionInProgress || !regenerationFeedback.trim()}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line px-3 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-surface-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                      重新生成一版
                    </button>
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => { void onReject() }}
                disabled={actionInProgress}
                className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-line px-3 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-surface-muted hover:text-[color:var(--danger)] disabled:cursor-wait disabled:opacity-60"
              >
                {rejecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                放弃本次升级
              </button>
            </section>
          </aside>
        </div>
      </div>
    </div>
  )
}
