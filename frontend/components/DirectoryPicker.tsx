'use client'

import { useRef } from 'react'

interface DirectoryPickerProps {
  value: string
  onChange: (path: string) => void
  placeholder?: string
  className?: string
}

/**
 * 目录选择器：输入框 + "浏览"按钮触发系统目录选择器。
 * 支持 Electron（File.path）和浏览器（webkitRelativePath）两种路径获取方式。
 */
export function DirectoryPicker({ value, onChange, placeholder = '/path/to/directory', className = '' }: DirectoryPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 px-4 py-2.5 rounded-xl bg-bg border border-line text-[14px] text-ink placeholder:text-ink-soft/50 focus:outline-none focus:border-accent/50 transition-colors"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="px-4 py-2.5 rounded-xl bg-surface-muted border border-line text-[13px] text-ink-soft hover:text-ink hover:bg-line transition-colors flex-shrink-0"
      >
        浏览
      </button>
      {/* Hidden directory picker — triggers native OS directory dialog */}
      <input
        ref={inputRef}
        type="file"
        {...({
          webkitdirectory: '',
          mozdirectory: '',
          msdirectory: '',
          odirectory: '',
        } as React.InputHTMLAttributes<HTMLInputElement>)}
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (!file) return
          // Electron: File.path contains the full absolute path
          const electronPath = (file as File & { path?: string }).path
          if (electronPath) {
            onChange(electronPath)
          } else {
            // Browser fallback: extract directory name from webkitRelativePath
            const segments = file.webkitRelativePath.split('/')
            const dir = segments[0] || ''
            onChange(dir.startsWith('/') ? dir : `/${dir}`)
          }
          // Reset so the same directory can be re-selected
          if (inputRef.current) inputRef.current.value = ''
        }}
      />
    </div>
  )
}
