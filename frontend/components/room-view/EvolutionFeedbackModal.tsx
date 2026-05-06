import { Loader2, X } from 'lucide-react'

interface EvolutionFeedbackModalProps {
  draft: string
  output: string
  error: string | null
  creating: boolean
  onDraftChange: (draft: string) => void
  onClose: () => void
  onSubmit: (feedback: string) => void | Promise<void>
}

export function EvolutionFeedbackModal({
  draft,
  output,
  error,
  creating,
  onDraftChange,
  onClose,
  onSubmit,
}: EvolutionFeedbackModalProps) {
  return (
    <div className="fixed inset-0 layer-modal flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-xl rounded-lg border border-line bg-nav-bg shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase text-accent">改进建议</p>
            <h2 className="mt-1 text-base font-semibold text-ink">改进这支 Team</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
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
            value={draft}
            onChange={event => onDraftChange(event.target.value)}
            rows={6}
            className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[13px] leading-5 text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-accent"
            placeholder="例如：下次先问清楚限制条件，再开始给方案。"
          />
          {error && (
            <p className="rounded-lg bg-[color:var(--danger)]/8 px-3 py-2 text-[12px] text-[color:var(--danger)]">
              {error}
            </p>
          )}
          {(creating || output.trim().length > 0) && (
            <div className="rounded-lg border border-line bg-surface px-3 py-3">
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-ink-soft">
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}
                Team Architect
              </p>
              <div
                className="custom-scrollbar mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-surface-muted px-3 py-2 text-[12px] leading-relaxed text-ink-soft"
                aria-live="polite"
              >
                {output}
                {creating && <span className="ml-0.5 animate-pulse text-accent">|</span>}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-[13px] font-semibold text-ink-soft transition-colors hover:bg-surface-muted"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => { void onSubmit(draft) }}
              disabled={creating || !draft.trim()}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-[13px] font-semibold text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              生成改进建议
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
