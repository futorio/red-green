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
const fact = (kind, where, ...requirements) => ({ kind, fact: `FACT-${requirements.join('-')}`, where, requirements })
const harness = (requirement, by) => ({ requirement, by: by || 'test', how: 'h' })
const gate = (name, status, line) => ({ name, status, line })
const gatesAt = (head, ...rows) => ({ head, gates: rows.length ? rows : [gate('tests', 'ran', '17 of 17')] })

// The recorded results of one clean round and its mutation step; a case overrides the labels it is about.
function base(over) {
  return Object.assign({
    research: { requirements: ['R1: one'], facts: [fact('code', ['src/a.cpp:1-2'], 'R1')], plan: [], test_harness: [harness('R1')] },
    plan: { cases: [{ id: 'C1', requirement: 'R1', title: 't', arrange: 'a', act: 'a', asserts: ['x'] }] },
    implement: { committed: true, head: 'bbbb111', tests: [{ case_id: 'C1', file: 'f', test: 't' }], unverified: [], gate_output: 'g', commits: [] },
    'gates:r1': gatesAt('bbbb111'),
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
    'gates:r1:recheck': gatesAt('cccc222'),
    'gates:r2:recheck': gatesAt('cccc222'),
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
  const args = { repo: '/r', branch: 'b', tools: '/t', run: '/run', base: 'aaaa000', target: '/t.md', rounds: rounds || 1, baseline: { tests: '17 of 17' }, profile: { mutation: 'MUTATION-TOOL-TEXT', gates: [{ name: 'tests', command: 'npm test' }] }, extra_rounds: 0 }
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

// Two declared gates, A and B, with their baselines.
const twoGates = { profile: { mutation: 'MUTATION-TOOL-TEXT', gates: [{ name: 'A', command: 'make a' }, { name: 'B', command: 'make b' }] }, baseline: { A: 'A-BASE 3 of 3', B: 'B-BASE ok' } }

test('W04: the lens prompts carry each gate as name, status and line; the checklist job carries the scope sentence', async () => {
  const { calls } = await runCore({ 'gates:r1': gatesAt('bbbb111', gate('A', 'ran', 'GATE-SENTINEL 3 of 3'), gate('B', 'ran', 'B ok')) }, 1, twoGates)
  for (const label of ['review:r1:checklist', 'review:r1:code']) {
    assert.ok(prompt(calls, label).includes('A: ran — GATE-SENTINEL 3 of 3\nB: ran — B ok'), label)
    assert.ok(!/re-check the scope/.test(prompt(calls, label)), label)
  }
  assert.match(prompt(calls, 'review:r1:checklist'), /A change the ticket does not call for is a finding\./)
  assert.ok(!/A change the ticket does not call for/.test(prompt(calls, 'review:r1:code')))
})

test('W05: a failed gate is one major finding made by the script; on the recheck it is left over, a ran gate makes none', async () => {
  const { result, calls } = await runCore({
    'gates:r1': gatesAt('bbbb111', gate('A', 'failed', 'A-RED 2 of 3'), gate('B', 'ran', 'B ok')),
    'fix:r1': { applied: [{ id: 'G1-A', what: 'w' }], rejected: [], committed: true, head: 'cccc222', gate_output: '' },
    'gates:r1:recheck': gatesAt('cccc222', gate('A', 'failed', 'A-STILL-RED 1 of 3'), gate('B', 'ran', 'B ok')),
    mutation: { head: 'cccc222', tool: tool([]) },
  }, 1, twoGates)
  const sent = JSON.parse(prompt(calls, 'fix:r1').split('FINDINGS:\n')[1].split('\n\nRESEARCH:')[0])
  assert.equal(sent.length, 1)
  assert.equal(sent[0].id, 'G1-A')
  assert.equal(sent[0].source, 'gates')
  assert.equal(sent[0].severity, 'major')
  assert.equal(sent[0].where, 'A')
  assert.match(sent[0].problem, /A-RED 2 of 3.*A-BASE 3 of 3/)
  assert.match(sent[0].trigger, /A-RED 2 of 3.*A-BASE 3 of 3/)
  const left = result.leftover_findings.filter(f => f.source === 'gates')
  assert.deepEqual(left.map(f => f.id), ['G1r-A'])
  assert.match(left[0].problem, /A-STILL-RED 1 of 3/)
  assert.equal(result.advisory.filter(f => f.source === 'gates').length, 0)
  assert.equal(result.status, 'done')
})

test('W14: after a fix that moved HEAD the gates step runs every gate, with no scoping', async () => {
  const { calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], committed: false, head: 'cccc222', gate_output: '' },
    'gates:r2': gatesAt('cccc222'),
    mutation: { head: 'cccc222', tool: tool([]) },
  }, 2)
  const second = prompt(calls, 'gates:r2')
  assert.ok(!/already ran at|git diff --name-only|docs only|tests only/.test(second))
  assert.equal(second.replace(/cccc222/g, 'H').replace(/gates:r2/g, 'L'), prompt(calls, 'gates:r1').replace(/bbbb111/g, 'H').replace(/gates:r1/g, 'L'))
})

