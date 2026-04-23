'use client'

import { Bot, BrainCircuit, Server } from 'lucide-react'

import type { SettingsTab } from '@/lib/settingsTabs'

export function SettingsTabSwitcher({
  tab,
  onChange,
}: {
  tab: SettingsTab
  onChange: (tab: SettingsTab) => void
}) {
  return (
    <div className="flex gap-1 settings-surface rounded-xl p-1">
      <button
        type="button"
        onClick={() => onChange('agent')}
        className={`px-4 py-1.5 rounded-lg text-[12px] font-bold transition-all flex items-center gap-1.5 ${tab === 'agent' ? 'shadow-sm text-ink' : 'text-ink-soft hover:text-ink'}`}
      >
        <Bot className="w-3.5 h-3.5" aria-hidden />
        Agent
      </button>
      <button
        type="button"
        onClick={() => onChange('provider')}
        className={`px-4 py-1.5 rounded-lg text-[12px] font-bold transition-all flex items-center gap-1.5 ${tab === 'provider' ? 'shadow-sm text-ink' : 'text-ink-soft hover:text-ink'}`}
      >
        <Server className="w-3.5 h-3.5" aria-hidden />
        CLI 连接
      </button>
      <button
        type="button"
        onClick={() => onChange('scene')}
        className={`px-4 py-1.5 rounded-lg text-[12px] font-bold transition-all flex items-center gap-1.5 ${tab === 'scene' ? 'shadow-sm text-ink' : 'text-ink-soft hover:text-ink'}`}
      >
        <BrainCircuit className="w-3.5 h-3.5" aria-hidden />
        场景
      </button>
      <button
        type="button"
        onClick={() => onChange('skill')}
        className={`px-4 py-1.5 rounded-lg text-[12px] font-bold transition-all flex items-center gap-1.5 ${tab === 'skill' ? 'shadow-sm text-ink' : 'text-ink-soft hover:text-ink'}`}
      >
        <BrainCircuit className="w-3.5 h-3.5" aria-hidden />
        Skill
      </button>
    </div>
  )
}
