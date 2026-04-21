import assert from 'node:assert/strict'
import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageList } from '../components/MessageList'
import type { Agent, AgentRunErrorEvent, Message } from '../lib/agents'

const agent: Agent = {
  id: 'zhang-yiming',
  role: 'WORKER',
  name: '张一鸣',
  domainLabel: '战略判断',
  status: 'idle',
}

const runError: AgentRunErrorEvent = {
  traceId: 'trace-zero',
  agentId: agent.id,
  agentName: agent.name,
  code: 'AGENT_STOPPED',
  title: '已停止回答',
  message: '已按你的要求停止这一轮回答，当前已生成的内容会被保留。',
  retryable: false,
  originalUserContent: '@张一鸣 继续说',
}

const message: Message = {
  id: 'msg-zero',
  agentRole: 'WORKER',
  agentName: agent.name,
  content: '已生成的内容会被保留。',
  timestamp: new Date('2026-04-21T12:53:00+08:00').getTime(),
  type: 'assistant',
  duration_ms: 0,
  total_cost_usd: 0,
  input_tokens: 0,
  output_tokens: 0,
  runError,
}

const markup = renderToStaticMarkup(
  <MessageList
    roomId="room-1"
    messages={[message]}
    agents={[agent]}
    state="DONE"
    sending={false}
    messageErrorMap={{}}
    orphanErrors={[]}
    showScrollBtn={false}
    containerRef={createRef<HTMLDivElement>()}
    endRef={createRef<HTMLDivElement>()}
    onScroll={() => {}}
    onScrollToBottom={() => {}}
    onPrefillMention={() => {}}
    onRetryFailedMessage={() => {}}
    onRestoreFailedInput={() => {}}
    onCopyFailedPrompt={() => {}}
    onTryAnotherAgent={() => {}}
  />,
)

assert.equal(
  />0(?:<\/div>|<div)/.test(markup),
  false,
  `numeric zero leaked into rendered markup:\n${markup}`,
)

console.log('message-stats-zero-regression: ok')
