// Runs the ticket-tdd core (.claude/workflows/ticket-tdd.js) with a stub agent() that returns recorded
// results keyed by the call's label, and checks what the script does with them.
//
//     node --test .claude/workflows/ticket-tdd/test_ticket_tdd.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const SOURCE = readFileSync(new URL('../ticket-tdd.js', import.meta.url), 'utf8').replace('export const meta', 'const meta')
const core = new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', SOURCE)

const clone = x => JSON.parse(JSON.stringify(x))
const row = (item, extra) => Object.assign({ item, evidence: 'e' }, extra)
const clean = rows => ({ verdict: 'clean', findings: [], rulings: [], checked: rows })
const finding = (severity, where, trigger) => ({ severity, where, trigger, problem: 'p', consequence: 'c', fix: 'f' })
const survivor = i => ({ file: 'src/a.cpp', line: 9 + i, op: `op${i}`, before: `before${i}`, after: `after${i}` })
const tool = survivors => ({ applies: true, ran: true, survivors })
const ruling = (id, kind, reason) => ({ id, ruling: kind, reason })

// The recorded results of one clean round and its mutation step; a case overrides the labels it is about.
function base(over) {
  return Object.assign({
    research: { requirements: ['R1: one'], facts: [], plan: [], files: [], test_harness: '', risks: [], signals: [], anchors: [] },
    plan: { cases: [{ id: 'C1', requirement: 'R1: one', title: 't', arrange: 'a', act: 'a', asserts: ['x'] }], verify_launch: [], verify_review: [] },
    implement: { committed: true, head: 'bbbb111', tests: [{ case_id: 'C1', file: 'f', test: 't' }], unverified: [], gate_output: 'g', commits: [] },
    'gates:r1': { head: 'bbbb111', gate_lines: ['ok'], changed_files: ['src/a.cpp'], counts: [], findings: [] },
    'review:r1:checklist': clean([row('R1', { status: 'met' })]),
    'review:r1:code': clean([row('x')]),
    'review:r2:checklist': clean([row('R1', { status: 'met' })]),
    'review:r2:code': clean([row('x')]),
    mutation: { head: 'bbbb111', tool: tool([]) },
    'review:code:survivors': { rulings: [] },
    'fix:r1': { applied: [], rejected: [], committed: false, head: 'bbbb111', gate_output: '' },
    'fix:minor': { applied: [], rejected: [], committed: false, head: 'bbbb111', gate_output: '' },
    'review:fix:r1': clean([row('x')]),
    'review:fix:r1:1': clean([row('x')]),
    'review:fix:r2': clean([row('x')]),
    'review:fix:r3': clean([row('x')]),
    'review:fix:minor': clean([row('x')]),
    'gates:r1:recheck': { head: 'cccc222', gate_lines: ['ok'], changed_files: ['src/a.cpp'], counts: [], findings: [] },
    'gates:r2:recheck': { head: 'cccc222', gate_lines: ['ok'], changed_files: ['src/a.cpp'], counts: [], findings: [] },
  }, over)
}

// Runs the core. results[label] is a value, or a function of (call) returning one; null is a dead agent.
// extra: more args; a case gets no extra round unless it asks for one (extra_rounds).
async function runCore(over, rounds, extra) {
  const results = base(over)
  const calls = []
  const events = []
  const agent = async (prompt, opts) => {
    const call = { label: opts.label, prompt, opts }
    calls.push(call)
    events.push(`${opts.label} start`)
    const key = opts.label
    assert.ok(key in results, `no stub for ${opts.label}`)
    const r = typeof results[key] === 'function' ? await results[key](call, events) : results[key]
    return r && clone(r)
  }
  const parallel = thunks => Promise.all(thunks.map(async t => { try { return await t() } catch (e) { return null } }))
  const args = { repo: '/r', branch: 'b', tools: '/t', run: '/run', base: 'aaaa000', target: '/t.md', rounds: rounds || 1, baseline: 'b', profile: { mutation: 'MUTATION-TOOL-TEXT' }, extra_rounds: 0, level: 'heavy' }
  Object.assign(args, extra)
  const result = await core(args, agent, parallel, () => {}, () => {})
  return { result, calls, events }
}

