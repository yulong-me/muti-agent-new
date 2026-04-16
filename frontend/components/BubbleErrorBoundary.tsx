'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorBubble } from './ErrorBubble'
import type { AgentRunErrorEvent } from '../lib/agents'

interface BubbleErrorBoundaryProps {
  agentId?: string
  agentName: string
  children: ReactNode
}

interface BubbleErrorBoundaryState {
  error: Error | null
  traceId: string
}

function makeTraceId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `ui-${crypto.randomUUID()}`
  }
  return `ui-${Date.now().toString(36)}`
}

export class BubbleErrorBoundary extends Component<BubbleErrorBoundaryProps, BubbleErrorBoundaryState> {
  state: BubbleErrorBoundaryState = {
    error: null,
    traceId: '',
  }

  static getDerivedStateFromError(error: Error): BubbleErrorBoundaryState {
    return {
      error,
      traceId: makeTraceId(),
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep raw render errors in developer logs, not in user-facing UI.
    console.error('bubble.render_error', {
      traceId: this.state.traceId,
      agentName: this.props.agentName,
      error: error.message,
      componentStack: info.componentStack,
    })
  }

  render() {
    if (this.state.error) {
      const runError: AgentRunErrorEvent = {
        traceId: this.state.traceId || makeTraceId(),
        agentId: this.props.agentId ?? 'ui',
        agentName: this.props.agentName,
        code: 'UI_RENDER_ERROR',
        title: '消息显示遇到问题',
        message: '这条消息显示时遇到了问题，原始错误已记录到开发日志。你可以继续查看后续内容或稍后刷新页面。',
        retryable: false,
      }
      return <ErrorBubble error={runError} />
    }

    return this.props.children
  }
}
