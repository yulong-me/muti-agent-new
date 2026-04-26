import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  EmptyRoomQuickStart,
  QUICK_START_TEMPLATES,
} from '../components/room-view/EmptyRoomQuickStart'

const markup = renderToStaticMarkup(
  <EmptyRoomQuickStart
    onStartBlank={() => {}}
    onStartTemplate={() => {}}
  />,
)

assert.match(markup, /OpenCouncil/)
assert.match(markup, /发起新讨论/)
assert.equal(QUICK_START_TEMPLATES.length, 5)
assert.deepEqual(QUICK_START_TEMPLATES.map(template => template.title), [
  '诉讼策略',
  '竞品分析',
  '论文返修',
  '圆桌论坛',
  '软件开发',
])
assert.deepEqual(QUICK_START_TEMPLATES.map(template => template.sceneId), [
  'litigation-strategy',
  'competitor-analysis',
  'paper-revision',
  'roundtable-forum',
  'software-development',
])
assert.ok(QUICK_START_TEMPLATES.every(template => template.agentIds.length >= 4))
assert.deepEqual(QUICK_START_TEMPLATES.map(template => template.agentIds), [
  ['litigation-case-mapper', 'litigation-evidence-strategist', 'litigation-opposing-counsel', 'litigation-risk-controller'],
  ['competitor-market-mapper', 'competitor-positioning-strategist', 'competitor-product-skeptic', 'competitor-gtm-operator'],
  ['paper-review-diagnoser', 'paper-methods-editor', 'paper-rebuttal-writer', 'paper-hostile-reviewer'],
  ['paul-graham', 'steve-jobs', 'zhang-yiming', 'munger', 'taleb'],
  ['dev-architect', 'dev-challenge-architect', 'dev-implementer', 'dev-reviewer'],
])
for (const template of QUICK_START_TEMPLATES) {
  assert.match(markup, new RegExp(template.title))
}
assert.doesNotMatch(markup, /选择讨论室后显示讨论成员/)

console.log('home-quick-start-regression: ok')
