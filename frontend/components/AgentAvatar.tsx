'use client'

import Image from 'next/image'

interface AgentAvatarProps {
  src: string
  alt: string
  size: number
  className?: string
  priority?: boolean
}

export function AgentAvatar({ src, alt, size, className = '', priority = false }: AgentAvatarProps) {
  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      priority={priority}
      unoptimized
      className={className}
    />
  )
}
