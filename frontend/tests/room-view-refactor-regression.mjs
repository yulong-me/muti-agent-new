import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const roomViewPath = resolve(root, 'components/RoomView.tsx')
const feedbackModalPath = resolve(root, 'components/room-view/EvolutionFeedbackModal.tsx')
const streamHelperPath = resolve(root, 'components/room-view/evolutionStream.ts')
const evolutionHookPath = resolve(root, 'components/room-view/useEvolutionProposals.ts')

assert.ok(existsSync(feedbackModalPath), 'RoomView feedback modal should live in room-view/EvolutionFeedbackModal.tsx')
assert.ok(existsSync(streamHelperPath), 'Evolution proposal stream parsing should live in room-view/evolutionStream.ts')
assert.ok(existsSync(evolutionHookPath), 'RoomView evolution state should live in room-view/useEvolutionProposals.ts')

const roomView = readFileSync(roomViewPath, 'utf8')
const feedbackModal = readFileSync(feedbackModalPath, 'utf8')
const streamHelper = readFileSync(streamHelperPath, 'utf8')
const evolutionHook = readFileSync(evolutionHookPath, 'utf8')

assert.match(roomView, /import \{ EvolutionFeedbackModal \} from '\.\/room-view\/EvolutionFeedbackModal'/)
assert.match(roomView, /import \{ useEvolutionProposals \} from '\.\/room-view\/useEvolutionProposals'/)
assert.doesNotMatch(roomView, /readEvolutionProposalStream/)
assert.doesNotMatch(roomView, /function readEvolutionProposalStream/)
assert.doesNotMatch(roomView, /function handleEvolutionStreamEvent/)
assert.doesNotMatch(roomView, /useState<EvolutionProposal\[\]>/)
assert.doesNotMatch(roomView, /refreshEvolutionProposals/)
assert.doesNotMatch(roomView, /const handleEvolutionDecision = useCallback/)
assert.doesNotMatch(roomView, /fixed inset-0 layer-modal flex items-center justify-center bg-black\/35 px-4/)
assert.doesNotMatch(roomView, /settingsInitialTab|setSettingsInitialTab/)
assert.match(roomView, /initialTab="team"/)

assert.match(feedbackModal, /export function EvolutionFeedbackModal/)
assert.match(feedbackModal, /改进这支 Team/)
assert.match(feedbackModal, /这支 Team 下次怎么做会更好？/)
assert.match(feedbackModal, /Team Architect/)
assert.match(feedbackModal, /layer-modal/)

assert.match(streamHelper, /export async function readEvolutionProposalStream/)
assert.match(streamHelper, /onDelta\?: \(text: string\) => void/)
assert.match(streamHelper, /case 'delta'/)
assert.match(streamHelper, /case 'proposal'/)

assert.match(evolutionHook, /export function useEvolutionProposals/)
assert.match(evolutionHook, /readEvolutionProposalStream/)
assert.match(evolutionHook, /\/api\/rooms\/\$\{roomId\}\/evolution-proposals\/stream/)
assert.match(evolutionHook, /pendingEvolutionProposals/)
assert.match(evolutionHook, /activeEvolutionProposal/)

console.log('room-view-refactor-regression: ok')