const prompt = (calls, label) => calls.find(c => c.label === label).prompt
const called = (calls, label) => calls.some(c => c.label === label)
const count = (calls, label) => calls.filter(c => c.label === label).length
const withIds = (xs, id) => xs.filter(x => x.id === id)
const major = { verdict: 'findings', rulings: [], checked: [row('x')], findings: [finding('major', 'a:1', 't')] }
const mutants = (...ids) => ({ head: 'bbbb111', tool: tool(ids.map(survivor)) })

test('W01: ruled survivors go to advisory past the minor cap, an unruled one to fix as a major', async () => {
  const { result, calls } = await runCore({
    mutation: mutants(1, 2, 3, 4),
    'review:code:survivors': { rulings: [ruling('M-1', 'equivalent', 'r'), ruling('M-2', 'unreachable', 'r'), ruling('M-3', 'equivalent', 'r')] },
    'review:r1:code': { verdict: 'findings', rulings: [], checked: [row('x')], findings: [finding('minor', 'a:1', 't1'), finding('minor', 'a:2', 't2')] },
    'fix:r1': { applied: [], rejected: [{ id: 'M-4', argument: 'a' }], committed: false, head: 'bbbb111', gate_output: '' },
  })
  for (const id of ['M-1', 'M-2', 'M-3']) assert.equal(withIds(result.advisory, id).length, 1, id)
  assert.equal(withIds(result.advisory, 'M-1')[0].severity, 'minor')
  assert.match(prompt(calls, 'fix:r1'), /"id": "M-4"[^}]*"severity": "major"/)
  assert.ok(!/"id": "M-1"/.test(prompt(calls, 'fix:r1')))
})

test('W02: the ruling offers equivalent/unreachable, and a ruling without a reason does not count', async () => {
  const { calls } = await runCore({
    mutation: mutants(1, 2),
    'review:code:survivors': { rulings: [ruling('M-1', 'unreachable', '')] },
  })
  const item = calls.find(c => c.label === 'review:code:survivors').opts.schema.properties.rulings.items
  assert.deepEqual(item.properties.ruling.enum, ['equivalent', 'unreachable'])
  assert.ok(item.required.includes('reason'))
  assert.match(prompt(calls, 'fix:r1'), /"id": "M-1"[^}]*"severity": "major"/)
})

test('W03: the lenses start after the gates step of their round returns', async () => {
  const { events } = await runCore({
    'gates:r1': async (call, log) => { log.push('gates:r1 resolved'); return base()['gates:r1'] },
  })
  const at = e => events.indexOf(e)
  assert.ok(at('gates:r1 resolved') >= 0)
  assert.ok(at('review:r1:checklist start') > at('gates:r1 resolved'))
  assert.ok(at('review:r1:code start') > at('gates:r1 resolved'))
})

test('W04: the lens prompts carry the gate lines, gates findings pass through tidy', async () => {
  const { result, calls } = await runCore({
    'gates:r1': { head: 'bbbb111', gate_lines: ['GATE-SENTINEL 17 of 17'], changed_files: ['src/a.cpp'], counts: [],
      findings: [finding('major', 'g.py:1', ''), finding('major', 'g.py:2', 'run g')] },
    'fix:r1': { applied: [{ id: 'G1-2', what: 'w' }], rejected: [], committed: false, head: 'bbbb111', gate_output: '' },
  })
  assert.ok(prompt(calls, 'review:r1:checklist').includes('GATE-SENTINEL'))
  assert.ok(prompt(calls, 'review:r1:code').includes('GATE-SENTINEL'))
  const down = result.advisory.filter(f => f.where === 'g.py:1')
  assert.equal(down.length, 1)
  assert.equal(down[0].severity, 'minor')
  assert.match(prompt(calls, 'fix:r1'), /g\.py:2/)
})

