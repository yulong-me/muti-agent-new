'use client'

import { useCallback, useMemo, useState } from 'react'
import { FolderTree, GitBranch } from 'lucide-react'

import { fetchGitDiff, previewWorkspaceFile } from '@/lib/workspace'
import { debug, warn } from '@/lib/logger'

import { WorkspaceFilesPanel } from './WorkspaceFilesPanel'
import { WorkspaceGitPanel } from './WorkspaceGitPanel'
import { WorkspacePreviewDialog } from './WorkspacePreviewDialog'

type WorkspaceTab = 'files' | 'git'

interface PreviewState {
  open: boolean
  title: string
  subtitle?: string
  kind: 'file' | 'diff'
  diffView?: 'text' | 'split'
  loading: boolean
  error: string | null
  content: string
  emptyLabel: string
  footer?: string | null
}

interface WorkspaceSidebarProps {
  workspacePath: string
}

const EMPTY_PREVIEW: PreviewState = {
  open: false,
  title: '',
  kind: 'file',
  diffView: 'text',
  loading: false,
  error: null,
  content: '',
  emptyLabel: '',
  footer: null,
}

export function WorkspaceSidebar({ workspacePath }: WorkspaceSidebarProps) {
  const [tab, setTab] = useState<WorkspaceTab>('files')
  const [preview, setPreview] = useState<PreviewState>(EMPTY_PREVIEW)

  const workspaceLabel = useMemo(() => {
    const parts = workspacePath.split(/[/\\]/).filter(Boolean)
    return parts.at(-1) || workspacePath
  }, [workspacePath])

  const openFilePreview = useCallback(async (absolutePath: string) => {
    setPreview({
      open: true,
      title: absolutePath.split(/[/\\]/).filter(Boolean).at(-1) || absolutePath,
      subtitle: absolutePath,
        kind: 'file',
        diffView: 'text',
        loading: true,
      error: null,
      content: '',
      emptyLabel: '该文件没有可显示内容',
      footer: null,
    })

    try {
      const result = await previewWorkspaceFile(absolutePath)
      debug('ui:workspace:file_preview_open', {
        workspacePath,
        path: result.path,
        size: result.size,
        truncated: result.truncated,
        isBinary: result.isBinary,
      })
      setPreview({
        open: true,
        title: result.name,
        subtitle: result.path,
        kind: 'file',
        diffView: 'text',
        loading: false,
        error: null,
        content: result.isBinary ? '' : (result.content || ''),
        emptyLabel: result.isBinary ? '这是一个二进制文件，暂不支持文本预览。' : '该文件为空',
        footer: result.truncated ? `已截断，仅显示前 ${Math.min(result.size, 128 * 1024)} 字节。` : `${result.size} bytes`,
      })
    } catch (err) {
      warn('ui:workspace:file_preview_failed', { workspacePath, path: absolutePath, error: err })
      setPreview({
        open: true,
        title: absolutePath.split(/[/\\]/).filter(Boolean).at(-1) || absolutePath,
        subtitle: absolutePath,
        kind: 'file',
        diffView: 'text',
        loading: false,
        error: (err as Error).message || '无法预览文件',
        content: '',
        emptyLabel: '无法预览文件',
        footer: null,
      })
    }
  }, [])

  const openDiffPreview = useCallback(async (filePath: string, staged: boolean) => {
    setPreview({
      open: true,
      title: filePath,
      subtitle: staged ? 'staged diff' : 'working tree diff',
      kind: 'diff',
      diffView: 'split',
      loading: true,
      error: null,
      content: '',
      emptyLabel: '没有 diff',
      footer: null,
    })

    try {
      const result = await fetchGitDiff(workspacePath, { filePath, staged })
      debug('ui:workspace:diff_preview_open', {
        workspacePath,
        filePath,
        staged,
        diffLength: result.diff.length,
      })
      setPreview({
        open: true,
        title: filePath,
        subtitle: staged ? 'staged diff' : 'working tree diff',
        kind: 'diff',
        diffView: 'split',
        loading: false,
        error: null,
        content: result.diff,
        emptyLabel: '当前文件没有 diff',
        footer: staged ? '来自暂存区' : '来自工作区',
      })
    } catch (err) {
      warn('ui:workspace:diff_preview_failed', { workspacePath, filePath, staged, error: err })
      setPreview({
        open: true,
        title: filePath,
        subtitle: staged ? 'staged diff' : 'working tree diff',
        kind: 'diff',
        diffView: 'split',
        loading: false,
        error: (err as Error).message || '无法读取 diff',
        content: '',
        emptyLabel: '无法读取 diff',
        footer: null,
      })
    }
  }, [workspacePath])

  const reviewStagedChanges = useCallback(async () => {
    setPreview({
      open: true,
      title: 'Staged Review',
      subtitle: workspacePath,
      kind: 'diff',
      diffView: 'text',
      loading: true,
      error: null,
      content: '',
      emptyLabel: '暂存区为空',
      footer: null,
    })

    try {
      const result = await fetchGitDiff(workspacePath, { staged: true })
      debug('ui:workspace:staged_review_open', {
        workspacePath,
        diffLength: result.diff.length,
      })
      setPreview({
        open: true,
        title: 'Staged Review',
        subtitle: workspacePath,
        kind: 'diff',
        diffView: 'text',
        loading: false,
        error: null,
        content: result.diff,
        emptyLabel: '暂存区为空',
        footer: '以下为当前工作区已暂存改动',
      })
    } catch (err) {
      warn('ui:workspace:staged_review_failed', { workspacePath, error: err })
      setPreview({
        open: true,
        title: 'Staged Review',
        subtitle: workspacePath,
        kind: 'diff',
        diffView: 'text',
        loading: false,
        error: (err as Error).message || '无法读取暂存区 diff',
        content: '',
        emptyLabel: '无法读取暂存区 diff',
        footer: null,
      })
    }
  }, [workspacePath])

  return (
    <>
      <div className="space-y-2.5 rounded-2xl border border-line bg-surface-muted px-2.5 py-2.5 shadow-sm">
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft/45">Workspace</p>
          <p className="truncate text-[12px] font-medium text-ink" title={workspacePath}>
            {workspaceLabel}
          </p>
          <p className="truncate text-[10px] text-ink-soft/60" title={workspacePath}>
            {workspacePath}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => {
              debug('ui:workspace:tab_change', { workspacePath, tab: 'files' })
              setTab('files')
            }}
            className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-medium transition-colors ${
              tab === 'files'
                ? 'bg-accent text-white shadow-[0_8px_18px_rgba(0,0,0,0.18)]'
                : 'border border-line bg-surface text-ink-soft hover:text-ink hover:bg-surface-muted'
            }`}
          >
            <FolderTree className="h-3.5 w-3.5" />
            Files
          </button>
          <button
            type="button"
            onClick={() => {
              debug('ui:workspace:tab_change', { workspacePath, tab: 'git' })
              setTab('git')
            }}
            className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-medium transition-colors ${
              tab === 'git'
                ? 'bg-accent text-white shadow-[0_8px_18px_rgba(0,0,0,0.18)]'
                : 'border border-line bg-surface text-ink-soft hover:text-ink hover:bg-surface-muted'
            }`}
          >
            <GitBranch className="h-3.5 w-3.5" />
            Git
          </button>
        </div>

        {tab === 'files'
          ? <WorkspaceFilesPanel workspacePath={workspacePath} onOpenFile={openFilePreview} />
          : <WorkspaceGitPanel workspacePath={workspacePath} onOpenDiff={openDiffPreview} onReviewStaged={reviewStagedChanges} />
        }
      </div>

      <WorkspacePreviewDialog
        open={preview.open}
        title={preview.title}
        subtitle={preview.subtitle}
        kind={preview.kind}
        diffView={preview.diffView}
        loading={preview.loading}
        error={preview.error}
        content={preview.content}
        emptyLabel={preview.emptyLabel}
        footer={preview.footer}
        onClose={() => setPreview(EMPTY_PREVIEW)}
      />
    </>
  )
}
