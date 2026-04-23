'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { API_URL } from '@/lib/api'
import { debug, info as logInfo, warn } from '@/lib/logger'

const API = API_URL;

interface BrowseEntry {
  name: string
  path: string
  isDirectory: boolean
}

interface BrowseResult {
  current: string
  name: string
  parent: string | null
  homePath: string
  entries: BrowseEntry[]
}

interface DirectoryBrowserProps {
  initialPath?: string
  onSelect: (path: string) => void
  onCancel: () => void
}

/**
 * 解析绝对路径为面包屑分段。
 * 当路径在 homePath 下时：Home > 相对路径段（均可点击）。
 * 当路径在 homePath 外时：显示完整路径段（均可点击）。
 */
function pathToSegments(absPath: string, homePath: string): { label: string; path: string }[] {
  const sep = absPath.includes('\\') ? '\\' : '/'

  // Case 1: 在 home 下，使用 "Home" 作为根标签
  if (absPath === homePath || absPath.startsWith(homePath + sep)) {
    const segments: { label: string; path: string }[] = [{ label: 'Home', path: '' }]
    if (absPath === homePath) return segments

    const relative = absPath.slice(homePath.length + 1)
    if (!relative) return segments

    const parts = relative.split(/[/\\]/).filter(Boolean)
    let accumulated = homePath
    for (const part of parts) {
      accumulated += sep + part
      segments.push({ label: part, path: accumulated })
    }
    return segments
  }

  // Case 2: 在 home 外 — 所有分段均可点击
  const parts = absPath.split(/[/\\]/).filter(Boolean)
  const segments: { label: string; path: string }[] = []

  let accumulated = absPath.startsWith('/') ? '' : parts[0]
  const startIdx = absPath.startsWith('/') ? 0 : 1
  for (let i = startIdx; i < parts.length; i++) {
    accumulated += sep + parts[i]
    segments.push({ label: parts[i], path: accumulated })
  }

  return segments
}

