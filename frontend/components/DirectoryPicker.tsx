'use client'

import { useState } from 'react'
import { FolderSearch } from 'lucide-react'
import { DirectoryBrowser } from './DirectoryBrowser'

interface DirectoryPickerProps {
  value: string
  onChange: (path: string) => void
  placeholder?: string
  className?: string
}

/**
 * 目录路径输入框 + 浏览按钮（参考 clowder-ai LinkedRootsManager + DirectoryBrowser 风格）。
 * "浏览" 打开 web 目录导航弹窗。
 */
export function DirectoryPicker({ value, onChange, placeholder = '/Users/.../project', className = '' }: DirectoryPickerProps) {
  const [showBrowser, setShowBrowser] = useState(false)

  return (
    <>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`flex-1 px-4 py-2.5 rounded-xl bg-bg border border-line text-[14px] text-ink placeholder:text-ink-soft/50 focus:outline-none focus:border-accent/50 transition-colors ${className}`}
        />
        <button
          type="button"
          onClick={() => setShowBrowser(true)}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-line bg-surface text-ink-soft hover:text-ink hover:bg-bg transition-colors text-[14px] font-medium flex-shrink-0"
          title="浏览目录"
        >
          <FolderSearch className="w-4 h-4" aria-hidden />
          浏览
        </button>
      </div>

      {showBrowser && (
        <DirectoryBrowser
          initialPath={value || undefined}
          onSelect={(path) => {
            onChange(path)
            setShowBrowser(false)
          }}
          onCancel={() => setShowBrowser(false)}
        />
      )}
    </>
  )
}
