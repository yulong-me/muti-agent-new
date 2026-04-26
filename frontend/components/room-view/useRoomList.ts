'use client'

import { useCallback, useEffect, useState } from 'react'

import { API_URL } from '@/lib/api'
import { debug, telemetry, warn } from '@/lib/logger'

import type { RoomListItem } from './types'

const API = API_URL

function normalizeRoomListItem(room: any): RoomListItem {
  return {
    id: room.id,
    topic: room.topic,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    state: room.state,
    activityState: room.activityState ?? (room.state === 'DONE' ? 'done' : 'open'),
    workspace: room.workspace,
    preview: room.preview,
    agentCount: room.agentCount,
  }
}

export function useRoomList() {
  const [rooms, setRooms] = useState<RoomListItem[]>([])

  const loadRooms = useCallback(async (source: 'initial' | 'poll') => {
    try {
      const response = await fetch(`${API}/api/rooms/sidebar`)
      const data = response.ok ? await response.json() : []
      setRooms((data as any[]).map(normalizeRoomListItem))
      if (source === 'initial') {
        debug('ui:room_list:loaded', { count: data.length, source })
      }
    } catch (error) {
      warn('ui:room_list:load_failed', { source, error })
    }
  }, [])

  useEffect(() => {
    telemetry('room:list:load')
    void loadRooms('initial')
  }, [loadRooms])

  useEffect(() => {
    const interval = setInterval(() => {
      void loadRooms('poll')
    }, 30000)
    return () => clearInterval(interval)
  }, [loadRooms])

  return { rooms, setRooms }
}