export function DirectoryBrowser({ initialPath, onSelect, onCancel }: DirectoryBrowserProps) {
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [pathInput, setPathInput] = useState('')
  const [creatingDir, setCreatingDir] = useState(false)
  const [newDirName, setNewDirName] = useState('')
  const [mkdirError, setMkdirError] = useState<string | null>(null)
  const newDirInputRef = useRef<HTMLInputElement>(null)

  const fetchDirectory = useCallback(async (path?: string, fallbackOnForbidden = false) => {
    setIsLoading(true)
    setError(null)
    try {
      const url = path ? `${API}/api/browse?path=${encodeURIComponent(path)}` : `${API}/api/browse`
      const res = await fetch(url)
      if (!res.ok) {
        if (fallbackOnForbidden && path && res.status === 403) {
          setInfo('配置路径不可用，已切换到主目录')
          warn('ui:directory_browser:fallback_home', { path, status: res.status })
          await fetchDirectory(undefined, false)
          return
        }
        const data = await res.json()
        warn('ui:directory_browser:load_failed', {
          path: path ?? null,
          status: res.status,
          error: data.error || '无法读取目录',
        })
        setError(data.error || '无法读取目录')
        return
      }
      const data: BrowseResult = await res.json()
      setBrowseResult(data)
      setPathInput(data.current)
      debug('ui:directory_browser:loaded', {
        path: data.current,
        entryCount: data.entries.length,
      })
    } catch {
      warn('ui:directory_browser:network_failed', { path: path ?? null })
      setError('无法连接到服务器')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // 初始加载
  useEffect(() => {
    fetchDirectory(initialPath, !!initialPath)
  }, [fetchDirectory, initialPath])

  const handlePathSubmit = useCallback(() => {
    const trimmed = pathInput.trim()
    if (trimmed) {
      debug('ui:directory_browser:path_submit', { path: trimmed })
      fetchDirectory(trimmed)
    }
  }, [pathInput, fetchDirectory])

  const handleStartCreateDir = useCallback(() => {
    setCreatingDir(true)
    setNewDirName('')
    setMkdirError(null)
    debug('ui:directory_browser:mkdir_start')
    setTimeout(() => newDirInputRef.current?.focus(), 0)
  }, [])

  const handleCreateDir = useCallback(async () => {
    if (!newDirName.trim() || !browseResult) return
    setMkdirError(null)
    try {
      const res = await fetch(`${API}/api/browse/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: browseResult.current, name: newDirName.trim() }),
      })
      if (!res.ok) {
        const data = await res.json()
        warn('ui:directory_browser:mkdir_failed', {
          parentPath: browseResult.current,
          name: newDirName.trim(),
          status: res.status,
          error: data.error || '创建失败',
        })
        setMkdirError(data.error || '创建失败')
        return
      }
      const data = await res.json()
      setCreatingDir(false)
      setNewDirName('')
      logInfo('ui:directory_browser:mkdir_success', {
        parentPath: browseResult.current,
        name: data.name,
        createdPath: data.createdPath,
      })
      fetchDirectory(data.createdPath)
    } catch {
      warn('ui:directory_browser:mkdir_network_failed', {
        parentPath: browseResult.current,
        name: newDirName.trim(),
      })
      setMkdirError('无法连接到服务器')
    }
  }, [newDirName, browseResult, fetchDirectory])

  const segments = browseResult ? pathToSegments(browseResult.current, browseResult.homePath) : []

  // ESC 关闭
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-[color:var(--overlay-scrim)]" onClick={onCancel} />

      {/* 弹窗 */}
      <div className="relative z-10 bg-surface rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden border border-line"
           style={{ maxHeight: '70vh' }}
           role="dialog"
           aria-modal="true"
           aria-labelledby="directory-browser-title">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line flex-shrink-0">
          <h2 id="directory-browser-title" className="text-base font-bold text-ink">选择工作目录</h2>
          <button
            onClick={onCancel}
            className="p-1.5 text-ink-soft hover:text-ink hover:bg-surface-muted rounded-lg transition-colors"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 面包屑 + 新建文件夹 */}
        <div className="flex items-center gap-1 px-5 h-10 bg-surface-muted border-b border-line flex-shrink-0 overflow-x-auto">
          {segments.map((seg, i) => (
            <span key={seg.path || `_${i}`} className="flex items-center gap-1 flex-shrink-0">
              {i > 0 && (
                <svg aria-hidden="true" className="w-3 h-3 text-ink-soft/40" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                </svg>
              )}
              {i === segments.length - 1 ? (
                <span className="text-xs font-semibold text-ink">{seg.label}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => fetchDirectory(seg.path || undefined)}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  {i === 0 && seg.label === 'Home' ? (
                    <span className="flex items-center gap-1">
                      <HomeIcon />
                      {seg.label}
                    </span>
                  ) : seg.label}
                </button>
              )}
            </span>
          ))}

          {/* [+] 新建文件夹 */}
          <button
            type="button"
            onClick={handleStartCreateDir}
            className="ml-auto flex-shrink-0 px-2 py-1 flex items-center gap-1 rounded-md border border-accent/30 bg-bg/50 text-accent hover:bg-accent/10 hover:border-accent/50 transition-colors text-[11px] font-medium"
            title="新建文件夹"
          >
            <svg aria-hidden="true" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
            </svg>
            新建
          </button>
        </div>

        {/* 目录列表 */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5 min-h-0">
          {/* 新建文件夹输入框 */}
          {creatingDir && (
            <div className="px-3 py-2 rounded-lg ring-2 ring-accent bg-bg/80 mb-1">
              <div className="flex items-center gap-2">
                <FolderIcon className="text-accent flex-shrink-0" />
                <input
                  ref={newDirInputRef}
                  type="text"
                  value={newDirName}
                  onChange={e => setNewDirName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCreateDir()
                    if (e.key === 'Escape') {
                      setCreatingDir(false)
                      setMkdirError(null)
                    }
                  }}
                  placeholder="文件夹名称…"
                  className="flex-1 text-sm px-2 py-1 rounded border border-accent/30 bg-bg/80 text-ink placeholder:text-ink-soft/50 focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <button
                  type="button"
                  onClick={handleCreateDir}
                  disabled={!newDirName.trim()}
                  className="text-xs px-2.5 py-1 rounded bg-accent text-white hover:bg-accent/80 disabled:opacity-40 transition-colors"
                >
                  创建
                </button>
                <button
                  type="button"
                  onClick={() => { setCreatingDir(false); setMkdirError(null) }}
                  className="text-xs text-ink-soft hover:text-ink"
                >
                  取消
                </button>
              </div>
              {mkdirError && <p className="tone-danger-text mt-1 ml-6 text-[10px]">{mkdirError}</p>}
            </div>
          )}

          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <span className="text-xs text-ink-soft animate-pulse">Loading…</span>
            </div>
          )}

          {info && (
            <div className="px-3 py-1.5 mb-1">
              <p className="text-[10px] text-accent">{info}</p>
            </div>
          )}

          {error && (
            <div className="px-3 py-1.5 mb-1">
              <p className="tone-danger-text text-xs">{error}</p>
            </div>
          )}

          {!isLoading && browseResult && browseResult.entries.length === 0 && !creatingDir && (
            <div className="flex items-center justify-center py-8">
              <span className="text-xs text-ink-soft">无子目录</span>
            </div>
          )}

          {!isLoading && browseResult?.entries.map(entry => (
            <button
              key={entry.path}
              type="button"
              onClick={() => fetchDirectory(entry.path)}
              className="w-full text-left px-3 py-2.5 text-sm rounded-lg transition-colors flex items-center gap-2.5 hover:bg-surface-muted"
              title={entry.path}
            >
              <FolderIcon className="text-[#c4a882] flex-shrink-0" />
              <span className="font-medium text-ink truncate flex-1">{entry.name}</span>
              <svg aria-hidden="true" className="w-3.5 h-3.5 text-[#d4c0b3] flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
            </button>
          ))}
        </div>

        {/* 路径输入 */}
        <div className="px-5 py-3 border-t border-line space-y-2 flex-shrink-0">
          <div className="flex gap-2">
            <TerminalIcon />
            <label htmlFor="directory-browser-path" className="sr-only">输入路径</label>
            <input
              id="directory-browser-path"
              type="text"
              value={pathInput}
              onChange={e => setPathInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handlePathSubmit() }}
              placeholder="输入路径…"
              className="flex-1 text-xs px-3 py-2 rounded-xl bg-surface border border-line text-ink placeholder:text-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
            />
            {pathInput.trim() && (
              <button
                type="button"
                onClick={handlePathSubmit}
                className="px-2.5 py-2 rounded-xl border border-line bg-surface text-ink-soft hover:text-ink hover:bg-surface-muted transition-colors"
                aria-label="跳转到路径"
              >
                <svg aria-hidden="true" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>

          {/* 操作栏 */}
          <div className="flex items-center gap-2 pt-1">
            {browseResult && (
              <span className="text-[11px] text-ink-soft truncate flex-1" title={browseResult.current}>
                {browseResult.current}
              </span>
            )}
            <button
              type="button"
              onClick={async () => {
                try {
                  const res = await fetch(`${API}/api/browse/pick-directory`, { method: 'POST' })
                  if (res.status === 204 || res.status === 0) {
                    debug('ui:directory_browser:native_picker_cancelled')
                    return // 用户取消
                  }
                  if (!res.ok) {
                    const data = await res.json()
                    warn('ui:directory_browser:native_picker_failed', {
                      status: res.status,
                      error: data.error || '系统选择器失败',
                    })
                    setError(data.error || '系统选择器失败')
                    return
                  }
                  const data = await res.json()
                  logInfo('ui:directory_browser:native_picker_selected', { path: data.path })
                  onSelect(data.path)
                } catch {
                  warn('ui:directory_browser:native_picker_network_failed')
                  setError('无法打开系统选择器')
                }
              }}
              className="px-3 py-2 rounded-xl border border-line text-ink-soft text-xs font-medium transition-colors hover:bg-surface-muted hover:text-ink flex items-center gap-1"
              title="使用 macOS 原生文件夹选择器"
            >
              <FolderIcon className="w-3.5 h-3.5" />
              系统选择器
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-xl border border-line text-ink-soft text-xs font-medium transition-colors hover:bg-surface-muted hover:text-ink"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                if (!browseResult) return
                logInfo('ui:directory_browser:selected', { path: browseResult.current, source: 'manual' })
                onSelect(browseResult.current)
              }}
              disabled={!browseResult}
              className="px-5 py-2 rounded-xl bg-accent hover:bg-accent-deep text-white text-sm font-medium transition-colors disabled:opacity-40"
            >
              选择此目录
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function HomeIcon() {
  return (
    <svg aria-hidden="true" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
    </svg>
  )
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={`w-4 h-4 flex-shrink-0 ${className ?? ''}`} viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.62 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
    </svg>
  )
}

function TerminalIcon() {
  return (
    <svg aria-hidden="true" className="w-3.5 h-3.5 text-ink-soft mt-2.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 014.25 2h11.5A2.25 2.25 0 0118 4.25v11.5A2.25 2.25 0 0115.75 18H4.25A2.25 2.25 0 012 15.75V4.25zM7.664 6.23a.75.75 0 00-1.078 1.04l2.705 2.805-2.705 2.805a.75.75 0 001.078 1.04l3.25-3.37a.75.75 0 000-1.04l-3.25-3.28zM11 13a.75.75 0 000 1.5h3a.75.75 0 000-1.5h-3z" clipRule="evenodd" />
    </svg>
  )
}
