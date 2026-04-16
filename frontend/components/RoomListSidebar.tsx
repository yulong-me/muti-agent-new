'use client'

import { useState } from 'react'
import { Plus, MessageSquare, X, Trash2 } from 'lucide-react'
import {
  AGENT_COLORS,
  DEFAULT_AGENT_COLOR,
  formatRelativeTime,
  type Agent,
  type DiscussionState,
} from '../lib/agents'
import { AgentAvatar } from './AgentAvatar'

interface SidebarRoom {
  id: string
  topic: string
  createdAt: number
  state: DiscussionState
}

interface RoomListSidebarProps {
  rooms: SidebarRoom[]
  currentRoomId?: string
  roomsAgentsMap: Record<string, Agent[]>
  roomsLastToAgentMap: Record<string, string | undefined>
  onNewRoom: () => void
  onSelectRoom: (roomId: string) => void
  onDeleteRoom: (roomId: string) => void
  mobileMenuOpen?: boolean
  onToggleMobileMenu?: () => void
  onCloseMobileMenu?: () => void
}

function RoomItem({
  room,
  isActive,
  roomsAgentsMap,
  roomsLastToAgentMap,
  onClick,
  onDelete,
}: {
  room: SidebarRoom
  isActive: boolean
  roomsAgentsMap: Record<string, Agent[]>
  roomsLastToAgentMap: Record<string, string | undefined>
  onClick: () => void
  onDelete: (roomId: string) => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const lastToAgentId = roomsLastToAgentMap[room.id]
  const roomAgents = roomsAgentsMap[room.id] || []
  const lastRecipient = lastToAgentId ? roomAgents.find(a => a.id === lastToAgentId) : null
  const lastRecipientColors = lastRecipient
    ? AGENT_COLORS[lastRecipient.name] || DEFAULT_AGENT_COLOR
    : null

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmOpen(true)
  }

  const confirmDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmOpen(false)
    onDelete(room.id)
  }

  return (
    <div className="relative">
      {confirmOpen ? (
        <div className="p-3.5 rounded-xl mb-2 border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
          <p className="text-[13px] font-medium text-red-600 dark:text-red-400 mb-2">确定删除此讨论？</p>
          <div className="flex gap-2">
            <button
              onClick={confirmDelete}
              className="px-3 py-1.5 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors font-medium"
            >
              删除
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmOpen(false) }}
              className="px-3 py-1.5 text-xs rounded-lg bg-surface-muted text-ink hover:bg-line transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={onClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Space') onClick()
          }}
          className={`p-3.5 rounded-xl mb-2 cursor-pointer transition-colors border group ${
            isActive ? 'bg-surface-muted border-line' : 'border-transparent hover:bg-surface-muted/50'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-[14px] font-medium text-ink truncate flex-1 flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClick(); }}
                className="truncate text-left"
                aria-pressed={isActive}
                aria-label={`进入讨论：${room.topic}`}
              >
                {room.topic}
              </button>
            </p>
            <div className="flex items-center gap-1 flex-shrink-0">
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  room.state === 'RUNNING'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-ink-soft/10 text-ink-soft'
                }`}
              >
                {room.state === 'RUNNING' ? '进行中' : '已完成'}
              </span>
              <button
                type="button"
                onClick={handleDelete}
                className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-ink-soft hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50 transition-all"
                aria-label={`删除讨论：${room.topic}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {lastRecipient && lastRecipientColors && (
            <div className="mt-1.5 flex items-center gap-1 ml-5.5">
              <span className="text-[10px] text-ink-soft">正在和</span>
              <AgentAvatar
                src={lastRecipientColors.avatar}
                alt={`${lastRecipient.name} 头像`}
                size={14}
                className="w-3.5 h-3.5 rounded-full"
              />
              <span className="text-[10px] font-medium" style={{ color: lastRecipientColors.bg }}>
                {lastRecipient.name}
              </span>
              <span className="text-[10px] text-ink-soft">对话</span>
            </div>
          )}
          <p className="text-[11px] text-ink-soft mt-1 ml-5.5">
            {formatRelativeTime(room.createdAt)}
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Desktop sidebar ──────────────────────────────────────────────────────────

export function RoomListSidebarDesktop({
  rooms,
  currentRoomId,
  roomsAgentsMap,
  roomsLastToAgentMap,
  onNewRoom,
  onSelectRoom,
  onDeleteRoom,
}: Omit<RoomListSidebarProps, 'mobileMenuOpen' | 'onToggleMobileMenu' | 'onCloseMobileMenu'>) {
  return (
    <div className="app-islands-panel hidden md:flex w-[280px] bg-surface border-r border-line flex-col z-20">
      <div className="p-5 border-b border-line flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-ink">讨论历史</h2>
        <button
          onClick={onNewRoom}
          className="app-islands-item w-8 h-8 rounded-full bg-surface-muted flex items-center justify-center text-ink hover:text-accent hover:bg-line transition-colors"
          aria-label="发起讨论"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
        {rooms.map(room => (
          <RoomItem
            key={room.id}
            room={room}
            isActive={room.id === currentRoomId}
            roomsAgentsMap={roomsAgentsMap}
            roomsLastToAgentMap={roomsLastToAgentMap}
            onClick={() => onSelectRoom(room.id)}
            onDelete={onDeleteRoom}
          />
        ))}
        {rooms.length === 0 && (
          <p className="text-xs text-ink-soft text-center mt-6">暂无讨论记录</p>
        )}
      </div>
    </div>
  )
}

// ─── Mobile overlay menu ──────────────────────────────────────────────────────

export function RoomListSidebarMobile({
  rooms,
  currentRoomId,
  roomsAgentsMap,
  roomsLastToAgentMap,
  onNewRoom,
  onSelectRoom,
  onDeleteRoom,
  mobileMenuOpen,
  onToggleMobileMenu,
  onCloseMobileMenu,
}: RoomListSidebarProps) {
  if (!mobileMenuOpen) return null

  return (
    <div className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-xl -webkit-backdrop-blur-xl" onClick={onToggleMobileMenu}>
      <div
        className="app-islands-panel w-[80%] max-w-[300px] h-full bg-surface border-r border-white/[0.08] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 border-b border-white/[0.06] flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-ink">讨论历史</h2>
          <button
            onClick={onCloseMobileMenu}
            aria-label="关闭菜单"
            className="p-2 text-ink-soft hover:text-ink"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-3">
          <button
            onClick={() => { onNewRoom(); onCloseMobileMenu?.() }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent text-white hover:bg-accent-deep transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            发起新讨论
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
          {rooms.map(room => (
            <RoomItem
              key={room.id}
              room={room}
              isActive={room.id === currentRoomId}
              roomsAgentsMap={roomsAgentsMap}
              roomsLastToAgentMap={roomsLastToAgentMap}
              onClick={() => { onSelectRoom(room.id); onCloseMobileMenu?.() }}
              onDelete={onDeleteRoom}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
