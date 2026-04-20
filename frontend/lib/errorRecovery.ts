function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function rewriteMessageForDifferentAgent(
  originalContent: string,
  currentAgentName: string,
  nextAgentName: string,
): string {
  const trimmed = originalContent.trim()
  if (!trimmed) return `@${nextAgentName} `

  const mentionPattern = new RegExp(`@${escapeRegExp(currentAgentName)}(?![\\w-])`)
  if (mentionPattern.test(trimmed)) {
    return trimmed.replace(mentionPattern, `@${nextAgentName}`)
  }

  return `@${nextAgentName} ${trimmed}`
}