test('W05: a gates finding that comes back after the last fix appears once in the leftover, a new one is not lost', async () => {
  const again = { head: 'cccc222', gate_lines: ['ok'], changed_files: ['src/a.cpp'], counts: [], findings: [finding('major', 'g.py:2', 'run g'), finding('major', 'OTHER.py:5', 'run o')] }
  const { result, calls } = await runCore({
    'gates:r1': Object.assign({}, base()['gates:r1'], { findings: [finding('major', 'g.py:2', 'run g')] }),
    'fix:r1': { applied: [], rejected: [{ id: 'G1-1', argument: 'a' }], committed: false, head: 'cccc222', gate_output: '' },
    'gates:r1:recheck': again,
  })
  assert.ok(called(calls, 'gates:r1:recheck'))
  assert.deepEqual(result.leftover_findings.filter(f => f.source === 'gates').map(f => f.where).sort(), ['OTHER.py:5', 'g.py:2'])
})

test('W14: after a fix the gates step is told the gated HEAD and the scoping', async () => {
  const { calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], committed: false, head: 'cccc222', gate_output: '' },
    'gates:r2': Object.assign({}, base()['gates:r1'], { head: 'cccc222' }),
    mutation: { head: 'cccc222', tool: tool([]) },
  }, 2)
  assert.ok(!/already ran at/.test(prompt(calls, 'gates:r1')))
  const second = prompt(calls, 'gates:r2')
  assert.match(second, /already ran at bbbb111/)
  assert.match(second, /git diff --name-only bbbb111\.\.HEAD/)
  assert.match(second, /Only docs[^.]*changed: no build, replay check or test/)
  assert.match(second, /Only tests changed: no build or replay check, only the changed test files/)
})

test('W15: a fix that leaves HEAD alone reuses the gates result', async () => {
  const { calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], committed: false, head: 'bbbb111', gate_output: '' },
  }, 2)
  assert.ok(called(calls, 'review:r2:code'))
  assert.ok(!called(calls, 'gates:r2'))
})

test('W16: no ruling call without a survivor', async () => {
  assert.ok(!called((await runCore({})).calls, 'review:code:survivors'))
})

test('W24: the mutation tool runs once, in its own step after a clean round, never in a gates step', async () => {
  const { calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], committed: false, head: 'cccc222', gate_output: '' },
    'gates:r2': Object.assign({}, base()['gates:r1'], { head: 'cccc222' }),
    mutation: { head: 'cccc222', tool: tool([]) },
  }, 2)
  assert.equal(count(calls, 'mutation'), 1)
  assert.match(prompt(calls, 'mutation'), /MUTATION-TOOL-TEXT/)
  for (const label of ['gates:r1', 'gates:r2']) assert.ok(!prompt(calls, label).includes('MUTATION-TOOL-TEXT'), label)
  const order = calls.map(c => c.label)
  assert.ok(order.indexOf('mutation') > order.indexOf('review:r2:code'))
})

test('W25: survivors get a fix and one more round without the tool, past the planned rounds', async () => {
  const { result, calls } = await runCore({
    mutation: mutants(1),
    'fix:r1': { applied: [{ id: 'M-1', what: 'w' }], rejected: [], committed: false, head: 'cccc222', gate_output: '' },
    'gates:r2': Object.assign({}, base()['gates:r1'], { head: 'cccc222' }),
  }, 1)
  assert.ok(called(calls, 'review:r2:code'))
  assert.equal(count(calls, 'mutation'), 1)
  assert.equal(result.rounds_run, 2)
  assert.deepEqual(result.leftover_findings, [])
})

test('W26: a run that ends without a clean round still runs the tool once, and its survivors are left over', async () => {
  const keep = { applied: [], rejected: [{ id: 'R1-code-1', argument: 'a' }], committed: false, head: 'bbbb111', gate_output: '' }
  const { result, calls } = await runCore({
    'review:r1:code': major, 'fix:r1': keep,
    mutation: mutants(1, 2),
    'review:code:survivors': { rulings: [ruling('M-2', 'equivalent', 'r')] },
  })
  assert.equal(count(calls, 'mutation'), 1)
  assert.equal(count(calls, 'fix:r1'), 1)
  assert.deepEqual(result.leftover_findings.filter(f => f.source === 'mutation').map(f => f.id), ['M-1'])
  assert.deepEqual(result.advisory.filter(f => f.source === 'mutation').map(f => f.id), ['M-2'])
})

test('W27: a dead fix stops the run before the tool', async () => {
  const { calls } = await runCore({ 'review:r1:code': major, 'fix:r1': null })
  assert.ok(!called(calls, 'mutation'))
})

