'use client'

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Code2, File, Folder, FolderOpen, Upload } from 'lucide-react'

import { type BrowseResult, browseWorkspace, isWorkspaceRequestError, type WorkspaceOpenTarget, uploadWorkspaceFile } from '@/lib/workspace'

interface WorkspaceFilesPanelProps {
  workspacePath: string
  onOpenFile: (absolutePath: string) => void
  onOpenExternal: (absolutePath: string, target: WorkspaceOpenTarget) => void
}

interface PendingOverwriteUpload {
  file: File
  parentPath: string
}

function toBreadcrumbs(currentPath: string, workspacePath: string) {
  if (currentPath === workspacePath) {
    return [{ label: 'workspace', path: workspacePath }]
  }

  const relative = currentPath.slice(workspacePath.length).replace(/^[/\\]+/, '')
  const parts = relative.split(/[/\\]/).filter(Boolean)
  let accumulated = workspacePath

  return [
    { label: 'workspace', path: workspacePath },
    ...parts.map((part) => {
      accumulated += `/${part}`
      return { label: part, path: accumulated }
    }),
  ]
}

export function WorkspaceFilesPanel({ workspacePath, onOpenFile, onOpenExternal }: WorkspaceFilesPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null)
  const [currentPath, setCurrentPath] = useState(workspacePath)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [pendingOverwrite, setPendingOverwrite] = useState<PendingOverwriteUpload | null>(null)

  const loadPath = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    setPendingOverwrite(null)
    try {
      const result = await browseWorkspace(path, true)
      setBrowseResult(result)
      setCurrentPath(result.current)
    } catch (err) {
      setError((err as Error).message || '无法读取目录')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setCurrentPath(workspacePath)
    void loadPath(workspacePath)
  }, [loadPath, workspacePath])

  const breadcrumbs = useMemo(
    () => toBreadcrumbs(currentPath, workspacePath),
    [currentPath, workspacePath],
  )

  const handleUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return

    setUploading(true)
    setError(null)
    setUploadMessage(null)
    setPendingOverwrite(null)
    try {
      await uploadWorkspaceFile(workspacePath, currentPath, file)
      setUploadMessage(`已上传 ${file.name}`)
      await loadPath(currentPath)
    } catch (err) {
      if (isWorkspaceRequestError(err, 409)) {
        setPendingOverwrite({ file, parentPath: currentPath })
        return
      }
      setError((err as Error).message || '无法上传文件')
    } finally {
      setUploading(false)
    }
  }, [currentPath, loadPath, workspacePath])

  const confirmOverwrite = useCallback(async () => {
    if (!pendingOverwrite) return

    setUploading(true)
    setError(null)
    setUploadMessage(null)
    try {
      await uploadWorkspaceFile(workspacePath, pendingOverwrite.parentPath, pendingOverwrite.file, { overwrite: true })
      setUploadMessage(`已覆盖 ${pendingOverwrite.file.name}`)
      const targetPath = pendingOverwrite.parentPath
      setPendingOverwrite(null)
      await loadPath(targetPath)
    } catch (err) {
      setError((err as Error).message || '无法覆盖文件')
    } finally {
      setUploading(false)
    }
  }, [loadPath, pendingOverwrite, workspacePath])

  const cancelOverwrite = useCallback(() => {
    setPendingOverwrite(null)
    setUploadMessage('已取消上传')
  }, [])

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Folder className="h-3.5 w-3.5 text-ink-soft" />
        <span className="text-[11px] font-semibold text-ink-soft">工作区文件</span>
        <div className="ml-auto flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            disabled={loading || uploading}
            onChange={handleUpload}
            aria-label="上传文件到当前目录"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || uploading}
            className="rounded p-0.5 text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            title="上传文件到当前目录"
          >
            <Upload className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onOpenExternal(currentPath, 'finder')}
            className="rounded p-0.5 text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
            title="在 Finder 中打开当前目录"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onOpenExternal(currentPath, 'vscode')}
            className="rounded p-0.5 text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
            title="在 VS Code 中打开当前目录"
          >
            <Code2 className="h-3.5 w-3.5" />
          </button>
          {currentPath !== workspacePath && (
          <button
            type="button"
            onClick={() => browseResult?.parent && void loadPath(browseResult.parent)}
            className="rounded p-0.5 text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
            title="返回上级"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-[10px] text-ink-soft/70">
        {breadcrumbs.map((crumb, index) => (
          <span key={crumb.path} className="flex items-center gap-1">
            {index > 0 && <ChevronRight className="h-3 w-3 text-ink-soft/40" />}
            {index === breadcrumbs.length - 1 ? (
              <span className="font-medium text-ink-soft">{crumb.label}</span>
            ) : (
              <button
                type="button"
                onClick={() => void loadPath(crumb.path)}
                className="transition-colors hover:text-accent"
              >
                {crumb.label}
              </button>
            )}
          </span>
        ))}
      </div>

      {loading && <p className="py-2 text-[11px] text-ink-soft/60">加载中…</p>}
      {!loading && !error && uploadMessage && <p className="py-1 text-[11px] text-ink-soft/70">{uploadMessage}</p>}
      {!loading && error && <p className="tone-danger-text py-2 text-[11px]">{error}</p>}
      {!loading && !error && pendingOverwrite && (
        <div className="rounded-md border border-[rgba(199,138,55,0.35)] bg-[rgba(199,138,55,0.08)] px-2 py-2 text-[11px] text-ink">
          <p className="font-medium">文件已存在，要覆盖吗？</p>
          <p className="mt-0.5 truncate text-ink-soft/70" title={pendingOverwrite.file.name}>
            {pendingOverwrite.file.name}
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void confirmOverwrite()}
              disabled={uploading}
              className="rounded border border-[rgba(199,138,55,0.55)] px-2 py-1 font-medium text-ink transition-colors hover:bg-[rgba(199,138,55,0.15)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              覆盖
            </button>
            <button
              type="button"
              onClick={cancelOverwrite}
              disabled={uploading}
              className="rounded px-2 py-1 text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              取消
            </button>
          </div>
        </div>
      )}
      {!loading && !error && browseResult?.entries.length === 0 && (
        <p className="py-2 text-[11px] text-ink-soft/60">空目录</p>
      )}

      {!loading && !error && browseResult && browseResult.entries.length > 0 && (
        <div className="max-h-56 space-y-0.5 overflow-y-auto pr-1 custom-scrollbar">
          {browseResult.entries.map((entry) => (
            <div
              key={entry.path}
              title={entry.path}
              className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-muted"
            >
              <button
                type="button"
                onClick={() => {
                  if (entry.isDirectory) {
                    void loadPath(entry.path)
                    return
                  }
                  onOpenFile(entry.path)
                }}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                {entry.isDirectory
                  ? <Folder className="h-3.5 w-3.5 shrink-0 text-[#c4a882]" />
                  : <File className="h-3.5 w-3.5 shrink-0 text-ink-soft/40" />
                }
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{entry.name}</span>
                <ChevronRight className="h-3 w-3 shrink-0 text-ink-soft/30" />
              </button>
              <button
                type="button"
                onClick={() => onOpenExternal(entry.path, 'finder')}
                className="shrink-0 rounded p-0.5 text-ink-soft/50 transition-colors hover:bg-surface hover:text-ink"
                title="在 Finder 中打开"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onOpenExternal(entry.path, 'vscode')}
                className="shrink-0 rounded p-0.5 text-ink-soft/50 transition-colors hover:bg-surface hover:text-ink"
                title="在 VS Code 中打开"
              >
                <Code2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
