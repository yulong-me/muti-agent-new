'use client'

import { useParams } from 'next/navigation'
import RoomView_new from '@/components/RoomView_new'

export default function RoomPage() {
  const { id } = useParams()
  return <RoomView_new key={Array.isArray(id) ? id[0] : id} roomId={Array.isArray(id) ? id[0] : id} />
}