test('W07: a lens major without a trigger becomes a minor and is not fixed', async () => {
  const { result, calls } = await runCore({
    'review:r1:code': { verdict: 'findings', rulings: [], checked: [row('x')], findings: [finding('major', 'x.js:1', '')] },
  })
  const hit = result.advisory.filter(f => f.where === 'x.js:1')
  assert.equal(hit.length, 1)
  assert.equal(hit[0].severity, 'minor')
  assert.equal(hit[0].downgraded, true)
  assert.ok(!called(calls, 'fix:r1'))
  assert.deepEqual(result.leftover_findings, [])
})

test('W08: a lens with three minors keeps the first two', async () => {
  const { result } = await runCore({
    'review:r1:code': { verdict: 'findings', rulings: [], checked: [row('x')], findings: ['m1', 'm2', 'm3'].map(w => finding('minor', w, 't')) },
  })
  assert.equal(result.advisory.filter(f => f.source === 'code').length, 2)
  assert.deepEqual(result.advisory.map(f => f.where).sort(), ['m1', 'm2'])
})

test('W09: an unmet requirement goes to fix as a major, unmet and unrowed ones end in the leftover', async () => {
  const { result, calls } = await runCore({
    research: Object.assign({}, base().research, { requirements: ['R1: one', 'R2: two', 'R3: three'] }),
    plan: Object.assign({}, base().plan, { verify_review: ['R2: two', 'R3: three'] }),
    'review:r1:checklist': clean([row('R1', { status: 'met' }), row('R2', { status: 'unmet', evidence: 'clause x fails' })]),
    'fix:r1': { applied: [{ id: 'R1-R2', what: 'w' }], rejected: [], committed: false, head: 'bbbb111', gate_output: '' },
  })
  assert.match(prompt(calls, 'fix:r1'), /R1-R2/)
  assert.equal(withIds(result.leftover_findings, 'R2')[0].status, 'unmet')
  assert.equal(withIds(result.leftover_findings, 'R3')[0].status, 'unverified')
  assert.equal(withIds(result.leftover_findings, 'R1').length, 0)
})

test('W10: a clean run is done', async () => {
  assert.equal((await runCore({})).result.status, 'done')
})

test('W11: an implementation with unverified claims is done_unverified', async () => {
  const implement = Object.assign({}, base().implement, { unverified: ['x not run'] })
  assert.equal((await runCore({ implement })).result.status, 'done_unverified')
})

test('W12: a dead lens makes the run done_with_failures', async () => {
  assert.equal((await runCore({ 'review:r1:checklist': null })).result.status, 'done_with_failures')
})

test('W18: a dead ruling agent, mutation step or gates step is a failure', async () => {
  const dead = await runCore({ mutation: mutants(1), 'review:code:survivors': null, 'fix:r1': { applied: [], rejected: [{ id: 'M-1', argument: 'a' }], committed: false, head: 'bbbb111', gate_output: '' } })
  assert.equal(dead.result.status, 'done_with_failures')
  assert.equal((await runCore({ mutation: null })).result.status, 'done_with_failures')
  assert.equal((await runCore({ mutation: { head: 'bbbb111', tool: { applies: true, ran: false, not_run: 'x' } } })).result.status, 'done_with_failures')
  const noGates = await runCore({ 'gates:r1': null })
  assert.equal(noGates.result.status, 'done_with_failures')
})

