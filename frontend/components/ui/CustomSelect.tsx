'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface CustomSelectOption<T extends string = string> {
  value: T
  label: string
  description?: string
  disabled?: boolean
}

export function CustomSelect<T extends string = string>({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = '请选择',
  ariaLabel,
  className = '',
  buttonClassName = '',
  menuClassName = '',
}: {
  value: T
  options: Array<CustomSelectOption<T>>
  onChange: (value: T) => void
  disabled?: boolean
  placeholder?: string
  ariaLabel?: string
  className?: string
  buttonClassName?: string
  menuClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const selected = options.find(option => option.value === value)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function choose(option: CustomSelectOption<T>) {
    if (option.disabled) return
    onChange(option.value)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(previous => !previous)}
        onKeyDown={event => {
          if (event.key === 'Escape') setOpen(false)
          if ((event.key === 'Enter' || event.key === ' ') && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className={`flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left text-[14px] text-ink transition-colors hover:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50 ${buttonClassName}`}
      >
        <span className="min-w-0">
          <span className={`block truncate ${selected ? 'font-semibold text-ink' : 'text-ink-faint'}`}>
            {selected?.label ?? placeholder}
          </span>
          {selected?.description && (
            <span className="mt-0.5 block truncate text-[11px] font-normal text-ink-faint">
              {selected.description}
            </span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink-soft transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div
          id={menuId}
          role="listbox"
          className={`absolute left-0 right-0 top-full layer-dropdown mt-1 max-h-64 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl custom-scrollbar ${menuClassName}`}
        >
          {options.map(option => {
            const active = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                disabled={option.disabled}
                onClick={() => choose(option)}
                className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  active ? 'bg-accent/10 text-accent' : 'text-ink hover:bg-surface-muted'
                }`}
              >
                <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${active ? 'opacity-100' : 'opacity-0'}`} aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold">{option.label}</span>
                  {option.description && (
                    <span className="mt-0.5 block line-clamp-2 text-[11px] font-normal text-ink-faint">
                      {option.description}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
