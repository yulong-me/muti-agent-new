'use client'

import { useEffect, useState } from 'react'
import { Archive, Trash2, Clock, AlertTriangle } from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:7001'

interface ArchivedRoom {
  id: string
  topic: string
  state: string
  createdAt: number
  deletedAt: number
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function ArchivePage() {
  const [rooms, setRooms] = useState<ArchivedRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    fetch(`${API}/api/rooms/archived`)
      .then(r => r.json())
      .then((data: ArchivedRoom[]) => { setRooms(data); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handlePermanentDelete = async (id: string) => {
    if (!confirm('彻底删除后不可恢复，确定要删除吗？')) return
    setDeleting(id)
    await fetch(`${API}/api/rooms/archived/${id}`, { method: 'DELETE' })
    setDeleting(null)
    setRooms(rooms => rooms.filter(r => r.id !== id))
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-xl bg-surface-muted">
          <Archive className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="text-[18px] font-bold text-ink">归档</h1>
          <p className="text-[13px] text-ink-soft">已归档的讨论可彻底删除，删除后数据不可恢复</p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-ink-soft">加载中...</p>
      ) : rooms.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Archive className="w-10 h-10 text-ink-soft/40" />
          <p className="text-ink-soft text-sm">暂无归档记录</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rooms.map(room => (
            <div key={room.id} className="p-4 rounded-xl border border-line bg-surface flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium text-ink truncate">{room.topic}</p>
                <div className="flex items-center gap-4 mt-1">
                  <span className="flex items-center gap-1 text-[11px] text-ink-soft">
                    <Clock className="w-3 h-3" />
                    归档于 {formatDate(room.deletedAt)}
                  </span>
                  <span className="text-[11px] text-ink-soft/60">建立于 {formatDate(room.createdAt)}</span>
                </div>
              </div>
              <button
                onClick={() => handlePermanentDelete(room.id)}
                disabled={deleting === room.id}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-800 transition-colors flex-shrink-0 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deleting === room.id ? '删除中...' : '彻底删除'}
              </button>
            </div>
          ))}
        </div>
      )}

      {!loading && rooms.length > 0 && (
        <div className="mt-4 flex items-center gap-2 text-[12px] text-ink-soft/60">
          <AlertTriangle className="w-3.5 h-3.5" />
          彻底删除后数据不可恢复，请谨慎操作
        </div>
      )}
    </div>
  )
}
