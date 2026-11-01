// Tests of trace.mjs on a trimmed real run (touhou8, 2026-10-22; trace-fixture/, made from the run's journal and
// transcripts with their text cut). Run: node --test test_trace.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeCodeSpans, blockOf, table, chrome, speedscope } from './trace.mjs'

const WF = new URL('trace-fixture/-home-u-projects-touhou8-multiplayer/f02af573-bd5c-4b78-96b3-a80bae6d3248/subagents/workflows/wf_bb03de2d-705', import.meta.url).pathname
const all = claudeCodeSpans(WF)
const spans = all.filter(s => s.attrs.kind === 'agent')
const span = label => spans.find(s => s.label === label)
const t = Date.parse

test('TR01: one agent span per started agent, in journal order', () => {
  assert.equal(spans.length, 21)
  assert.deepEqual(spans.slice(0, 3).map(s => s.label), ['research', 'plan', 'implement'])
})

test('TR08: an agent span splits into tool calls and model time, inside it, model time carrying all its tokens', () => {
  const kids = all.filter(s => s.parent === 'implement')
  const tools = kids.filter(s => s.attrs.kind === 'tool')
  assert.equal(tools.length, 122)
  assert.equal(tools.filter(s => s.attrs.tool === 'Bash').length, 110)
  const parent = span('implement')
  assert.ok(kids.every(s => t(s.start) >= t(parent.start) && t(s.end) <= t(parent.end)))
  for (const k of ['in', 'out', 'cache_read', 'cache_write'])
    assert.equal(kids.filter(s => s.attrs.kind === 'model').reduce((n, s) => n + s.tokens[k], 0), parent.tokens[k])
})

test('TR09: core spans fill the run\'s gaps between agent calls, overlapping none', () => {
  const core = all.filter(s => s.attrs.kind === 'core')
  assert.ok(core.length > 0)
  assert.ok(core.every(c => spans.every(a => t(c.end) <= t(a.start) || t(c.start) >= t(a.end))))
})

test('TR10: the Chrome trace has a slice per span on its call\'s track and token counters ending at the run totals', () => {
  const { traceEvents } = chrome(all)
  assert.equal(traceEvents.filter(e => e.ph === 'X').length, all.length)
  const track = name => traceEvents.find(e => e.ph === 'M' && e.args.name === name).tid
  assert.ok(traceEvents.filter(e => e.ph === 'X' && e.cat === 'tool' && e.args.parent === 'implement').every(e => e.tid === track('implement')))
  const out = traceEvents.filter(e => e.ph === 'C' && e.name === 'tokens.out').at(-1).args.out
  assert.equal(out, spans.reduce((n, s) => n + s.tokens.out, 0))
})

test('TR02: a span carries the model, harness, project, times and tokens counted once per API message', () => {
  assert.deepEqual(span('review:r2:code'), {
    label: 'review:r2:code', model: 'claude-opus-5-5', harness: 'claude-code-workflow', project: 'touhou8-multiplayer',
    start: '2026-10-22T08:33:15.730Z', end: '2026-10-22T08:37:13.902Z',
    tokens: { in: 36, out: 4922, cache_read: 1568492, cache_write: 99704 },
    attrs: { kind: 'agent', status: 'ok', findings: 1, 'findings.major': 1, rulings: 0, checked: 13, mailbox: 0 },
  })
})

test('TR03: stage metrics count the output lists; an agent with no result is unfinished', () => {
  assert.equal(span('research').attrs.facts, 29)
  assert.equal(span('research').attrs.requirements, 36)
  assert.equal(span('mutation').attrs.status, 'unfinished')
  assert.ok(span('mutation').tokens.out > 0)
})

test('TR04: --project overrides the derived project; with no session file and no override there is none', () => {
  assert.equal(claudeCodeSpans(WF, 'th08')[0].project, 'th08')
  const dir = join(mkdtempSync(join(tmpdir(), 'trace-')), 'a/b/c/wf')
  cpSync(WF, dir, { recursive: true })
  assert.equal(claudeCodeSpans(dir).some(s => 'project' in s), false)
})

test('TR05: an answer that is no object (text, null) is a died call with no metrics', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'trace-')), 'wf')
  cpSync(WF, dir, { recursive: true })
  const journal = join(dir, 'journal.jsonl')
  writeFileSync(journal, readFileSync(journal, 'utf8').split('\n').map(l => l.includes('"agentId": "a87841') && l.includes('"result"')
    ? JSON.stringify(Object.assign(JSON.parse(l), { result: 'API Error: overloaded' })) : l).join('\n'))
  assert.deepEqual(claudeCodeSpans(dir).find(s => s.label === 'plan').attrs, { kind: 'agent', status: 'died' })
})

test('TR06: a label maps to its block and round', () => {
  assert.deepEqual(['research:retry', 'replan', 'gates:r2:recheck', 'gates:r2:retry', 'review:r1:code', 'review:fix:r2:1', 'fix:r1:review', 'fix:minor', 'mutation']
    .map(blockOf), ['research', 'plan', 'gates r2', 'gates r2', 'review r1', 'fix-review r2', 'fix r1', 'minor-fix', 'mutation'])
})

test('TR07: the table sums calls and tokens per block and round, core time apart, and totals the run', () => {
  const rows = table(all).split('\n')
  assert.match(rows.find(r => r.startsWith('review r2 ')), /^review r2 +2 /)
  assert.ok(rows.some(r => r.startsWith('core ')))
  assert.match(rows.at(-1), /^total +21 /)
})

test('TR11: the speedscope file stacks block, call and work kind, weighted by seconds and by tokens', () => {
  const { shared: { frames }, profiles } = speedscope(all)
  assert.deepEqual(profiles.map(p => p.name), ['seconds', 'input tokens', 'output tokens'])
  assert.ok(frames.every(f => !f.name.includes('{')))
  const sum = name => profiles.find(p => p.name === name).weights.reduce((n, w) => n + w, 0)
  assert.equal(sum('output tokens'), spans.reduce((n, s) => n + s.tokens.out, 0))
  assert.equal(sum('input tokens'), spans.reduce((n, s) => n + s.tokens.in + s.tokens.cache_read + s.tokens.cache_write, 0))
  const seconds = profiles[0]
  const stack = i => seconds.samples[i].map(f => frames[f].name)
  assert.ok(seconds.samples.some((_, i) => stack(i).join(' > ') === 'implement > implement > Bash'))
  assert.ok(seconds.samples.some((_, i) => stack(i).join(' > ') === 'review r2 > review:r2:code > model'))
})
