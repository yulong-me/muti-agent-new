'use client'

import { useState } from 'react'
import { Plus, MessageSquare, X, Trash2, MoreHorizontal } from 'lucide-react'
import {
  formatRelativeTime,
  type DiscussionState,
} from '../lib/agents'

// Simple palette for sidebar avatar circles (indexable array)
const AVATAR_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899']

interface SidebarRoom {
  id: string
  topic: string
  createdAt: number
  updatedAt: number
  state: DiscussionState
  workspace?: string
  preview?: string
  agentCount: number
}

interface RoomListSidebarProps {
  rooms: SidebarRoom[]
  currentRoomId?: string
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
  onClick,
  onDelete,
}: {
  room: SidebarRoom
  isActive: boolean
  onClick: () => void
  onDelete: (roomId: string) => void
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showWorkspace, setShowWorkspace] = useState(false)

  const handleDelete = (e: React.KeyboardEvent | React.MouseEvent) => {
    e.stopPropagation()
    setShowDeleteConfirm(true)
  }

  const confirmDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowDeleteConfirm(false)
    onDelete(room.id)
  }

  const cancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowDeleteConfirm(false)
  }

  const workspaceShort = room.workspace
    ? room.workspace.length > 24
      ? '…' + room.workspace.slice(-24)
      : room.workspace
    : null

  return (
    <div className="relative mb-2">
      {/* Overlay delete confirmation — does NOT replace the card */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-surface/95 backdrop-blur-sm border border-red-400/30 shadow-xl p-3">
          <div className="text-center">
            <p className="text-[12px] font-medium text-red-400 mb-2.5">删除「{room.topic}」？</p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={confirmDelete}
                className="px-3 py-1.5 text-[12px] rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors font-medium"
              >
                删除
              </button>
              <button
                onClick={cancelDelete}
                className="px-3 py-1.5 text-[12px] rounded-lg bg-white/10 text-ink hover:bg-white/20 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Card — single semantic button, clean keyboard navigation */}
      <button
        type="button"
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault()
            handleDelete(e)
          }
        }}
        className={`w-full text-left p-3.5 rounded-xl transition-colors border group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
          isActive
            ? 'bg-white/[0.06] border-white/[0.10]'
            : 'border-transparent hover:bg-white/[0.04] hover:border-white/[0.06]'
        }`}
      >
        {/* Top row: title + status badge + overflow menu */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <MessageSquare className="w-3.5 h-3.5 text-ink-soft/50 flex-shrink-0 mt-0.5" />
            <span className="text-[14px] font-medium text-ink truncate">{room.topic}</span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              room.state === 'RUNNING'
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-white/10 text-ink-soft/60'
            }`}>
              {room.state === 'RUNNING' ? '进行中' : '已完成'}
            </span>
            {/* Overflow menu: delete on desktop hover + always on mobile */}
            <div className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowDeleteConfirm(true)
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-ink-soft/60 hover:text-red-400 hover:bg-red-500/10 transition-all"
                aria-label={`删除讨论：${room.topic}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Summary row: agent count + preview */}
        <div className="mt-1.5 pl-5.5 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <div className="flex -space-x-1.5">
              {Array.from({ length: Math.min(room.agentCount, 3) }).map((_, i) => (
                <div
                  key={i}
                  className="w-4 h-4 rounded-full border border-white/20 flex items-center justify-center text-[9px] font-bold text-white/80"
                                    style={{ backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
                >
                  {i + 1}
                </div>
              ))}
            </div>
            <span className="text-[11px] text-ink-soft/60">
              {room.agentCount} 位专家{room.agentCount > 3 ? '+' : ''}
            </span>
          </div>
          {room.preview && (
            <p className="text-[12px] text-ink-soft/60 truncate leading-relaxed">{room.preview}</p>
          )}
        </div>

        {/* Bottom row: time + workspace */}
        <div className="mt-1.5 pl-5.5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-ink-soft/40">{formatRelativeTime(room.updatedAt)}</span>
          {workspaceShort && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowWorkspace(v => !v) }}
              className="text-[10px] text-ink-soft/40 hover:text-ink-soft/70 transition-colors truncate max-w-[120px]"
              title={showWorkspace ? undefined : room.workspace}
            >
              {showWorkspace ? room.workspace : workspaceShort}
            </button>
          )}
        </div>
      </button>
    </div>
  )
}

// ─── Desktop sidebar ──────────────────────────────────────────────────────────

export function RoomListSidebarDesktop({
  rooms,
  currentRoomId,
  onNewRoom,
  onSelectRoom,
  onDeleteRoom,
}: Omit<RoomListSidebarProps, 'mobileMenuOpen' | 'onToggleMobileMenu' | 'onCloseMobileMenu'>) {
  return (
    <div className="app-islands-panel hidden md:flex w-[280px] bg-surface border-r border-white/[0.08] flex-col z-20">
      <div className="p-5 border-b border-white/[0.06] flex items-center justify-between shrink-0">
        <h2 className="text-[15px] font-bold text-ink">讨论历史</h2>
        <button
          onClick={onNewRoom}
          className="w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center text-ink hover:text-accent hover:bg-white/[0.10] transition-colors"
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
            onClick={() => onSelectRoom(room.id)}
            onDelete={onDeleteRoom}
          />
        ))}
        {rooms.length === 0 && (
          <p className="text-xs text-ink-soft/50 text-center mt-6">暂无讨论记录</p>
        )}
      </div>
    </div>
  )
}

// ─── Mobile overlay menu ──────────────────────────────────────────────────────

export function RoomListSidebarMobile({
  rooms,
  currentRoomId,
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
        className="absolute right-0 top-0 bottom-0 w-[80%] max-w-[300px] bg-surface border-l border-white/[0.08] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 border-b border-white/[0.06] flex items-center justify-between shrink-0">
          <h2 className="text-[15px] font-bold text-ink">讨论历史</h2>
          <button
            onClick={onCloseMobileMenu}
            aria-label="关闭菜单"
            className="p-2 text-ink-soft hover:text-ink hover:bg-white/[0.06] rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-3 shrink-0">
          <button
            onClick={() => { onNewRoom(); onCloseMobileMenu?.() }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent text-white hover:bg-accent/90 transition-colors text-sm font-medium"
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
              onClick={() => { onSelectRoom(room.id); onCloseMobileMenu?.() }}
              onDelete={onDeleteRoom}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
