'use client'

interface AgentAvatarProps {
  name: string
  alt?: string
  size: number
  className?: string
  color?: string
  textColor?: string
}

const FALLBACK_COLORS = [
  '#4F46E5',
  '#D97706',
  '#059669',
  '#DC2626',
  '#7C3AED',
  '#0284C7',
  '#0D9488',
  '#EA580C',
]

function hashName(name: string): number {
  return Array.from(name).reduce((hash, char) => {
    return ((hash << 5) - hash + char.codePointAt(0)!) | 0
  }, 0)
}

export function getAvatarInitial(name: string): string {
  const firstVisibleChar = Array.from(name.trim()).find(char => /[\p{L}\p{N}]/u.test(char))
  return firstVisibleChar ? firstVisibleChar.toLocaleUpperCase() : '?'
}

function getFallbackColor(name: string): string {
  return FALLBACK_COLORS[Math.abs(hashName(name)) % FALLBACK_COLORS.length] ?? FALLBACK_COLORS[0]
}

export function AgentAvatar({
  name,
  alt,
  size,
  className = '',
  color,
  textColor = '#FFFFFF',
}: AgentAvatarProps) {
  const initial = getAvatarInitial(name)
  const backgroundColor = color ?? getFallbackColor(name)
  const fontSize = Math.max(10, Math.round(size * 0.42))

  return (
    <span
      role="img"
      aria-label={alt ?? `${name} 头像`}
      className={className}
      style={{
        width: size,
        height: size,
        backgroundColor,
        color: textColor,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        fontWeight: 800,
        lineHeight: 1,
        letterSpacing: 0,
      }}
    >
      {initial}
    </span>
  )
}
