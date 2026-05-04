'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Diff, Hunk, parseDiff } from 'react-diff-view'
import { FileText, GitCompareArrows, X } from 'lucide-react'

type DiffViewMode = 'text' | 'split'

interface WorkspacePreviewDialogProps {
  open: boolean
  title: string
  subtitle?: string
  kind: 'file' | 'diff'
  diffView?: DiffViewMode
  loading: boolean
  error: string | null
  content: string
  emptyLabel: string
  footer?: string | null
  onClose: () => void
}

export function WorkspacePreviewDialog({
  open,
  title,
  subtitle,
  kind,
  diffView = 'text',
  loading,
  error,
  content,
  emptyLabel,
  footer,
  onClose,
}: WorkspacePreviewDialogProps) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)

  const parsedDiffFiles = useMemo(() => {
    if (kind !== 'diff' || !content.trim()) return []
    return parseDiff(content, { nearbySequences: 'zip' })
  }, [content, kind])

  useEffect(() => {
    setPortalRoot(document.body)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !portalRoot) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open, portalRoot])

  if (!open || !portalRoot) return null

  return createPortal((
    <div className="fixed inset-0 layer-fullscreen-preview flex">
      <div className="absolute inset-0 layer-modal-scrim bg-[color:var(--overlay-scrim)]" onClick={onClose} />
      <div
        className="layer-overlay-content flex h-[100dvh] w-screen flex-col overflow-hidden bg-bg shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4 bg-surface">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              {kind === 'diff'
                ? <GitCompareArrows className="h-4 w-4 text-accent" />
                : <FileText className="h-4 w-4 text-accent" />
              }
              <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
            </div>
            {subtitle && <p className="truncate text-xs text-ink-soft/70">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
            aria-label="关闭预览"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-surface-muted">
          {loading && (
            <div className="flex h-full items-center justify-center text-sm text-ink-soft/70">
              加载中…
            </div>
          )}

          {!loading && error && (
            <div className="tone-danger-panel rounded-xl border px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {!loading && !error && !content && (
            <div className="flex h-full items-center justify-center text-sm text-ink-soft/70">
              {emptyLabel}
            </div>
          )}

          {!loading && !error && content && (
            kind === 'diff' && parsedDiffFiles.length > 0 ? (
              <ParsedDiffView files={parsedDiffFiles} viewType={diffView === 'split' ? 'split' : 'unified'} />
            ) : (
              <pre className="whitespace-pre-wrap break-words px-6 py-5 font-mono text-[12px] leading-6 text-ink sm:px-8">
                {content}
              </pre>
            )
          )}
        </div>

        {footer && (
          <div className="border-t border-line bg-surface px-6 py-3.5 text-[11px] text-ink-soft/70">
            {footer}
          </div>
        )}
      </div>
    </div>
  ), portalRoot)
}

type ParsedDiffFile = ReturnType<typeof parseDiff>[number]

function ParsedDiffView({
  files,
  viewType,
}: {
  files: ParsedDiffFile[]
  viewType: 'split' | 'unified'
}) {
  return (
    <div className="workspace-diff-view min-h-full space-y-5 px-4 py-4 sm:px-6 sm:py-5">
      {files.map((file, index) => (
        <section
          key={`${file.oldRevision}-${file.newRevision}-${file.oldPath}-${file.newPath}-${index}`}
          className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_20px_48px_rgba(0,0,0,0.18)]"
        >
          <div className="border-b border-line bg-surface-muted px-4 py-3">
            <div className="mb-3 inline-flex rounded-full border border-line bg-surface px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft/55">
              {file.type}
            </div>
            <div className={`grid gap-3 ${viewType === 'split' ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
              <DiffFileHead label="Before" path={file.oldPath || '/dev/null'} />
              <DiffFileHead label="After" path={file.newPath || '/dev/null'} />
            </div>
          </div>

          <div className="overflow-x-auto">
            <Diff
              viewType={viewType}
              diffType={file.type}
              hunks={file.hunks}
              optimizeSelection={viewType === 'split'}
            >
              {(hunks) => hunks.map((hunk) => (
                <Hunk key={`${hunk.content}-${hunk.oldStart}-${hunk.newStart}`} hunk={hunk} />
              ))}
            </Diff>
          </div>
        </section>
      ))}
    </div>
  )
}

function DiffFileHead({ label, path }: { label: string; path: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-ink-soft/45">{label}</p>
      <p className="truncate pt-1 font-mono text-[11px] text-ink">{path}</p>
    </div>
  )
}