test('W49: the gates step names every declared gate with its command and baseline, and its schema takes only their names', async () => {
  const { calls } = await runCore({ 'gates:r1': gatesAt('bbbb111', gate('A', 'ran', 'a'), gate('B', 'ran', 'b')) }, 1, twoGates)
  const call = calls.find(c => c.label === 'gates:r1')
  for (const s of ['A: `make a` (baseline: A-BASE 3 of 3)', 'B: `make b` (baseline: B-BASE ok)']) assert.ok(call.prompt.includes(s), s)
  assert.ok(prompt(calls, 'implement').includes('A: `make a` (baseline: A-BASE 3 of 3)'))
  const item = call.opts.schema.properties.gates.items
  assert.deepEqual(item.properties.name.enum, ['A', 'B'])
  assert.deepEqual(item.properties.status.enum, ['ran', 'failed', 'not_run'])
  assert.deepEqual(Object.keys(call.opts.schema.properties), ['head', 'gates', 'notes', 'mailbox'])
  assert.match(call.prompt, /never cut a gate short/)
  for (const w of [/scope/i, /recount/i, /changed_files/, /git diff/, /SEVERITY/, /blocker/, /already ran at/]) assert.ok(!w.test(call.prompt.split('STAGE: gates')[1].split('MAILBOX')[0]), String(w))
})

test('W50: a not_run row and a declared gate with no row each add a failure naming the gate and the step', async () => {
  const { result } = await runCore({ 'gates:r1': gatesAt('bbbb111', gate('A', 'not_run', 'no time')) }, 1, twoGates)
  assert.equal(result.status, 'done_with_failures')
  assert.equal(result.failures.filter(f => /gates:r1/.test(f) && /\bA\b/.test(f)).length, 1)
  assert.equal(result.failures.filter(f => /gates:r1/.test(f) && /\bB\b/.test(f)).length, 1)
  assert.equal(result.leftover_findings.filter(f => f.source === 'gates').length, 0)
})

test('W51: a declared gate without a baseline entry fails the run before any agent is called', async () => {
  const { result, calls } = await runCore({}, 1, { profile: twoGates.profile, baseline: { A: 'a' } })
  assert.equal(calls.length, 0)
  assert.equal(result.status, 'failed')
  assert.match(result.note, /\bB\b/)
  assert.ok(!/\bA\b/.test(result.note.replace(/baseline/g, '')))
})

test('W52: the result records per round the gates rows that gated its HEAD, and the recheck rows', async () => {
  const { result } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], committed: true, head: 'cccc222', gate_output: '' },
    'gates:r1:recheck': gatesAt('cccc222', gate('tests', 'ran', 'RECHECK 17 of 17')),
    mutation: { head: 'cccc222', tool: tool([]) },
  })
  assert.deepEqual(result.rounds[0].gates, [gate('tests', 'ran', '17 of 17')])
  assert.deepEqual(result.rounds[0].recheck, [gate('tests', 'ran', 'RECHECK 17 of 17')])
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
    'gates:r2': gatesAt('cccc222'),
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
    'gates:r2': gatesAt('cccc222'),
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
    research: Object.assign({}, base().research, { requirements: ['R1: one', 'R2: two', 'R3: three'], test_harness: [harness('R1'), harness('R2', 'review'), harness('R3', 'review')] }),
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

