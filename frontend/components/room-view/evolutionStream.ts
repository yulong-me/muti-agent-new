import type { EvolutionProposal } from './types'

export type EvolutionProposalStreamEvent =
  | { type: 'delta'; text: string; timestamp?: number }
  | { type: 'proposal'; proposal: EvolutionProposal }
  | { type: 'error'; error: string; code?: string }

interface ReadEvolutionProposalStreamOptions {
  onDelta?: (text: string) => void
}

function handleEvolutionStreamEvent(
  event: EvolutionProposalStreamEvent,
  options: ReadEvolutionProposalStreamOptions,
) {
  switch (event.type) {
    case 'delta':
      options.onDelta?.(event.text)
      return null
    case 'proposal':
      return event.proposal
    case 'error':
      throw new Error(event.error || '生成改进建议失败')
  }
}

function parseEvolutionStreamLine(line: string, options: ReadEvolutionProposalStreamOptions) {
  const trimmed = line.trim()
  if (!trimmed) return null
  const event = JSON.parse(trimmed) as EvolutionProposalStreamEvent
  return handleEvolutionStreamEvent(event, options)
}

export async function readEvolutionProposalStream(
  response: Response,
  options: ReadEvolutionProposalStreamOptions = {},
): Promise<EvolutionProposal> {
  if (!response.body) {
    const data = await response.json().catch(() => ({})) as EvolutionProposal | { error?: string }
    if (!response.ok) throw new Error('error' in data && data.error ? data.error : '生成改进建议失败')
    return data as EvolutionProposal
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalProposal: EvolutionProposal | null = null

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      finalProposal = parseEvolutionStreamLine(line, options) ?? finalProposal
    }

    if (done) break
  }

  finalProposal = parseEvolutionStreamLine(buffer, options) ?? finalProposal

  if (!finalProposal) throw new Error('生成改进建议失败，请重试')
  return finalProposal
}
