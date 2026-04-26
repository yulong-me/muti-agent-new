'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Command, Moon, Plus, Search, Settings, Sun, Trash2, UserCircle, X } from 'lucide-react'
import {
  formatRelativeTime,
  type DiscussionState,
} from '../lib/agents'

const AVATAR_COLORS = ['#C43A2F', '#7C3AED', '#0E8345', '#1F3A8A', '#475569', '#2563EB']

interface SidebarRoom {
  id: string
  topic: string
  createdAt: number
  updatedAt: number
  state: DiscussionState
  activityState?: 'busy' | 'open' | 'done'
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
      <p className="truncate text-title font-bold text-ink">OpenCouncil</p>
    </div>
  )
}

function SidebarCommandTrigger({
  onOpen,
}: {
  onOpen: () => void
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onOpen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onOpen])

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-caption text-ink-soft shadow-sm transition-colors hover:border-accent/30 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/[0.35]"
      aria-label="打开命令面板"
      title="打开命令面板"
    >
      <Search className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 text-left">搜索讨论、消息或操作</span>
      <span className="shrink-0 rounded border border-line bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
        ⌘K
      </span>
    </button>
  )
}

function CommandPalette({
  open,
  query,
  rooms,
  currentRoomId,
  onClose,
  onQueryChange,
  onNewRoom,
  onSelectRoom,
  onOpenSystemSettings,
  onAfterSelect,
}: {
  open: boolean
  query: string
  rooms: SidebarRoom[]
  currentRoomId?: string
  onClose: () => void
  onQueryChange: (value: string) => void
  onNewRoom: () => void
  onSelectRoom: (roomId: string) => void
  onOpenSystemSettings?: () => void
  onAfterSelect?: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const normalizedQuery = query.trim().toLowerCase()

  useEffect(() => {
    if (!open) return
    const id = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(id)
  }, [open])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  const roomResults = useMemo(() => {
    const matchesQuery = (room: SidebarRoom) => {
      if (!normalizedQuery) return true
      return `${room.topic} ${room.preview ?? ''} ${room.workspace ?? ''}`.toLowerCase().includes(normalizedQuery)
    }
    return rooms.filter(matchesQuery).slice(0, 8)
  }, [normalizedQuery, rooms])

  const actionResults = useMemo(() => {
    const actions = [
      {
        id: 'new-room',
        label: '新讨论',
        hint: '创建一个新的 Council room',
        keywords: 'new room create discussion',
        icon: Plus,
        onSelect: () => {
          onNewRoom()
          onClose()
          onAfterSelect?.()
        },
      },
      {
        id: 'settings',
        label: '打开设置',
        hint: 'Providers、模型和本机工作区',
        keywords: 'settings providers workspace',
        icon: Settings,
        onSelect: () => {
          onOpenSystemSettings?.()
          onClose()
          onAfterSelect?.()
        },
      },
    ]

    return actions.filter(action => {
      if (!normalizedQuery) return true
      return `${action.label} ${action.hint} ${action.keywords}`.toLowerCase().includes(normalizedQuery)
    })
  }, [normalizedQuery, onAfterSelect, onClose, onNewRoom, onOpenSystemSettings])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-[color:var(--overlay-scrim)] px-4 pt-[12vh]"
      data-command-palette="true"
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <Command className="h-4 w-4 shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            placeholder="搜索讨论室、最近消息或操作"
            className="h-8 min-w-0 flex-1 border-0 bg-transparent p-0 text-secondary text-ink outline-none placeholder:text-ink-faint"
            aria-label="搜索命令"
          />
          <span className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
            ESC
          </span>
        </div>

        <div className="custom-scrollbar max-h-[60vh] overflow-y-auto p-2">
          {actionResults.length > 0 && (
            <div className="mb-2">
              <p className="px-2 py-1 text-label uppercase text-ink-faint">操作</p>
              <div className="space-y-1">
                {actionResults.map(action => {
                  const Icon = action.icon
                  return (
                    <button
                      key={action.id}
                      type="button"
                      onClick={action.onSelect}
                      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/[0.35]"
                    >
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-surface">
                        <Icon className="h-4 w-4 text-ink-soft" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-secondary font-medium text-ink">{action.label}</span>
                        <span className="block truncate text-[11px] text-ink-faint">{action.hint}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <p className="px-2 py-1 text-label uppercase text-ink-faint">讨论室 / 最近消息</p>
            {roomResults.length > 0 ? (
              <div className="space-y-1">
                {roomResults.map(room => {
                  const isCurrent = room.id === currentRoomId
                  return (
                    <button
                      key={room.id}
                      type="button"
                      onClick={() => {
                        onSelectRoom(room.id)
                        onClose()
                        onAfterSelect?.()
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/[0.35] ${
                        isCurrent ? 'bg-accent/[0.08]' : 'hover:bg-surface-muted'
                      }`}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-[11px] font-bold text-ink-soft">
                        {room.agentCount}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-secondary font-medium text-ink">{room.topic}</span>
                        <span className="block truncate text-[11px] text-ink-faint">
                          {room.preview || '暂无最近消息'}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] text-ink-faint">{formatRelativeTime(room.updatedAt)}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="rounded-lg bg-surface-muted px-3 py-6 text-center text-caption text-ink-faint">
                没有匹配的讨论室或最近消息
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SidebarRoomsHeader({
  activeCount,
  archivedCount,
  onNewRoom,
}: {
  activeCount: number
  archivedCount: number
  onNewRoom: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-label uppercase text-ink-soft">讨论室</p>
        <p className="mt-0.5 text-[11px] text-ink-faint">
          {activeCount} active · {archivedCount} archived
        </p>
      </div>
      <button
        type="button"
        onClick={onNewRoom}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink-soft transition-colors hover:border-accent/30 hover:text-accent"
        aria-label="新讨论"
        title="新讨论"
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
  const isBusy = room.activityState === 'busy' && room.state !== 'DONE'

  const handleDelete = (event: React.KeyboardEvent | React.MouseEvent) => {
    event.stopPropagation()
    setShowDeleteConfirm(true)
  }

  const confirmDelete = (event: React.MouseEvent) => {
    event.stopPropagation()
    setShowDeleteConfirm(false)
    onDelete(room.id)
  }

  const cancelDelete = (event: React.MouseEvent) => {
    event.stopPropagation()
    setShowDeleteConfirm(false)
  }

  return (
    <div className="relative">
      {showDeleteConfirm && (
        <div className="tone-danger-panel absolute inset-0 z-10 flex items-center justify-center rounded-lg border bg-surface p-2 shadow-xl">
          <div className="text-center">
            <p className="tone-danger-text mb-2 max-w-[13rem] truncate text-caption">删除「{room.topic}」？</p>
            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={confirmDelete}
                className="tone-danger-button rounded-md px-2.5 py-1 text-caption transition-colors"
              >
                删除
              </button>
              <button
                type="button"
                onClick={cancelDelete}
                className="rounded-md bg-surface-muted px-2.5 py-1 text-caption text-ink transition-colors hover:bg-bg"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onClick()
          }
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault()
            handleDelete(event)
          }
        }}
        className={`group relative w-full cursor-pointer select-none rounded-lg border py-2 pl-3 pr-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/[0.45] ${
          isActive
            ? 'border-accent/25 bg-accent/[0.08] text-ink shadow-sm'
            : 'border-transparent text-ink-soft hover:border-line hover:bg-surface'
        }`}
      >
        {isActive && <span className="pointer-events-none absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-accent" aria-hidden />}
        <div className="flex min-h-5 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-secondary font-medium">
            {room.topic}
          </span>
          {isBusy ? (
            <span className="tone-focus-dot h-1.5 w-1.5 shrink-0 rounded-full animate-focus-pulse" title="进行中" />
          ) : null}
          <span className="shrink-0 text-[10px] text-ink-faint">
            {formatRelativeTime(room.updatedAt)}
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setShowDeleteConfirm(true)
            }}
            onKeyDown={(event) => { event.stopPropagation() }}
            className="tone-danger-icon rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
            aria-label={`删除讨论：${room.topic}`}
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className={`${isActive ? 'flex' : 'hidden group-hover:flex group-focus-within:flex'} mt-1.5 items-center gap-2`}>
          <p className="min-w-0 flex-1 truncate text-[11px] leading-4 text-ink-faint">
            {room.preview || '暂无最近消息'}
          </p>
          <div className="flex -space-x-1">
            {Array.from({ length: Math.min(room.agentCount, 3) }).map((_, index) => (
              <span
                key={index}
                className="h-3.5 w-3.5 rounded-full border border-surface shadow-sm"
                style={{ backgroundColor: AVATAR_COLORS[index % AVATAR_COLORS.length] }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function RoomListSection({
  rooms,
  currentRoomId,
  emptyText,
  onSelectRoom,
  onDeleteRoom,
  onAfterSelect,
}: {
  rooms: SidebarRoom[]
  currentRoomId?: string
  emptyText: string
  onSelectRoom: (roomId: string) => void
  onDeleteRoom: (roomId: string) => void
  onAfterSelect?: () => void
}) {
  if (rooms.length === 0) {
    return <p className="py-4 text-center text-caption text-ink-faint">{emptyText}</p>
  }

  return (
    <div className="space-y-1">
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
  onOpenSystemSettings,
  onAfterSelect,
}: {
  rooms: SidebarRoom[]
  currentRoomId?: string
  onNewRoom: () => void
  onSelectRoom: (roomId: string) => void
  onDeleteRoom: (roomId: string) => void
  onOpenSystemSettings?: () => void
  onAfterSelect?: () => void
}) {
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [archivedOpen, setArchivedOpen] = useState(false)

  const { activeRooms, archivedRooms } = useMemo(() => {
    return {
      activeRooms: rooms.filter(room => room.state !== 'DONE' && room.activityState !== 'done'),
      archivedRooms: rooms.filter(room => room.state === 'DONE' || room.activityState === 'done'),
    }
  }, [rooms])

  const totalArchived = rooms.filter(room => room.state === 'DONE' || room.activityState === 'done').length
  const totalActive = rooms.length - totalArchived

  return (
    <div className="space-y-3">
      <SidebarRoomsHeader activeCount={totalActive} archivedCount={totalArchived} onNewRoom={onNewRoom} />
      <SidebarCommandTrigger onOpen={() => setCommandOpen(true)} />
      <CommandPalette
        open={commandOpen}
        query={commandQuery}
        rooms={rooms}
        currentRoomId={currentRoomId}
        onClose={() => setCommandOpen(false)}
        onQueryChange={setCommandQuery}
        onNewRoom={onNewRoom}
        onSelectRoom={onSelectRoom}
        onOpenSystemSettings={onOpenSystemSettings}
        onAfterSelect={onAfterSelect}
      />
      <RoomListSection
        rooms={activeRooms}
        currentRoomId={currentRoomId}
        emptyText="暂无进行中的讨论"
        onSelectRoom={onSelectRoom}
        onDeleteRoom={onDeleteRoom}
        onAfterSelect={onAfterSelect}
      />

      <div className="border-t border-line pt-2">
        <button
          type="button"
          onClick={() => setArchivedOpen(open => !open)}
          className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-label uppercase text-ink-soft transition-colors hover:bg-surface"
          aria-expanded={archivedOpen}
        >
          <span>已归档</span>
          <span className="rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[10px] text-ink-faint">
            {archivedRooms.length}
          </span>
        </button>
        {archivedOpen && (
          <div className="mt-1">
            <RoomListSection
              rooms={archivedRooms}
              currentRoomId={currentRoomId}
              emptyText="暂无归档讨论"
              onSelectRoom={onSelectRoom}
              onDeleteRoom={onDeleteRoom}
              onAfterSelect={onAfterSelect}
            />
          </div>
        )}
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
    <div className="flex shrink-0 items-center gap-2 border-t border-line p-3">
      <button
        type="button"
        onClick={openSystemSettings}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
        aria-label="打开设置"
        title="打开设置"
      >
        <UserCircle className="h-5 w-5 shrink-0" />
        <span className="truncate text-caption">本机工作区</span>
      </button>
      {mounted && (
        <button
          type="button"
          onClick={onToggleTheme}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
          aria-label={isDark ? '切换亮色模式' : '切换暗色模式'}
          title={isDark ? '切换亮色模式' : '切换暗色模式'}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      )}
      <button
        type="button"
        onClick={openSystemSettings}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
        aria-label="设置"
        title="设置"
      >
        <Settings className="h-4 w-4" />
      </button>
    </div>
  )
}

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
    <div className="app-islands-panel z-20 hidden w-[280px] flex-col border-r border-line bg-surface md:flex">
      <div className="shrink-0 border-b border-line px-4 py-3">
        <SidebarBrand />
      </div>
      <div className="custom-scrollbar flex-1 overflow-y-auto p-3">
        <SidebarConversationSection
          rooms={rooms}
          currentRoomId={currentRoomId}
          onNewRoom={onNewRoom}
          onSelectRoom={onSelectRoom}
          onDeleteRoom={onDeleteRoom}
          onOpenSystemSettings={onOpenSystemSettings}
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
    <div className="fixed inset-0 z-40 bg-[color:var(--overlay-scrim)] md:hidden" onClick={onCloseMobileMenu}>
      <div
        className="absolute bottom-0 left-0 top-0 flex w-[82%] max-w-[300px] flex-col border-r border-line bg-surface shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-line px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <SidebarBrand />
            <button
              type="button"
              onClick={onCloseMobileMenu}
              aria-label="关闭菜单"
              className="rounded-lg p-2 text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="custom-scrollbar flex-1 overflow-y-auto p-3">
          <SidebarConversationSection
            rooms={rooms}
            currentRoomId={currentRoomId}
            onNewRoom={() => { onNewRoom(); onCloseMobileMenu?.() }}
            onSelectRoom={onSelectRoom}
            onDeleteRoom={onDeleteRoom}
            onOpenSystemSettings={onOpenSystemSettings}
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
