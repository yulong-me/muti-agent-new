'use client'

import { useState } from 'react'
import { Plus, MessageSquare, X, Trash2, Settings, Moon, Sun } from 'lucide-react'
import {
  formatRelativeTime,
  type DiscussionState,
} from '../lib/agents'

// Simple palette for sidebar avatar circles (indexable array)
const AVATAR_COLORS = ['#c43a2f', '#d17a24', '#3d8a61', '#9b5c44', '#8c6a58', '#b55d3d']

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
  theme?: string
  mounted?: boolean
  onToggleTheme?: () => void
  onOpenSystemSettings?: () => void
  mobileMenuOpen?: boolean
  onToggleMobileMenu?: () => void
  onCloseMobileMenu?: () => void
}

function SidebarBrand() {
  return (
    <div className="min-w-0">
      <p className="truncate text-[15px] font-extrabold tracking-[-0.02em] text-ink">OpenCouncil</p>
    </div>
  )
}

function SidebarHistoryHeader({
  roomCount,
  onNewRoom,
}: {
  roomCount: number
  onNewRoom: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-0.5">
      <div className="flex min-w-0 items-center gap-2">
        <p className="text-[12px] font-semibold text-ink">讨论历史</p>
        <span className="inline-flex rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] font-medium text-ink-soft shadow-sm">
          {roomCount}
        </span>
      </div>
      <button
        type="button"
        onClick={onNewRoom}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink-soft transition-colors hover:border-accent/25 hover:text-accent"
        aria-label="创建对话"
        title="创建对话"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  )
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
    <div className="relative">
      {/* Overlay delete confirmation — does NOT replace the card */}
      {showDeleteConfirm && (
        <div className="tone-danger-panel absolute inset-0 z-10 flex items-center justify-center rounded-2xl border bg-surface p-3 shadow-xl">
          <div className="text-center">
            <p className="tone-danger-text mb-2.5 text-[12px] font-medium">删除「{room.topic}」？</p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={confirmDelete}
                className="tone-danger-button rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors"
              >
                删除
              </button>
              <button
                onClick={cancelDelete}
                className="px-3 py-1.5 text-[12px] rounded-lg bg-surface-muted text-ink hover:bg-bg transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Card — <div role="button"> to allow inner <button> children (no nested interactive elements) */}
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault()
            handleDelete(e)
          }
        }}
        className={`app-window-surface relative w-full cursor-pointer select-none rounded-2xl border p-3.5 text-left transition-all duration-150 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
          isActive
            ? 'border-line shadow-[0_16px_28px_rgba(0,0,0,0.14)] -translate-y-px'
            : 'border-line hover:-translate-y-px hover:shadow-[0_12px_22px_rgba(0,0,0,0.09)]'
        }`}
      >
        {isActive && <span className="pointer-events-none absolute inset-y-3 left-0 w-1 rounded-r-full bg-accent" aria-hidden />}
        <div className="pl-2.5">
          {/* Top row: title + status badge + overflow menu */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <div className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border ${
                isActive
                  ? 'border-accent/20 bg-accent/10 text-accent'
                  : 'border-line bg-surface-muted text-ink-soft/60'
              }`}>
                <MessageSquare className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-ink">{room.topic}</span>
                <span className="mt-0.5 block text-[10px] text-ink-soft/45">
                  {formatRelativeTime(room.updatedAt)} 更新
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                room.state === 'RUNNING'
                  ? 'tone-success-pill border'
                  : 'bg-surface-muted text-ink-soft/70'
              }`}>
                {room.state === 'RUNNING' ? '进行中' : '已完成'}
              </span>
              {/* Delete — always visible; stop Enter/Space from bubbling to outer role="button" */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowDeleteConfirm(true)
                }}
                onKeyDown={(e) => { e.stopPropagation() }}
                className="tone-danger-icon rounded-md p-1 transition-all md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100"
                aria-label={`删除讨论：${room.topic}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Summary row: agent count + workspace */}
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex -space-x-1.5">
                {Array.from({ length: Math.min(room.agentCount, 3) }).map((_, i) => (
                  <div
                    key={i}
                    className="w-4 h-4 rounded-full border border-white/20 flex items-center justify-center text-[9px] font-bold text-white/80 shadow-sm"
                    style={{ backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
                  >
                    {i + 1}
                  </div>
                ))}
              </div>
              <span className="text-[11px] text-ink-soft/60">
                {room.agentCount} 位成员{room.agentCount > 3 ? '+' : ''}
              </span>
            </div>
            {workspaceShort && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowWorkspace(v => !v) }}
                onKeyDown={(e) => { e.stopPropagation() }}
                className={`rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] text-ink-soft/55 transition-colors hover:text-ink-soft/80 ${showWorkspace ? 'whitespace-normal break-all max-w-[200px]' : 'truncate max-w-[120px]'}`}
                title={showWorkspace ? undefined : room.workspace}
              >
                {showWorkspace ? room.workspace : workspaceShort}
              </button>
            )}
          </div>

          {room.preview && (
            <div className="mt-2 border-t border-line pt-2">
              <p className="line-clamp-2 text-[11px] leading-relaxed text-ink-soft/68">{room.preview}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RoomListSection({
  rooms,
  currentRoomId,
  onSelectRoom,
  onDeleteRoom,
  onAfterSelect,
}: {
  rooms: SidebarRoom[]
  currentRoomId?: string
  onSelectRoom: (roomId: string) => void
  onDeleteRoom: (roomId: string) => void
  onAfterSelect?: () => void
}) {
  if (rooms.length === 0) {
    return <p className="py-6 text-center text-xs text-ink-soft/50">暂无讨论记录</p>
  }

  return (
    <div className="space-y-3">
      {rooms.map(room => (
        <RoomItem
          key={room.id}
          room={room}
          isActive={room.id === currentRoomId}
          onClick={() => {
            onSelectRoom(room.id)
            onAfterSelect?.()
          }}
          onDelete={onDeleteRoom}
        />
      ))}
    </div>
  )
}

function SidebarConversationSection({
  rooms,
  currentRoomId,
  onNewRoom,
  onSelectRoom,
  onDeleteRoom,
  onAfterSelect,
}: {
  rooms: SidebarRoom[]
  currentRoomId?: string
  onNewRoom: () => void
  onSelectRoom: (roomId: string) => void
  onDeleteRoom: (roomId: string) => void
  onAfterSelect?: () => void
}) {
  return (
    <div className="app-window-surface rounded-[26px] border border-line p-2.5 shadow-sm">
      <SidebarHistoryHeader roomCount={rooms.length} onNewRoom={onNewRoom} />
      <div className="mt-3 border-t border-line pt-3">
        <RoomListSection
          rooms={rooms}
          currentRoomId={currentRoomId}
          onSelectRoom={onSelectRoom}
          onDeleteRoom={onDeleteRoom}
          onAfterSelect={onAfterSelect}
        />
      </div>
    </div>
  )
}

function SidebarSystemControls({
  theme,
  mounted,
  onToggleTheme,
  onOpenSystemSettings,
  onCloseMobileMenu,
}: Pick<RoomListSidebarProps, 'theme' | 'mounted' | 'onToggleTheme' | 'onOpenSystemSettings' | 'onCloseMobileMenu'>) {
  const isDark = theme === 'dark'

  const openSystemSettings = () => {
    onCloseMobileMenu?.()
    onOpenSystemSettings?.()
  }

  return (
    <div className="shrink-0 border-t border-line p-3 space-y-2">
      <p className="px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-ink-soft/50">系统设置</p>
      <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 bg-surface-muted">
        <span className="text-[12px] font-medium text-ink-soft">外观</span>
        {mounted && (
          <button
            type="button"
            onClick={onToggleTheme}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-ink-soft hover:text-ink hover:bg-surface transition-colors"
            aria-label={isDark ? '切换亮色模式' : '切换暗色模式'}
          >
            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span>{isDark ? '亮色' : '暗色'}</span>
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={openSystemSettings}
        className="w-full flex items-center justify-between rounded-xl px-3 py-2 text-[12px] font-medium text-ink-soft hover:text-ink hover:bg-surface-muted transition-colors"
      >
        <span>打开设置</span>
        <Settings className="w-3.5 h-3.5" />
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
  theme,
  mounted,
  onToggleTheme,
  onOpenSystemSettings,
}: Omit<RoomListSidebarProps, 'mobileMenuOpen' | 'onToggleMobileMenu' | 'onCloseMobileMenu'>) {
  return (
    <div className="app-islands-panel hidden md:flex w-[280px] bg-surface border-r border-line flex-col z-20">
      <div className="p-5 border-b border-line shrink-0">
        <SidebarBrand />
      </div>
      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
        <SidebarConversationSection
          rooms={rooms}
          currentRoomId={currentRoomId}
          onNewRoom={onNewRoom}
          onSelectRoom={onSelectRoom}
          onDeleteRoom={onDeleteRoom}
        />
      </div>
      <SidebarSystemControls
        theme={theme}
        mounted={mounted}
        onToggleTheme={onToggleTheme}
        onOpenSystemSettings={onOpenSystemSettings}
      />
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
  theme,
  mounted,
  onToggleTheme,
  onOpenSystemSettings,
  mobileMenuOpen,
  onCloseMobileMenu,
}: RoomListSidebarProps) {
  if (!mobileMenuOpen) return null

  return (
    <div className="md:hidden fixed inset-0 z-40 bg-[color:var(--overlay-scrim)]" onClick={onCloseMobileMenu}>
      <div
        className="absolute left-0 top-0 bottom-0 w-[82%] max-w-[300px] bg-surface border-r border-line flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 border-b border-line shrink-0">
          <div className="flex items-start justify-between gap-3">
            <SidebarBrand />
            <button
              onClick={onCloseMobileMenu}
              aria-label="关闭菜单"
              className="p-2 text-ink-soft hover:text-ink hover:bg-surface-muted rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
        <SidebarConversationSection
          rooms={rooms}
          currentRoomId={currentRoomId}
          onNewRoom={() => { onNewRoom(); onCloseMobileMenu?.() }}
          onSelectRoom={onSelectRoom}
          onDeleteRoom={onDeleteRoom}
          onAfterSelect={onCloseMobileMenu}
        />
      </div>
        <SidebarSystemControls
          theme={theme}
          mounted={mounted}
          onToggleTheme={onToggleTheme}
          onOpenSystemSettings={onOpenSystemSettings}
          onCloseMobileMenu={onCloseMobileMenu}
        />
      </div>
    </div>
  )
}
