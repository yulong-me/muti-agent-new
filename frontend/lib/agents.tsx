import { type Components } from 'react-markdown'

// ─── Types ───────────────────────────────────────────────────────────────────

export type DiscussionState = 'RUNNING' | 'DONE'
export type AgentRole = 'MANAGER' | 'WORKER' | 'USER'

export interface Agent {
  id: string
  role: AgentRole
  name: string
  domainLabel: string
  status: 'idle' | 'thinking' | 'waiting' | 'done'
  /** Reference to agent config ID in agentsRepo — used for invite logic */
  configId?: string
}

export interface Message {
  id: string
  agentRole: AgentRole | 'USER'
  agentName: string
  content: string
  timestamp: number
  type: string
  thinking?: string
  duration_ms?: number
  total_cost_usd?: number
  input_tokens?: number
  output_tokens?: number
  toAgentId?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const STATE_LABELS: Record<DiscussionState, string> = {
  RUNNING: '讨论中',
  DONE: '已完成',
}

export const AGENT_COLORS: Record<string, { bg: string; text: string; avatar: string }> = {
  主持人: { bg: '#4F46E5', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=host&backgroundColor=b6e3f4' },
  司马迁: { bg: '#D97706', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=simaqian' },
  诸葛亮: { bg: '#059669', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=zhugeliang' },
  李世民: { bg: '#DC2626', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=lishimin' },
  孔子: { bg: '#4D7C0F', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=confucius' },
  曹操: { bg: '#9F1239', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=caocao' },
  马斯克: { bg: '#2563EB', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=musk' },
  乔布斯: { bg: '#7C3AED', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jobs' },
  爱因斯坦: { bg: '#0284C7', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=einstein' },
  图灵: { bg: '#0D9488', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=turing' },
  马云: { bg: '#EA580C', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=mayun' },
}

export const DEFAULT_AGENT_COLOR = { bg: '#10B981', text: '#FFFFFF', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=agent&backgroundColor=c0aede' }
export const TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format timestamp as relative time (e.g. "2分钟前", "3小时前", "昨天") */
export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时前`
  const day = Math.floor(hr / 24)
  if (day === 1) return '昨天'
  if (day < 7) return `${day}天前`
  return new Date(ts).toLocaleDateString('zh')
}

// Extract @mentioned agent names from markdown content
// Matches patterns like "@哲学家" or "[@经济学家](url)" in markdown
export function extractMentions(content: string): string[] {
  const seen = new Set<string>()
  const patterns = [
    /\[@([^\]]+)\]\([^)]+\)/g, // [@name](url)
    /@([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef_a-zA-Z0-9]{1,20})/g, // @name (Chinese + common chars)
  ]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1].trim()
      if (name && name.length > 0 && !seen.has(name)) {
        seen.add(name)
      }
    }
  }
  return Array.from(seen)
}

// ─── Markdown components (shared) ───────────────────────────────────────────

export const mdComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 break-words">{children}</p>,
  h1: ({ children }) => <h1 className="text-base font-bold mb-2 mt-3 text-ink first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold mb-2 mt-3 text-ink first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-2 text-ink first:mt-0">{children}</h3>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5 text-ink">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5 text-ink">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-line pl-3 my-2 italic text-ink-soft">{children}</blockquote>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline break-all">{children}</a>,
  pre: ({ children }) => <pre className="bg-surface-muted text-ink rounded-lg p-3 overflow-x-auto text-xs font-mono my-2">{children}</pre>,
  code: ({ children }) => <code className="bg-surface-muted/70 text-ink rounded px-1.5 py-0.5 text-[0.85em] font-mono">{children}</code>,
  table: ({ children }) => <table className="w-full border-collapse text-[13px] my-2 min-w-0">{children}</table>,
  thead: ({ children }) => <thead className="bg-surface-muted">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-line">{children}</tbody>,
  tr: ({ children }) => <tr className="hover:bg-surface-muted/30 transition-colors">{children}</tr>,
  th: ({ children }) => <th className="border border-line px-3 py-1.5 text-left font-semibold text-ink whitespace-nowrap">{children}</th>,
  td: ({ children }) => <td className="border border-line px-3 py-1.5 text-ink whitespace-nowrap">{children}</td>,
}