test('W19: id-only rejections and a gate failed again with a new line each stay one finding', async () => {
  const { result } = await runCore({
    'gates:r1': gatesAt('bbbb111', gate('tests', 'failed', 'RED 1')),
    'fix:r1': { applied: [], rejected: [{ id: 'G1-tests', argument: 'a' }, { id: 'Z1', argument: 'a' }, { id: 'Z2', argument: 'a' }], committed: false, head: 'cccc222', gate_output: '' },
    'gates:r1:recheck': gatesAt('cccc222', gate('tests', 'failed', 'RED 2')),
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

test('W23: a run reviews every round with both lenses', async () => {
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
    'gates:r2': gatesAt('cccc222'),
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
    'gates:r2': gatesAt('cccc222'),
    'review:r2:code': again,
    'fix:r2': { applied: [{ id: 'R2-code-1', what: 'w' }], rejected: [], committed: true, head: 'dddd333', gate_output: '' },
    'gates:r2:recheck': gatesAt('dddd333'),
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

test('W32: with default rounds a run plans, reviews two full rounds with both lenses, then runs the mutation tool', async () => {
  const { result, calls } = await runCore({}, 'auto')
  assert.equal(result.rounds_planned, 2)
  assert.ok(called(calls, 'plan') && called(calls, 'review:r2:checklist') && called(calls, 'review:r2:code') && called(calls, 'mutation'))
  assert.match(prompt(calls, 'review:r1:code'), /Start from the change-site facts/)
})

test('W33: the last round\'s fix gets a fix-diff review; its major is fixed and reviewed once more, then left over', async () => {
  const late = { verdict: 'findings', rulings: [], checked: [row('x')], findings: [finding('major', 'b:1', 't')] }
  const { result, calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], committed: true, head: 'cccc222', gate_output: '' },
    'review:fix:r1': late,
    'fix:r1:review': { applied: [{ id: 'F1-1', what: 'w' }], rejected: [], committed: true, head: 'dddd333', gate_output: '' },
    'review:fix:r1:1': late,
    'gates:r1:recheck': gatesAt('dddd333'),
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

// The research JSON a later stage receives.
const researchIn = p => JSON.parse(p.split('RESEARCH:\n')[1].split('\n\nStart from')[0])
const research = over => Object.assign({}, base().research, over)

test('W35: requirement lines with a missing or repeated R<n> prefix are renumbered and reported in research_issues', async () => {
  const { result, calls } = await runCore({
    research: research({ requirements: ['R1: one', 'two', 'R1: three'], test_harness: [harness('R1'), harness('R2', 'review'), harness('R3', 'review')] }),
  })
  assert.deepEqual(researchIn(prompt(calls, 'plan')).requirements, ['R1: one', 'R2: two', 'R3: three'])
  assert.equal(result.research_issues.filter(f => /renumbered/.test(f)).length, 1)
  assert.deepEqual(result.research_issues.filter(f => /test_harness/.test(f)), [])
  assert.equal(result.status, 'done')
})

test('W36: a general fact is kept, a fact with no valid id is dropped and listed, an uncited requirement is listed', async () => {
  const { result, calls } = await runCore({
    research: research({ requirements: ['R1: one', 'R2: two'], test_harness: [harness('R1'), harness('R2', 'review')],
      facts: [fact('note', '$ rg x', 'general'), fact('code', ['a.js:1'], 'R9'), fact('code', ['b.js:2-3'], 'R1', 'R8')] }),
  })
  assert.deepEqual(researchIn(prompt(calls, 'plan')).facts.map(f => f.fact), ['FACT-general', 'FACT-R1-R8'])
  assert.deepEqual(result.dropped_facts.map(f => f.fact), ['FACT-R9'])
  assert.deepEqual(result.unresearched_requirements, ['R2: two'])
  assert.equal(result.status, 'done')
})

test('W37: test_harness keeps the first entry per requirement and drops unknown ids; gaps and repairs go to research_issues', async () => {
  const entry = (requirement, how, by) => ({ requirement, by: by || 'test', how })
  const { result, calls } = await runCore({
    research: research({ requirements: ['R1: one', 'R2: two', 'R3: three'], test_harness: [entry('R1', 'first'), entry('R1', 'second'), entry('R2', 'h', 'review'), entry('R7', 'h')] }),
  })
  assert.deepEqual(researchIn(prompt(calls, 'plan')).test_harness, [entry('R1', 'first'), entry('R2', 'h', 'review')])
  const issues = result.research_issues.filter(f => /test_harness/.test(f))
  assert.equal(issues.length, 3)
  for (const id of ['R1', 'R3', 'R7']) assert.equal(issues.filter(f => f.includes(id)).length, 1, id)
  assert.equal(result.status, 'done')
})

test('W38: files are derived from every location of the code and change-site facts', async () => {
  const { calls } = await runCore({
    research: research({ facts: [fact('code', ['src/a.cpp:1-5', 'src/b.h'], 'R1'), fact('change-site', ['src/a.cpp:9-10', 'src/c.cpp:3'], 'R1'),
      fact('note', 'docs/x.md § Y', 'R1'), fact('change-site', ['src/dropped.cpp'], 'R9')] }),
  })
  assert.deepEqual(researchIn(prompt(calls, 'plan')).files, ['src/a.cpp', 'src/b.h', 'src/c.cpp'])
})

test('W48: research questions with a known id reach the result alone; no later prompt sees them', async () => {
  const q = { requirement: 'R1', question: 'which exit code?', settles: 'owner' }
  const { result, calls } = await runCore({ research: research({ questions: [q, Object.assign({}, q, { requirement: 'R9' })] }) })
  assert.deepEqual(calls.find(c => c.label === 'research').opts.schema.properties.questions.items.properties.settles.enum, ['owner', 'outside'])
  assert.match(prompt(calls, 'research'), /- questions: every point/)
  assert.deepEqual(result.research_questions, [q])
  assert.equal(result.research_issues.filter(f => /question for unknown requirement R9: dropped/.test(f)).length, 1)
  calls.filter(c => c.label !== 'research').forEach(c => assert.ok(!/which exit code\?|"questions"/.test(c.prompt), c.label))
})

test('W39: the research asks for typed facts as JSON, and no prompt mentions research.md', async () => {
  const { calls } = await runCore({})
  const research = calls.find(c => c.label === 'research')
  assert.deepEqual(Object.keys(research.opts.schema.properties), ['requirements', 'facts', 'plan', 'test_harness', 'questions', 'mailbox'])
  assert.deepEqual(research.opts.schema.properties.facts.items.properties.kind.enum, ['code', 'change-site', 'note'])
  assert.equal(research.opts.schema.properties.plan.items.maxLength, 600)
  assert.ok(new RegExp(research.opts.schema.properties.requirements.items.pattern).test('R12: x'))
  assert.ok(!new RegExp(research.opts.schema.properties.requirements.items.pattern).test('x (R12)'))
  for (const s of ['- code and change-site:', '- note:', '`path § section`', '`$ command`', 'Every fact is shown by']) assert.ok(research.prompt.includes(s), s)
  assert.ok(!/Markdown/.test(research.prompt))
  // Research commits nothing and runs no gate: the preamble and the mailbox leave those rules out, later stages keep them.
  for (const s of ['COMMITS', 'Gates:', 'run_in_background', 'before committing']) {
    assert.ok(!research.prompt.includes(s), s)
    assert.ok(prompt(calls, 'implement').includes(s), s)
  }
  for (const c of calls) assert.ok(!c.prompt.includes('research.md'), c.label)
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

// Five requirements, one per route: R1 test, R2 review, R3 none, R4 launch, R5 no test_harness entry.
const routed = () => research({ requirements: ['R1: one', 'R2: two', 'R3: three', 'R4: four', 'R5: five'],
  test_harness: [harness('R1'), harness('R2', 'review'), harness('R3', 'none'), { requirement: 'R4', by: 'launch', how: 'LAUNCH-HOW' }] })

test('W40: research routes the requirements; the planner gets only the test ones, launch ones go to the result alone', async () => {
  const { result, calls } = await runCore({ research: routed() })
  const plan = calls.find(c => c.label === 'plan')
  assert.deepEqual(plan.opts.schema.properties.cases.items.properties.requirement.enum, ['R1'])
  assert.deepEqual(plan.opts.schema.required, ['cases', 'questions'])
  assert.deepEqual(Object.keys(plan.opts.schema.properties), ['cases', 'questions', 'mailbox'])
  assert.match(plan.prompt, /one case for each behaviour that R1 name,/)
  assert.ok(!/verify_review|verify_launch|BYTE FOR BYTE/.test(plan.prompt))
  const checklist = prompt(calls, 'review:r1:checklist')
  assert.match(checklist, /their ids: R1, R2, R3, R5 —/)
  assert.ok(checklist.includes(JSON.stringify(['R2: two', 'R3: three', 'R5: five'])))
  assert.ok(!/R4/.test(checklist.split('RESEARCH:')[0]))
  assert.deepEqual(result.verify_launch, [{ requirement: 'R4: four', how: 'LAUNCH-HOW' }])
  assert.deepEqual(result.verify_review, ['R2: two', 'R3: three', 'R5: five'])
  assert.deepEqual(result.leftover_findings.filter(f => f.id === 'R4'), [])
  assert.ok(!('unlisted_cases' in result))
})

test('W41: a case returned with an id reaches the implement prompt and the result with the full requirement line', async () => {
  const { result, calls } = await runCore({ implement: null, 'implement:retry': null })
  assert.match(prompt(calls, 'implement'), /"requirement": "R1: one"/)
  assert.equal(result.cases[0].requirement, 'R1: one')
})

test('W45: a stored plan whose case carries the full requirement line still expands to it', async () => {
  const plan = { cases: [Object.assign({}, base().plan.cases[0], { requirement: 'R1: one' })] }
  const { result } = await runCore({ plan, implement: null, 'implement:retry': null })
  assert.equal(result.cases[0].requirement, 'R1: one')
})

test('W46: two cases with the same check after the same Arrange and Act get one replan naming the check', async () => {
  const c = base().plan.cases[0]
  const { calls } = await runCore({ plan: { cases: [c, Object.assign({}, c, { id: 'C2', asserts: ['X ', 'y'] })] }, replan: base().plan })
  assert.equal(count(calls, 'replan'), 1)
  assert.match(prompt(calls, 'replan'), /keep each in one case: \[\{"check":"a \| a \| x","cases":\["C1","C2"\]\}\]\. Keep every other case/)
  assert.ok(!/uncovered/.test(prompt(calls, 'replan')))
})

test('W47: the open questions of the planner reach the result with who settles each; one tied to no case is dropped', async () => {
  const q = { requirement: 'R1', question: 'which dir wins?', reading: 'the upstream one', cases: ['C1'], settles: 'owner' }
  const loose = Object.assign({}, q, { question: 'anything else?', cases: ['C9'] })
  const { result, calls } = await runCore({ plan: Object.assign({}, base().plan, { questions: [q, loose] }) })
  assert.deepEqual(calls.find(c => c.label === 'plan').opts.schema.properties.questions.items.properties.settles.enum, ['research', 'owner'])
  assert.match(prompt(calls, 'plan'), /questions: every point the ticket and the research leave open/)
  assert.deepEqual(result.plan_questions, [q])
})

test('W42: a test requirement no case covers gets one replan naming only it, and is reported when still uncovered', async () => {
  const { result, calls } = await runCore({
    research: research({ requirements: ['R1: one', 'R2: two'], test_harness: [harness('R1'), harness('R2')] }),
    replan: base().plan,
  })
  assert.equal(count(calls, 'replan'), 1)
  assert.match(prompt(calls, 'replan'), /Your cases below leave R2 uncovered: add cases for each\. Keep every other case/)
  assert.ok(!/not in the list/.test(prompt(calls, 'replan')))
  assert.deepEqual(result.uncovered_requirements, ['R2'])
})

test('W43: with no test requirement, no plan or replan agent is called and the run goes on with no cases', async () => {
  const { result, calls } = await runCore({ research: research({ test_harness: [harness('R1', 'review')] }) })
  assert.ok(!called(calls, 'plan') && !called(calls, 'replan'))
  assert.match(prompt(calls, 'implement'), /CASES:\n\[\]/)
  assert.deepEqual(result.verify_review, ['R1: one'])
  assert.equal(result.status, 'done')
})

test('W44: plan and replan get the no-code preamble and the short mailbox checkpoints', async () => {
  const { calls } = await runCore({ plan: { cases: [] }, replan: base().plan })
  for (const label of ['plan', 'replan']) {
    const p = prompt(calls, label)
    for (const s of ['COMMITS', 'Gates:', 'run_in_background', 'Over-built', 'before committing']) assert.ok(!p.includes(s), `${label}: ${s}`)
    assert.match(p, /Read it at start and before returning\./, label)
  }
})

// A profile without gates, and what the discovery step finds.
const noGates = { profile: { mutation: 'MUTATION-TOOL-TEXT' }, baseline: 'ignored' }
const discovered = (over) => Object.assign({
  gates: [{ name: 'lint', command: 'npm run lint', source: 'AGENTS.md', line: 'LINT-BASE 0 errors' }, { name: 'test', command: 'npm test', source: 'AGENTS.md', line: 'TEST-BASE 9 of 9' }],
  questions: [],
}, over)

test('W53: with no profile.gates the discovery step runs first, and its gates and lines drive the gates step and the preamble', async () => {
  const q = { command: 'npm run e2e', source: 'AGENTS.md', question: 'needs a browser: a gate?' }
  const { result, calls } = await runCore({
    'gates:discover': discovered({ questions: [q, Object.assign({}, q, { source: 'Makefile' })] }),
    'gates:r1': gatesAt('bbbb111', gate('lint', 'ran', 'l'), gate('test', 'ran', 't')),
  }, 1, noGates)
  assert.deepEqual(calls.slice(0, 2).map(c => c.label), ['gates:discover', 'research'])
  const call = calls[0]
  assert.equal(call.opts.model, 'sonnet')
  assert.ok(call.prompt.includes('Where: the repo\'s agent instructions, then CI config, then the task runner; the first source that names gates wins. A gate: a command CI or those instructions require before a commit; runs with no human, network or secrets; pass/fail by exit code; writes nothing to the tree.'))
  for (const s of ['COMMITS', 'Gates:', 'run_in_background']) assert.ok(!call.prompt.includes(s), s)
  assert.deepEqual(Object.keys(call.opts.schema.properties.gates.items.properties), ['name', 'command', 'source', 'line'])
  assert.deepEqual(Object.keys(call.opts.schema.properties.questions.items.properties), ['command', 'source', 'question'])
  assert.deepEqual(calls.find(c => c.label === 'gates:r1').opts.schema.properties.gates.items.properties.name.enum, ['lint', 'test'])
  assert.ok(prompt(calls, 'implement').includes('lint: `npm run lint` (baseline: LINT-BASE 0 errors); test: `npm test` (baseline: TEST-BASE 9 of 9)'))
  assert.deepEqual(result.gates, discovered().gates)
  assert.deepEqual(result.gates_questions, [q])
  calls.slice(1).forEach(c => assert.ok(!/needs a browser/.test(c.prompt), c.label))
  assert.equal(result.status, 'done')
})

test('W54: a discovery step that dies or finds no gate fails the run before research', async () => {
  for (const r of [null, discovered({ gates: [] })]) {
    const { result, calls } = await runCore({ 'gates:discover': r }, 1, noGates)
    assert.equal(result.status, 'failed')
    assert.equal(result.stage, 'gates:discover')
    assert.ok(!called(calls, 'research'))
  }
})

test('W55: with profile.gates given no discovery step runs, and the result carries the declared gates and no questions', async () => {
  const { result, calls } = await runCore({})
  assert.ok(!called(calls, 'gates:discover'))
  assert.deepEqual(result.gates, [{ name: 'tests', command: 'npm test' }])
  assert.deepEqual(result.gates_questions, [])
})
