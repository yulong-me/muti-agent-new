import assert from 'node:assert/strict'
import { readEvolutionProposalStream } from '../components/room-view/evolutionStream'
import type { EvolutionProposal } from '../components/room-view/types'

const proposal: EvolutionProposal = {
  id: 'proposal-1',
  roomId: 'room-1',
  teamId: 'team-1',
  baseVersionId: 'version-1',
  targetVersionNumber: 2,
  status: 'pending',
  summary: '让 Team 先澄清限制条件',
  createdAt: 1,
  updatedAt: 1,
  changes: [],
}

function streamResponse(chunks: string[]) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  }))
}

async function main() {
  const deltas: string[] = []
  const streamedProposal = await readEvolutionProposalStream(
    streamResponse([
      `${JSON.stringify({ type: 'delta', text: '先澄清' })}\n${JSON.stringify({ type: 'delta', text: '再执行' })}\n`,
      `${JSON.stringify({ type: 'proposal', proposal })}\n`,
    ]),
    { onDelta: text => deltas.push(text) },
  )

  assert.deepEqual(deltas, ['先澄清', '再执行'])
  assert.equal(streamedProposal.id, proposal.id)

  const jsonProposal = await readEvolutionProposalStream({
    body: null,
    ok: true,
    json: async () => proposal,
  } as Response)
  assert.equal(jsonProposal.id, proposal.id)

  await assert.rejects(
    readEvolutionProposalStream(streamResponse([
      `${JSON.stringify({ type: 'error', error: '生成失败' })}\n`,
    ])),
    /生成失败/,
  )

  console.log('evolution-stream-regression: ok')
}

void main()
