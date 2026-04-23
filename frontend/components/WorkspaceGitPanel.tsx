'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, GitBranch, RefreshCw } from 'lucide-react'

import {
  commitGitChanges,
  fetchGitStatus,
  stageGitPaths,
  type GitChangedFile,
  type GitStatusResult,
  unstageGitPaths,
} from '@/lib/workspace'

interface WorkspaceGitPanelProps {
  workspacePath: string
  onOpenDiff: (filePath: string, staged: boolean) => void
  onReviewStaged: () => void
}

function statusTone(file: GitChangedFile) {
  if (file.untracked) return 'border tone-warning-pill'
  if (file.indexStatus === 'D' || file.worktreeStatus === 'D') return 'border tone-danger-panel'
  if (file.indexStatus === 'R' || file.worktreeStatus === 'R') return 'border provider-badge-opencode'
  return 'border tone-success-pill'
}

function GitFileRow({
  file,
  actionLabel,
  actionDisabled,
  onAction,
  onPreview,
}: {
  file: GitChangedFile
  actionLabel: string
  actionDisabled: boolean
  onAction: () => void
  onPreview: () => void
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-2.5 py-2">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onPreview}
          className="min-w-0 flex-1 text-left"
          title={file.path}
        >
          <div className="flex items-center gap-2">
            <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${statusTone(file)}`}>
              {file.indexStatus}{file.worktreeStatus}
            </span>
            <span className="truncate text-[12px] font-medium text-ink">{file.path}</span>
          </div>
          {file.oldPath && (
            <p className="pt-1 text-[10px] text-ink-soft/60">
              from {file.oldPath}
            </p>
          )}
        </button>

        <button
          type="button"
          onClick={onAction}
          disabled={actionDisabled}
          className="shrink-0 rounded-md border border-line px-2 py-1 text-[10px] font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  )
}

function GitSection({
  title,
  emptyLabel,
  files,
  actionLabel,
  actionDisabled,
  onAction,
  onPreview,
}: {
  title: string
  emptyLabel: string
  files: GitChangedFile[]
  actionLabel: string
  actionDisabled: boolean
  onAction: (file: GitChangedFile) => void
  onPreview: (file: GitChangedFile) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold text-ink-soft">{title}</h4>
        <span className="text-[10px] text-ink-soft/55">{files.length}</span>
      </div>
      {files.length === 0
        ? <p className="py-1 text-[11px] text-ink-soft/55">{emptyLabel}</p>
        : files.map((file) => (
          <GitFileRow
            key={`${title}-${file.path}`}
            file={file}
            actionLabel={actionLabel}
            actionDisabled={actionDisabled}
            onAction={() => onAction(file)}
            onPreview={() => onPreview(file)}
          />
        ))}
    </div>
  )
}

export function WorkspaceGitPanel({ workspacePath, onOpenDiff, onReviewStaged }: WorkspaceGitPanelProps) {
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchGitStatus(workspacePath)
      setStatus(result)
    } catch (err) {
      setError((err as Error).message || '无法读取 Git 状态')
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const runAction = useCallback(async (action: () => Promise<unknown>, successNotice?: string) => {
    setSubmitting(true)
    setError(null)
    try {
      await action()
      if (successNotice) {
        setNotice(successNotice)
        window.setTimeout(() => setNotice(null), 2400)
      }
      await loadStatus()
    } catch (err) {
      setError((err as Error).message || 'Git 操作失败')
    } finally {
      setSubmitting(false)
    }
  }, [loadStatus])

  const changedFiles = status?.changedFiles ?? []
  const stagedFiles = changedFiles.filter((file) => file.staged)
  const unstagedFiles = changedFiles.filter((file) => file.unstaged)
  const untrackedFiles = changedFiles.filter((file) => file.untracked)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <GitBranch className="h-3.5 w-3.5 text-ink-soft" />
        <span className="text-[11px] font-semibold text-ink-soft">Git</span>
        <button
          type="button"
          onClick={() => void loadStatus()}
          className="ml-auto rounded p-0.5 text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
          title="刷新 Git 状态"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {loading && <p className="py-2 text-[11px] text-ink-soft/60">加载中…</p>}
      {!loading && error && <p className="tone-danger-panel rounded-lg border px-3 py-2 text-[11px]">{error}</p>}

      {!loading && !error && status && !status.isRepo && (
        <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[11px] text-ink-soft/70">
          当前工作区不是 Git 仓库，无法显示暂存区和提交操作。
        </div>
      )}

      {!loading && !error && status?.isRepo && (
        <>
          <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium text-ink">
                  {status.branch || 'detached HEAD'}
                </p>
                <p className="truncate pt-0.5 text-[10px] text-ink-soft/60">
                  {status.repoLabel}
                </p>
              </div>
              {notice && (
                <div className="tone-success-text flex items-center gap-1 text-[10px]">
                  <Check className="h-3.5 w-3.5" />
                  <span>{notice}</span>
                </div>
              )}
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
              <div className="rounded-md border border-line bg-surface-muted px-2 py-1.5 text-center text-ink-soft">
                <div className="text-[11px] font-semibold text-ink">{stagedFiles.length}</div>
                <div>staged</div>
              </div>
              <div className="rounded-md border border-line bg-surface-muted px-2 py-1.5 text-center text-ink-soft">
                <div className="text-[11px] font-semibold text-ink">{unstagedFiles.length}</div>
                <div>modified</div>
              </div>
              <div className="rounded-md border border-line bg-surface-muted px-2 py-1.5 text-center text-ink-soft">
                <div className="text-[11px] font-semibold text-ink">{untrackedFiles.length}</div>
                <div>untracked</div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void runAction(() => stageGitPaths(workspacePath), '已暂存工作区')}
              disabled={submitting || changedFiles.length === 0}
              className="rounded-md border border-line px-2.5 py-1.5 text-[10px] font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              Stage All
            </button>
            <button
              type="button"
              onClick={() => void runAction(() => unstageGitPaths(workspacePath), '已取消全部暂存')}
              disabled={submitting || stagedFiles.length === 0}
              className="rounded-md border border-line px-2.5 py-1.5 text-[10px] font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              Unstage All
            </button>
            <button
              type="button"
              onClick={onReviewStaged}
              disabled={stagedFiles.length === 0}
              className="rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[10px] font-medium text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Review Staged
            </button>
          </div>

          <GitSection
            title="Staged"
            emptyLabel="暂存区为空"
            files={stagedFiles}
            actionLabel="Unstage"
            actionDisabled={submitting}
            onAction={(file) => void runAction(() => unstageGitPaths(workspacePath, [file.path]), '已取消暂存')}
            onPreview={(file) => onOpenDiff(file.path, true)}
          />

          <GitSection
            title="Modified"
            emptyLabel="没有未暂存修改"
            files={unstagedFiles}
            actionLabel="Stage"
            actionDisabled={submitting}
            onAction={(file) => void runAction(() => stageGitPaths(workspacePath, [file.path]), '已加入暂存区')}
            onPreview={(file) => onOpenDiff(file.path, false)}
          />

          <GitSection
            title="Untracked"
            emptyLabel="没有新增文件"
            files={untrackedFiles}
            actionLabel="Stage"
            actionDisabled={submitting}
            onAction={(file) => void runAction(() => stageGitPaths(workspacePath, [file.path]), '已加入暂存区')}
            onPreview={(file) => onOpenDiff(file.path, false)}
          />

          <div className="space-y-2 rounded-lg border border-line bg-surface px-3 py-3">
            <div className="flex items-center justify-between">
              <label htmlFor="git-commit-message" className="text-[11px] font-semibold text-ink-soft">
                Commit Message
              </label>
              <span className="text-[10px] text-ink-soft/50">{commitMessage.trim().length} chars</span>
            </div>
            <textarea
              id="git-commit-message"
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder="feat: add workspace git panel"
              className="min-h-[74px] w-full rounded-lg border border-line bg-surface-muted px-3 py-2 text-[12px] text-ink outline-none transition-colors placeholder:text-ink-soft/40 focus:border-accent/40"
            />
            <button
              type="button"
              onClick={() => void runAction(
                async () => {
                  await commitGitChanges(workspacePath, commitMessage.trim())
                  setCommitMessage('')
                },
                '提交完成',
              )}
              disabled={submitting || stagedFiles.length === 0 || !commitMessage.trim()}
              className="w-full rounded-lg bg-ink px-3 py-2 text-[12px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Commit Staged Changes
            </button>
          </div>
        </>
      )}
    </div>
  )
}
