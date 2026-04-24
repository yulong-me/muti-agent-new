import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'

import { AgentPanel } from '../components/AgentPanel'
import { MetadataBadge } from '../components/MetadataBadge'
import { formatSessionSnapshotLabel } from '../lib/telemetry'

assert.equal(
  formatSessionSnapshotLabel({
    contextHealth: {
      usedTokens: 42614,
    } as never,
  }),
  'Context 43k',
)

assert.equal(
  formatSessionSnapshotLabel({
    sessionId: 'ses_244ee021ffeHjqxJTY5dRLcGf',
  }),
  'Session ID ses_244e…',
)

const markup = renderToStaticMarkup(
  <MetadataBadge
    usage={{
      provider: 'Claude Code',
      model: 'MiniMax-M2.7-highspeed-long-model-name-for-wrap-check',
      inputTokens: 42614,
      outputTokens: 86,
      latencyMs: 2400,
      costUsd: 0.01,
    }}
  />,
)

assert.match(markup, /Claude Code/)
assert.doesNotMatch(markup, /Session ID/)
assert.match(markup, /ArrowDown|svg/)
assert.match(markup, /43k/)
assert.match(markup, /86/)
assert.match(markup, /title="Claude Code · MiniMax-M2\.7-highspeed-long-model-name-for-wrap-check"/)
assert.match(markup, /2\.4s/)
assert.match(markup, /\$0\.010/)

const agentPanelMarkup = renderToStaticMarkup(
  <AgentPanel
    agents={[
      {
        id: 'agent-1',
        role: 'WORKER',
        name: 'Paul Graham',
        domainLabel: '',
        status: 'idle',
        configId: 'paul-graham',
      },
    ]}
    sessionTelemetryByAgent={{
      'paul-graham': {
        sessionId: 'ses_244eda78affeMzZsZCPUbDmP26',
        measuredAt: Date.now(),
        invocationUsage: {
          provider: 'OpenCode',
          inputTokens: 119,
          outputTokens: 511,
          latencyMs: 19000,
        },
        contextHealth: {
          usedTokens: 54932,
          windowSize: 200000,
          leftTokens: 145068,
          leftPct: 73,
          fillRatio: 0.27466,
          source: 'approx',
          state: 'healthy',
        },
      },
    }}
  />,
)

assert.match(agentPanelMarkup, /145k left/)
assert.match(agentPanelMarkup, /73% available/)
assert.doesNotMatch(agentPanelMarkup, /Window unknown/)
assert.doesNotMatch(agentPanelMarkup, /Session ID/)
assert.doesNotMatch(agentPanelMarkup, />OpenCode</)
assert.doesNotMatch(agentPanelMarkup, />119</)
assert.doesNotMatch(agentPanelMarkup, />511</)
assert.doesNotMatch(agentPanelMarkup, /19s/)

console.log('telemetry-ui-regression: ok')