test('W19: id-only rejections and reused gates ids each stay one finding', async () => {
  const gates = Object.assign({}, base()['gates:r1'], { findings: [finding('major', 'g.py:2', 'run g')] })
  const late = Object.assign({}, gates, { head: 'cccc222', findings: [finding('major', 'g.py:7', 'run h')] })
  const { result } = await runCore({
    'gates:r1': gates,
    'fix:r1': { applied: [], rejected: [{ id: 'G1-1', argument: 'a' }, { id: 'Z1', argument: 'a' }, { id: 'Z2', argument: 'a' }], committed: false, head: 'cccc222', gate_output: '' },
    'gates:r1:recheck': late,
    mutation: { head: 'cccc222', tool: tool([]) },
  })
  assert.deepEqual(['Z1', 'Z2'].map(id => withIds(result.leftover_findings, id).length), [1, 1])
  assert.equal(result.leftover_findings.filter(f => f.source === 'gates').length, 2)
  const ids = result.leftover_findings.map(f => f.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('W20: the ruling and its reason reach the advisory problem', async () => {
  const { result } = await runCore({
    mutation: mutants(1),
    'review:code:survivors': { rulings: [ruling('M-1', 'equivalent', 'REASON-TEXT')] },
  })
  assert.match(result.advisory.find(f => f.source === 'mutation').problem, /ruled equivalent: REASON-TEXT/)
})

test('W22: a survivor the fix rejected without moving HEAD is not sent to fix again', async () => {
  const { calls } = await runCore({
    mutation: mutants(1),
    'fix:r1': { applied: [], rejected: [{ id: 'M-1', argument: 'a' }], committed: false, head: 'bbbb111', gate_output: '' },
    'fix:r2': { applied: [], rejected: [], committed: false, head: 'bbbb111', gate_output: '' },
  })
  assert.ok(!called(calls, 'fix:r2'))
})

test('W23: a heavy run reviews every round with both lenses', async () => {
  const major = { verdict: 'findings', rulings: [], checked: [row('x')], findings: [finding('major', 'a:1', 't')] }
  const keep = { applied: [], rejected: [{ id: 'x', argument: 'a' }], committed: false, head: 'bbbb111', gate_output: '' }
  const { calls } = await runCore({
    'review:r1:code': major, 'fix:r1': keep,
    'review:r2:code': major, 'fix:r2': keep,
    'review:r3:checklist': clean([row('R1', { status: 'met' })]), 'review:r3:code': clean([row('x')]),
  }, 3)
  assert.ok(called(calls, 'review:r3:checklist'))
  assert.ok(called(calls, 'review:r3:code'))
})

test('W28: with extra_rounds, a major fixed in the last planned round gets one more full round', async () => {
  const { result, calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], committed: true, head: 'cccc222', gate_output: '' },
    'gates:r2': Object.assign({}, base()['gates:r1'], { head: 'cccc222' }),
    mutation: { head: 'cccc222', tool: tool([]) },
  }, 1, { extra_rounds: 1 })
  assert.ok(called(calls, 'review:r2:code'))
  assert.equal(result.rounds_run, 2)
  assert.deepEqual(result.leftover_findings, [])
})

test('W29: with extra_rounds, a major still found in the extra round is fixed and its fix gets a fix-diff review', async () => {
  const again = { verdict: 'findings', rulings: [], checked: [row('x')], findings: [finding('major', 'a:2', 't')] }
  const { result, calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], committed: true, head: 'cccc222', gate_output: '' },
    'gates:r2': Object.assign({}, base()['gates:r1'], { head: 'cccc222' }),
    'review:r2:code': again,
    'fix:r2': { applied: [{ id: 'R2-code-1', what: 'w' }], rejected: [], committed: true, head: 'dddd333', gate_output: '' },
    'gates:r2:recheck': Object.assign({}, base()['gates:r1'], { head: 'dddd333' }),
    mutation: { head: 'dddd333', tool: tool([]) },
  }, 1, { extra_rounds: 1 })
  assert.ok(!called(calls, 'review:r3:code'))
  assert.match(prompt(calls, 'review:fix:r2'), /git diff cccc222\.\.HEAD/)
  assert.deepEqual(withIds(result.leftover_findings, 'R2-code-1'), [])
})

test('W30: minors go to one cheap fixer; applied ones leave advisory, rejected and ruled-survivor ones stay', async () => {
  const minors = { verdict: 'findings', rulings: [], checked: [row('x')], findings: [finding('minor', 'a:1', 't1'), finding('minor', 'a:2', 't2')] }
  const { result, calls } = await runCore({
    'review:r1:code': minors,
    mutation: mutants(1),
    'review:code:survivors': { rulings: [ruling('M-1', 'equivalent', 'r')] },
    'fix:minor': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [{ id: 'R1-code-2', argument: 'a' }], committed: true, head: 'cccc222', gate_output: '' },
  })
  const call = calls.find(c => c.label === 'fix:minor')
  assert.equal(call.opts.model, 'sonnet')
  assert.ok(!/"id": "M-1"/.test(call.prompt))
  assert.deepEqual(result.advisory.map(f => f.id).sort(), ['M-1', 'R1-code-2'])
  assert.deepEqual(result.minor_fixes.applied.map(a => a.id), ['R1-code-1'])
})

