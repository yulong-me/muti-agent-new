'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bot, Server, ChevronLeft, BrainCircuit } from 'lucide-react'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  const isAgents = pathname === '/settings/agents'
  const isProviders = pathname === '/settings/providers'
  const isScenes = pathname === '/settings/scenes'

  return (
    <div className="min-h-screen bg-bg">
      {/* Top nav */}
      <div className="bg-surface border-b border-line sticky top-0 z-10 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 text-ink-soft hover:text-ink text-[13px] transition-colors">
            <ChevronLeft className="w-4 h-4" /> 讨论室
          </Link>
          <span className="text-line">|</span>
          <Link
            href="/settings/agents"
            className={`flex items-center gap-1.5 text-[13px] font-medium transition-colors ${
              isAgents ? 'text-accent font-bold' : 'text-ink-soft hover:text-ink'
            }`}
          >
            <Bot className="w-3.5 h-3.5" /> Agent 配置
          </Link>
          <span className="text-line">|</span>
          <Link
            href="/settings/providers"
            className={`flex items-center gap-1.5 text-[13px] font-medium transition-colors ${
              isProviders ? 'text-accent font-bold' : 'text-ink-soft hover:text-ink'
            }`}
          >
            <Server className="w-3.5 h-3.5" /> CLI 连接
          </Link>
          <span className="text-line">|</span>
          <Link
            href="/settings/scenes"
            className={`flex items-center gap-1.5 text-[13px] font-medium transition-colors ${
              isScenes ? 'text-accent font-bold' : 'text-ink-soft hover:text-ink'
            }`}
          >
            <BrainCircuit className="w-3.5 h-3.5" /> 场景
          </Link>
        </div>
      </div>
      <div className="max-w-4xl mx-auto px-6 py-8">
        {children}
      </div>
    </div>
  )
}
