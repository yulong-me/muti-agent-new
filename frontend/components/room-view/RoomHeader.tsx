'use client'

import { ChevronLeft, ChevronRight, Menu, UserPlus, Users } from 'lucide-react'

import { DepthSwitcher } from './DepthSwitcher'

interface RoomHeaderProps {
  roomId?: string
  currentRoomTopic?: string
  maxA2ADepth: number | null
  currentA2ADepth: number
  displayMaxDepth: number
  onChangeDepth: (newDepth: number | null) => void
  onToggleMobileMenu: () => void
  onOpenAgentDrawer: () => void
  onOpenInviteDrawer: () => void
  agentPanelCollapsed: boolean
  onToggleAgentPanel: () => void
}

export function RoomHeader({
  roomId,
  currentRoomTopic,
  maxA2ADepth,
  currentA2ADepth,
  displayMaxDepth,
  onChangeDepth,
  onToggleMobileMenu,
  onOpenAgentDrawer,
  onOpenInviteDrawer,
  agentPanelCollapsed,
  onToggleAgentPanel,
}: RoomHeaderProps) {
  return (
    <div className="h-[60px] md:h-16 bg-nav-bg border-b border-line px-4 md:px-6 flex items-center justify-between sticky top-0 z-10">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="md:hidden p-2 -ml-2 text-ink-soft hover:text-ink"
          onClick={onToggleMobileMenu}
          aria-label="打开讨论历史"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="min-w-0 truncate text-[15px] font-bold text-ink md:text-base">
          {currentRoomTopic || '开始新讨论'}
        </h1>
      </div>
      <div className="flex items-center gap-2 md:gap-4">
        {roomId && (
          <DepthSwitcher
            value={maxA2ADepth}
            currentDepth={currentA2ADepth}
            maxDepth={displayMaxDepth}
            onChange={onChangeDepth}
          />
        )}
        {roomId && (
          <button
            type="button"
            onClick={onOpenAgentDrawer}
            className="md:hidden p-2 text-ink-soft hover:text-accent transition-colors"
            aria-label="查看讨论成员"
          >
            <Users className="w-5 h-5" />
          </button>
        )}
        <button
          type="button"
          onClick={onOpenInviteDrawer}
          className="p-2 text-ink-soft hover:text-accent transition-colors"
          aria-label="邀请 Agent 参与讨论"
        >
          <UserPlus className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={onToggleAgentPanel}
          className="hidden lg:inline-flex p-2 text-ink-soft hover:text-accent transition-colors"
          aria-label={agentPanelCollapsed ? '展开讨论成员面板' : '收起讨论成员面板'}
          title={agentPanelCollapsed ? '展开讨论成员面板' : '收起讨论成员面板'}
        >
          {agentPanelCollapsed ? (
            <ChevronLeft className="w-5 h-5" />
          ) : (
            <ChevronRight className="w-5 h-5" />
          )}
        </button>
      </div>
    </div>
  )
}
