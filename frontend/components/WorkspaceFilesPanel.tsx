'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, File, Folder } from 'lucide-react'

import { type BrowseResult, browseWorkspace } from '@/lib/workspace'

interface WorkspaceFilesPanelProps {
  workspacePath: string
  onOpenFile: (absolutePath: string) => void
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

export function WorkspaceFilesPanel({ workspacePath, onOpenFile }: WorkspaceFilesPanelProps) {
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null)
  const [currentPath, setCurrentPath] = useState(workspacePath)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadPath = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
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

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Folder className="h-3.5 w-3.5 text-ink-soft" />
        <span className="text-[11px] font-semibold text-ink-soft">工作区文件</span>
        {currentPath !== workspacePath && (
          <button
            type="button"
            onClick={() => browseResult?.parent && void loadPath(browseResult.parent)}
            className="ml-auto rounded p-0.5 text-ink-soft transition-colors hover:bg-white/[0.06] hover:text-ink"
            title="返回上级"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        )}
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
      {!loading && error && <p className="py-2 text-[11px] text-red-400">{error}</p>}
      {!loading && !error && browseResult?.entries.length === 0 && (
        <p className="py-2 text-[11px] text-ink-soft/60">空目录</p>
      )}

      {!loading && !error && browseResult && browseResult.entries.length > 0 && (
        <div className="max-h-56 space-y-0.5 overflow-y-auto pr-1 custom-scrollbar">
          {browseResult.entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => {
                if (entry.isDirectory) {
                  void loadPath(entry.path)
                  return
                }
                onOpenFile(entry.path)
              }}
              title={entry.path}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
            >
              {entry.isDirectory
                ? <Folder className="h-3.5 w-3.5 shrink-0 text-[#c4a882]" />
                : <File className="h-3.5 w-3.5 shrink-0 text-ink-soft/40" />
              }
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{entry.name}</span>
              <ChevronRight className="h-3 w-3 shrink-0 text-ink-soft/30" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
