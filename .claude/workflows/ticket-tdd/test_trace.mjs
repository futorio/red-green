// Tests of trace.mjs on a trimmed real run (touhou8, 2026-10-22; trace-fixture/, made from the run's journal and
// transcripts with their text cut). Run: node --test test_trace.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claudeCodeSpans, blockOf, table } from './trace.mjs'

const WF = new URL('trace-fixture/-home-u-projects-touhou8-multiplayer/f02af573-bd5c-4b78-96b3-a80bae6d3248/subagents/workflows/wf_bb03de2d-705', import.meta.url).pathname
const spans = claudeCodeSpans(WF)
const span = label => spans.find(s => s.label === label)

test('TR1: one span per started agent, in journal order', () => {
  assert.equal(spans.length, 21)
  assert.deepEqual(spans.slice(0, 3).map(s => s.label), ['research', 'plan', 'implement'])
})

test('TR2: a span carries the model, harness, project, times and tokens counted once per API message', () => {
  assert.deepEqual(span('review:r2:code'), {
    label: 'review:r2:code', model: 'claude-opus-5-5', harness: 'claude-code-workflow', project: 'touhou8-multiplayer',
    start: '2026-10-22T08:33:15.730Z', end: '2026-10-22T08:37:13.902Z',
    tokens: { in: 36, out: 4922, cache_read: 1568492, cache_write: 99704 },
    attrs: { status: 'ok', findings: 1, 'findings.major': 1, rulings: 0, checked: 13, mailbox: 0 },
  })
})

test('TR3: stage metrics count the output lists; an agent with no result is unfinished', () => {
  assert.equal(span('research').attrs.facts, 29)
  assert.equal(span('research').attrs.requirements, 36)
  assert.equal(span('mutation').attrs.status, 'unfinished')
  assert.ok(span('mutation').tokens.out > 0)
})

test('TR4: --project overrides the derived project', () => {
  assert.equal(claudeCodeSpans(WF, 'th08')[0].project, 'th08')
})

test('TR5: a label maps to its block and round', () => {
  assert.deepEqual(['research:retry', 'replan', 'gates:discover', 'gates:r2:recheck', 'review:r1:code', 'review:fix:r2:1', 'fix:r1:review', 'fix:minor', 'mutation']
    .map(blockOf), ['research', 'plan', 'gates', 'gates r2', 'review r1', 'fix-review r2', 'fix r1', 'minor-fix', 'mutation'])
})

test('TR6: the table sums calls and tokens per block and round, and totals the run', () => {
  const rows = table(spans).split('\n')
  const row = rows.find(r => r.startsWith('review r2 '))
  assert.match(row, /^review r2 +2 /)
  assert.match(rows.at(-1), /^total +21 /)
})