test('W31: no minors calls no minor fixer; a dead one is a failure', async () => {
  assert.ok(!called((await runCore({})).calls, 'fix:minor'))
  const minor = { verdict: 'findings', rulings: [], checked: [row('x')], findings: [finding('minor', 'a:1', 't1')] }
  assert.equal((await runCore({ 'review:r1:code': minor, 'fix:minor': null })).result.status, 'done_with_failures')
})

test('W32: research signals and heavy paths pick the level, and args.level overrides it', async () => {
  const research = (signals, files) => Object.assign({}, base().research, { signals, files: files || [] })
  const standard = await runCore({ research: research([]) }, 'auto', { level: undefined })
  assert.equal(standard.result.level, 'standard')
  assert.ok(called(standard.calls, 'plan') && called(standard.calls, 'review:r1:code'))
  assert.ok(!called(standard.calls, 'mutation') && !called(standard.calls, 'review:r2:code'))
  const light = await runCore({ research: research([{ signal: 'docs-or-mechanical', source: 's' }]) }, 'auto', { level: undefined })
  assert.equal(light.result.level, 'light')
  assert.ok(!called(light.calls, 'plan') && !called(light.calls, 'review:r1:code') && called(light.calls, 'review:r1:checklist'))
  const signal = await runCore({ research: research([{ signal: 'docs-or-mechanical', source: 's' }, { signal: 'format-or-determinism', source: 'f:1' }]) }, 'auto', { level: undefined })
  assert.equal(signal.result.level, 'heavy')
  assert.match(signal.result.level_why.join(' '), /format-or-determinism \(f:1\)/)
  assert.ok(called(signal.calls, 'review:r2:code') && called(signal.calls, 'mutation'))
  const path = await runCore({ research: research([], ['scripts/gate.py']) }, 'auto', { level: undefined, profile: { mutation: 'M', heavy_paths: ['^scripts/gate'] } })
  assert.equal(path.result.level, 'heavy')
  const forced = await runCore({ research: research([{ signal: 'format-or-determinism', source: 'f:1' }]) }, 'auto', { level: 'light' })
  assert.equal(forced.result.level, 'light')
  assert.match(prompt(standard.calls, 'review:r1:code'), /\/run\/research\.md/)
})

test('W33: the last round\'s fix gets a fix-diff review; its major is fixed and reviewed once more, then left over', async () => {
  const late = { verdict: 'findings', rulings: [], checked: [row('x')], findings: [finding('major', 'b:1', 't')] }
  const { result, calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], committed: true, head: 'cccc222', gate_output: '' },
    'review:fix:r1': late,
    'fix:r1:review': { applied: [{ id: 'F1-1', what: 'w' }], rejected: [], committed: true, head: 'dddd333', gate_output: '' },
    'review:fix:r1:1': late,
    'gates:r1:recheck': Object.assign({}, base()['gates:r1'], { head: 'dddd333' }),
    mutation: { head: 'dddd333', tool: tool([]) },
  })
  assert.match(prompt(calls, 'review:fix:r1'), /git diff bbbb111\.\.HEAD/)
  assert.match(prompt(calls, 'review:fix:r1'), /R1-code-1/)
  assert.match(prompt(calls, 'review:fix:r1:1'), /git diff cccc222\.\.HEAD/)
  assert.ok(!called(calls, 'review:r2:code'))
  const left = result.leftover_findings.filter(f => f.source === 'fix review')
  assert.equal(left.length, 1)
  assert.equal(left[0].status, 'unverified')
})

test('W34: a minor fix that moves HEAD gets a fix-diff review', async () => {
  const minorOnly = { verdict: 'findings', rulings: [], checked: [row('x')], findings: [finding('minor', 'c:1', '')] }
  const { calls } = await runCore({
    'review:r1:code': minorOnly,
    'fix:minor': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], committed: true, head: 'eeee444', gate_output: '' },
  })
  assert.ok(called(calls, 'review:fix:minor'))
  assert.match(prompt(calls, 'review:fix:minor'), /git diff bbbb111\.\.HEAD/)
})
