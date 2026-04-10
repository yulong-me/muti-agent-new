'use client'

import { useParams } from 'next/navigation'
import RoomView from '@/components/RoomView'

export default function RoomPage() {
  const { id } = useParams()
  return <RoomView roomId={id as string} />
}
