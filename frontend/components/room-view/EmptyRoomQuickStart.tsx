'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, BrainCircuit, Code2, FileText, MessagesSquare, Scale, Search } from 'lucide-react'
import { API_URL } from '../../lib/api'

export interface QuickStartTemplate {
  id: string
  title: string
  description: string
  topic: string
  sceneId: string
  agentIds: string[]
  icon: 'litigation' | 'competitor' | 'paper' | 'roundtable' | 'software'
}

interface AgentSummary {
  id: string
  provider: string
}

interface ProviderReadiness {
  provider: string
  label: string
  status: 'ready' | 'cli_missing' | 'untested' | 'test_failed'
}

const READINESS_META = {
  ready: { label: 'Ready', className: 'tone-success-pill border' },
  cli_missing: { label: 'CLI 未配置', className: 'tone-danger-panel border' },
  untested: { label: '待测试', className: 'tone-warning-pill border' },
  test_failed: { label: '测试失败', className: 'tone-warning-pill border' },
} as const

export const QUICK_START_TEMPLATES: QuickStartTemplate[] = [
  {
    id: 'litigation-strategy',
    title: '诉讼策略',
    description: '事实、证据、主张与对方打法一次铺开。',
    topic: '制定诉讼策略：梳理事实、证据、主张、对方可能打法和下一步材料清单',
    sceneId: 'litigation-strategy',
    agentIds: [
      'litigation-case-mapper',
      'litigation-evidence-strategist',
      'litigation-opposing-counsel',
      'litigation-risk-controller',
    ],
    icon: 'litigation',
  },
  {
    id: 'competitor-analysis',
    title: '竞品分析',
    description: '定位、用户、渠道、价格和护城河对比。',
    topic: '做一次竞品分析：明确目标用户、直接竞品、定位差异、威胁排序和最小验证动作',
    sceneId: 'competitor-analysis',
    agentIds: [
      'competitor-market-mapper',
      'competitor-positioning-strategist',
      'competitor-product-skeptic',
      'competitor-gtm-operator',
    ],
    icon: 'competitor',
  },
  {
    id: 'paper-revision',
    title: '论文返修',
    description: '拆审稿意见，定修改清单和 rebuttal。',
    topic: '处理论文返修：逐条拆解审稿意见，制定修改计划、补实验优先级和 rebuttal 草稿',
    sceneId: 'paper-revision',
    agentIds: [
      'paper-review-diagnoser',
      'paper-methods-editor',
      'paper-rebuttal-writer',
      'paper-hostile-reviewer',
    ],
    icon: 'paper',
  },
  {
    id: 'roundtable-forum',
    title: '圆桌论坛',
    description: '让不同思维模型正面交锋后收敛。',
    topic: '开一场圆桌论坛：围绕一个关键问题交锋、反驳、收敛分歧并给出结论',
    sceneId: 'roundtable-forum',
    agentIds: ['paul-graham', 'steve-jobs', 'zhang-yiming', 'munger', 'taleb'],
    icon: 'roundtable',
  },
  {
    id: 'software-development',
    title: '软件开发',
    description: '双架构、实现、Reviewer 形成工程闭环。',
    topic: '推进一次软件开发任务：澄清需求、收敛架构、安排实现、建立测试和 review 门禁',
    sceneId: 'software-development',
    agentIds: ['dev-architect', 'dev-challenge-architect', 'dev-implementer', 'dev-reviewer'],
    icon: 'software',
  },
]

const TEMPLATE_ICONS = {
  litigation: Scale,
  competitor: Search,
  paper: FileText,
  roundtable: MessagesSquare,
  software: Code2,
}

interface EmptyRoomQuickStartProps {
  onStartBlank: () => void
  onStartTemplate: (template: QuickStartTemplate) => void
}

export function EmptyRoomQuickStart({
  onStartBlank,
  onStartTemplate,
}: EmptyRoomQuickStartProps) {
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [providerReadiness, setProviderReadiness] = useState<Record<string, ProviderReadiness>>({})
  const agentsById = useMemo(() => new Map(agents.map(agent => [agent.id, agent])), [agents])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${API_URL}/api/agents`).then(response => response.json()).catch(() => []),
      fetch(`${API_URL}/api/providers/readiness`).then(response => response.json()).catch(() => ({})),
    ]).then(([nextAgents, readiness]) => {
      if (cancelled) return
      setAgents(nextAgents)
      setProviderReadiness(readiness)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function getTemplateReadiness(template: QuickStartTemplate) {
    const providerNames = [...new Set(template.agentIds.map(agentId => agentsById.get(agentId)?.provider).filter(Boolean))]
    const statuses = providerNames
      .map(provider => providerReadiness[provider as string])
      .filter((readiness): readiness is ProviderReadiness => Boolean(readiness))

    if (statuses.some(readiness => readiness.status === 'cli_missing')) {
      return READINESS_META.cli_missing
    }
    if (statuses.some(readiness => readiness.status === 'test_failed')) {
      return READINESS_META.test_failed
    }
    if (statuses.some(readiness => readiness.status === 'untested')) {
      return READINESS_META.untested
    }
    if (statuses.some(readiness => readiness.status === 'ready')) {
      return READINESS_META.ready
    }
    return null
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-5 py-8 md:px-10">
      <div className="w-full max-w-6xl">
        <div className="mb-7 flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-surface shadow-sm">
            <BrainCircuit className="h-5 w-5 text-accent" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-accent">OpenCouncil</p>
            <h2 className="mt-2 text-2xl font-bold leading-tight text-ink md:text-3xl">
              开一场专家会议，而不是从空白聊天开始。
            </h2>
            <p className="mt-3 max-w-2xl text-[14px] leading-6 text-ink-soft">
              选择一个入口，确认场景和专家后进入讨论室；交接、质疑、结论都会留在同一条决策链里。
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {QUICK_START_TEMPLATES.map(template => {
            const Icon = TEMPLATE_ICONS[template.icon]
            const readiness = getTemplateReadiness(template)
            return (
              <button
                key={template.id}
                type="button"
                onClick={() => onStartTemplate(template)}
                className="group flex min-h-36 flex-col justify-between rounded-lg border border-line bg-surface px-4 py-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/45 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-muted text-accent">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <ArrowRight className="h-4 w-4 text-ink-soft opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden />
                </span>
                <span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="block text-[15px] font-bold text-ink">{template.title}</span>
                    {readiness && readiness.label !== 'Ready' && (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${readiness.className}`}>
                        {readiness.label}
                      </span>
                    )}
                  </span>
                  <span className="mt-1.5 block text-[12px] leading-5 text-ink-soft">{template.description}</span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onStartBlank}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-5 py-3 text-[14px] font-bold text-bg shadow-sm transition-opacity hover:opacity-90"
          >
            发起新讨论
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
          <p className="text-[12px] text-ink-soft">
            已有讨论仍在左侧；这里始终保留给下一场会议。
          </p>
        </div>
      </div>
    </div>
  )
}
