// Runs the red-green core (.claude/workflows/red-green.js) with a stub agent() that returns recorded
// results keyed by the call's label, and checks what the script does with them.
//
//     node --test .claude/workflows/red-green/test_red_green.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validate } from './template/render.mjs'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const SOURCE = readFileSync(new URL('../red-green.js', import.meta.url), 'utf8').replace('export const meta', 'const meta')
const coreOf = source => new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', source)
let core = coreOf(SOURCE)

const clone = x => JSON.parse(JSON.stringify(x))
const row = (item, extra) => Object.assign({ item, evidence: 'e' }, extra)
const clean = rows => ({ verdict: 'clean', findings: [], checked: rows })
// A finding at a place: a string names its file, symbol S.
const finding = (severity, where, trigger) => ({ severity, where: typeof where === 'string' ? { file: where, symbol: 'S' } : where, trigger, problem: 'p', consequence: 'c', fix: 'f' })
// A sent finding's place as its file or, for a gate or a requirement, its name.
const fileOf = f => f.where.file || f.where
const TESTS = [{ name: 'tests', command: 'npm test' }]
// Args whose profile declares these gates (TESTS unless given; null: none), with these block configs over them and the
// other profile fields as given.
const withProfile = ({ gates = TESTS, blocks = {}, ...rest } = {}) => ({ profile: Object.assign(rest, { blocks: Object.assign({}, blocks, {
  gates: Object.assign(gates ? { gates } : {}, blocks.gates) }) }) })
const withBlocks = blocks => withProfile({ blocks })
const fact = (kind, where, ...requirements) => ({ kind, fact: `FACT-${requirements.join('-')}`, where, requirements })
const harness = (requirement, by) => ({ requirement, by: by || 'test', how: 'h' })
const gate = (name, status, line) => ({ name, status, line })
const check = (ref, extra) => Object.assign({ kind: 'case', ref, requirement: 'R1', test: { file: 'f', name: 't' }, red: 'FAILED: t' }, extra)
const measured = (line, status = 'green') => ({ status, line })
const gatesAt = (head, ...rows) => ({ head, gates: rows.length ? rows : [gate('tests', 'green', '17 of 17')] })

// The recorded results of one clean round; a case overrides the labels it is about.
function base(over) {
  return Object.assign({
    research: { requirements: ['R1: one'], facts: [fact('code', ['src/a.cpp:1-2'], 'R1')], plan: [], test_harness: [harness('R1')] },
    plan: { cases: [{ id: 'C1', requirement: 'R1', title: 't', arrange: 'a', act: 'a', asserts: ['x'] }] },
    implement: { head: 'bbbb111', checks: [check('C1')], unverified: [], questions: [] },
    'gates:r1': gatesAt('bbbb111'),
    'review:r1:checklist': clean([row('R1', { status: 'met' })]),
    'review:r1:code': clean([row('x')]),
    'review:r2:checklist': clean([row('R1', { status: 'met' })]),
    'review:r2:code': clean([row('x')]),
    'review:r3:checklist': clean([row('R1', { status: 'met' })]),
    'review:r3:code': clean([row('x')]),
    'gates:r2': gatesAt('cccc222'),
    'gates:r3': gatesAt('cccc222'),
  }, over)
}

// Runs the core. results[label] is a value, or a function of (call) returning one; null is a dead agent.
// rounds: profile.blocks.review.rounds, 1 (with min 1) when not given, the default when 'default'; extra: more args,
// whose profile.blocks merge over that.
async function runCore(over, rounds, extra) {
  const results = base(over)
  const calls = []
  const events = []
  const logs = []
  const agent = async (prompt, opts) => {
    const call = { label: opts.label, prompt, opts, logged: [...logs] }
    calls.push(call)
    events.push(`${opts.label} start`)
    const key = opts.label
    assert.ok(key in results, `no stub for ${opts.label}`)
    const r = typeof results[key] === 'function' ? await results[key](call, events) : results[key]
    return r && clone(r)
  }
  const parallel = thunks => Promise.all(thunks.map(async t => { try { return await t() } catch (e) { return null } }))
  const args = { repo: '/r', branch: 'b', tools: '/t', run: '/run', base: 'aaaa000', target: '/t.md', baseline: { tests: measured('17 of 17') }, profile: withProfile().profile }
  Object.assign(args, extra)
  const blocks = Object.assign({}, args.profile.blocks)
  blocks.review = Object.assign(rounds === 'default' ? {} : rounds > 1 ? { rounds } : { rounds: 1, min: 1 }, blocks.review)
  args.profile = Object.assign({}, args.profile, { blocks })
  const result = await core(args, agent, parallel, () => {}, line => { logs.push(line) })
  return { result, calls, events, logs }
}

const prompt = (calls, label) => calls.find(c => c.label === label).prompt
const called = (calls, label) => calls.some(c => c.label === label)
const count = (calls, label) => calls.filter(c => c.label === label).length
const withIds = (xs, id) => xs.filter(x => x.id === id)
const major = { verdict: 'findings', checked: [row('x')], findings: [finding('major', 'a:1', 't')] }
const sentTo = (calls, label) => JSON.parse(prompt(calls, label).split('FINDINGS:\n')[1].split(/\n\n[A-Z ]+:/)[0])

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
const twoGates = { profile: withProfile({ gates: [{ name: 'A', command: 'make a' }, { name: 'B', command: 'make b' }] }).profile, baseline: { A: measured('A-BASE 3 of 3'), B: measured('B-BASE ok') } }
// With no attempts on a red gate: for a case about what follows the attempts.
const noAttempts = withBlocks({ gates: { fix_attempts: 0 } })
const twoNoAttempts = { baseline: twoGates.baseline, profile: withProfile({ gates: twoGates.profile.blocks.gates.gates, blocks: { gates: { fix_attempts: 0 } } }).profile }

test('W04: the lens prompts carry each gate as name, status and line; the checklist job carries the scope sentence', async () => {
  const { calls } = await runCore({ 'gates:r1': gatesAt('bbbb111', gate('A', 'green', 'GATE-SENTINEL 3 of 3'), gate('B', 'green', 'B ok')) }, 1, twoGates)
  for (const label of ['review:r1:checklist', 'review:r1:code']) {
    assert.ok(prompt(calls, label).includes('A: green — GATE-SENTINEL 3 of 3\nB: green — B ok'), label)
    assert.ok(!/re-check the scope/.test(prompt(calls, label)), label)
  }
  assert.match(prompt(calls, 'review:r1:checklist'), /Scope: a change the statement does not call for is a finding\./)
  assert.ok(!/does not call for/.test(prompt(calls, 'review:r1:code')))
})

test('W05: a red gate is one major finding made by the script; red at the last iteration it is left over, a green gate makes none', async () => {
  const { result, calls } = await runCore({
    'gates:r1': gatesAt('bbbb111', gate('A', 'red', 'A-RED 2 of 3'), gate('B', 'green', 'B ok')),
    'fix:r1': { applied: [{ id: 'G1-A', what: 'w' }], rejected: [], head: 'cccc222' },
    'gates:r2': gatesAt('cccc222', gate('A', 'red', 'A-STILL-RED 1 of 3'), gate('B', 'green', 'B ok')),
  }, 2, twoNoAttempts)
  const sent = sentTo(calls, 'fix:r1')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].id, 'G1-A')
  assert.equal(sent[0].source, 'gates')
  assert.equal(sent[0].severity, 'major')
  assert.equal(sent[0].where, 'A')
  assert.match(sent[0].problem, /A-RED 2 of 3.*A-BASE 3 of 3/)
  assert.match(sent[0].trigger, /A-RED 2 of 3.*A-BASE 3 of 3/)
  const left = result.leftover_findings.filter(f => f.source === 'gates')
  assert.deepEqual(left.map(f => f.id), ['G2-A'])
  assert.match(left[0].problem, /A-STILL-RED 1 of 3/)
  assert.equal(result.advisory.filter(f => f.source === 'gates').length, 0)
  assert.equal(result.status, 'done')
})

test('W14: after a fix that moved HEAD the gates step runs every gate, with no scoping', async () => {
  const { calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], head: 'cccc222' },
    'gates:r2': gatesAt('cccc222'),
  }, 2)
  const second = prompt(calls, 'gates:r2')
  assert.ok(!/already ran at|git diff --name-only|docs only|tests only/.test(second))
  assert.equal(second.replace(/cccc222/g, 'H').replace(/gates:r2/g, 'L'), prompt(calls, 'gates:r1').replace(/bbbb111/g, 'H').replace(/gates:r1/g, 'L'))
})

test('W49: the gates step runs the runner on the declared gates at tier round, and its schema takes the runner rows', async () => {
  const { calls } = await runCore({ 'gates:r1': gatesAt('bbbb111', gate('A', 'green', 'a'), gate('B', 'green', 'b')) }, 1, twoGates)
  const call = calls.find(c => c.label === 'gates:r1')
  const stage = call.prompt.split('STAGE: gates')[1].split('MAILBOX')[0]
  assert.ok(stage.includes(`node /t/.claude/workflows/red-green/skills/run_gates.mjs --gates '${JSON.stringify(twoGates.profile.blocks.gates.gates)}' --dir /run --repo /r --tier round --baseline '${JSON.stringify(twoGates.baseline)}'`), stage)
  const item = call.opts.schema.properties.gates.items
  assert.deepEqual(item.properties.name.enum, ['A', 'B'])
  assert.deepEqual(item.properties.status.enum, ['green', 'red', 'known_red', 'not_run'])
  assert.deepEqual(item.required, ['name', 'status', 'line'])
  assert.deepEqual(Object.keys(item.properties), ['name', 'status', 'line', 'log', 'seconds', 'cached'])
  assert.deepEqual(Object.keys(call.opts.schema.properties), ['head', 'gates', 'notes', 'mailbox'])
  for (const w of [/scope/i, /recount/i, /changed_files/, /git diff/, /SEVERITY/, /blocker/, /already ran at/, /reviewers/, /cut a gate short/]) assert.ok(!w.test(stage), String(w))
  for (const s of ['COMMITS', 'Gates:', 'Over-built']) assert.ok(!call.prompt.includes(s), s)
})

test('W112: the gates prompt has no background rule, says to call again on exit 3 at most 6 calls, then not_run, and states the Bash timeout', async () => {
  const stage = prompt((await runCore({})).calls, 'gates:r1')
  assert.ok(!/run_in_background/.test(stage))
  assert.match(stage, /Bash timeout of 600000 ms/)
  assert.match(stage, /Exit 3: .*again, at most 6 calls/)
  assert.match(stage, /after the 6th.*`not_run`/)
})

test('W113: the gates block defaults to Haiku, medium', async () => {
  const { opts } = (await runCore({})).calls.find(c => c.label === 'gates:r1')
  assert.deepEqual([opts.model, opts.effort], ['haiku', 'medium'])
})

// A fast, a round (by default) and an acceptance gate; only the first two have a baseline.
const tiered = { profile: withProfile({ gates: [{ name: 'L', command: 'lint', tier: 'fast' }, { name: 'T', command: 'test' }, { name: 'H', command: 'heavy', tier: 'acceptance' }] }).profile,
  baseline: { L: measured('L ok'), T: measured('T ok') } }
const greenLT = gatesAt('bbbb111', gate('L', 'green', 'l'), gate('T', 'green', 't'))

test('W114: an acceptance gate needs no baseline, reads as no missing row, and writers do not get it', async () => {
  const { result, calls } = await runCore({ 'gates:r1': greenLT }, 1, tiered)
  assert.ok(!called(calls, 'gates:r1:retry'))
  assert.deepEqual(result.rounds[0].gates, greenLT.gates)
  assert.deepEqual(result.failures, [])
  assert.equal(result.status, 'done')
  assert.deepEqual(calls.find(c => c.label === 'gates:r1').opts.schema.properties.gates.items.properties.name.enum, ['L', 'T'])
  assert.ok(!/heavy/.test(prompt(calls, 'implement')))
  assert.ok(prompt(calls, 'gates:r1').includes('"name":"H"'))
})

test('W115: a known_red gate makes no finding and its row stays in the rounds and the lens prompts', async () => {
  const known = gate('tests', 'known_red', 'OLD 3 failed')
  const { result, calls } = await runCore({ 'gates:r1': gatesAt('bbbb111', known) }, 1, { baseline: { tests: measured('OLD 3 failed', 'red') } })
  assert.ok(!called(calls, 'fix:r1'))
  assert.ok(!called(calls, 'gates:r1:retry'))
  assert.deepEqual(result.rounds[0].gates, [known])
  assert.equal(result.leftover_findings.filter(f => f.source === 'gates').length, 0)
  assert.ok(prompt(calls, 'review:r1:code').includes('tests: known_red — OLD 3 failed'))
})

test('W116: a red gate is a major whose problem names its log', async () => {
  const { calls } = await runCore({
    'gates:r1': gatesAt('bbbb111', Object.assign(gate('tests', 'red', 'RED 1'), { log: '/run/gate-logs/x/0-tests.log' })),
    'fix:r1:a1': { applied: [{ id: 'G1-tests', what: 'w' }], rejected: [], head: 'cccc222' },
    'gates:r1:a1': gatesAt('cccc222'),
  }, 2)
  const [sent] = sentTo(calls, 'fix:r1:a1')
  assert.deepEqual([sent.id, sent.source, sent.severity], ['G1-tests', 'gates', 'major'])
  assert.match(sent.problem, /RED 1/)
  assert.match(sent.problem, /\/run\/gate-logs\/x\/0-tests\.log/)
})

// The writers' one gate rule: the runner at tier fast before each commit, then commit as is; no fast gate, no word on gates.
const marked = (a, b) => ({ profile: withProfile({ gates: [Object.assign({ name: 'A', command: 'make a' }, a !== undefined && { tier: a ? 'fast' : 'round' }),
  Object.assign({ name: 'B', command: 'make b' }, b !== undefined && { tier: b ? 'fast' : 'round' })] }).profile, baseline: twoGates.baseline })
const fixed = { 'review:r1:code': { verdict: 'findings', findings: [finding('major', 'a.js:1', 't')], checked: [row('x')] },
  'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], head: 'cccc222' }, 'gates:r2': gatesAt('cccc222', gate('A', 'green', 'a'), gate('B', 'green', 'b')) }
const AB = { 'gates:r1': gatesAt('bbbb111', gate('A', 'green', 'a'), gate('B', 'green', 'b')) }

test('W108: with a fast gate, implement and fix run the runner at tier fast, uncached, before each commit and commit as is', async () => {
  const { calls, result } = await runCore(Object.assign({}, AB, fixed), 2, marked(true))
  assert.deepEqual(result.gates, [{ name: 'A', command: 'make a', tier: 'fast' }, { name: 'B', command: 'make b' }])
  const runner = `node /t/.claude/workflows/red-green/skills/run_gates.mjs --gates '${JSON.stringify([{ name: 'A', command: 'make a', tier: 'fast' }])}' --dir /run --repo /r --tier fast --no-cache`
  for (const label of ['implement', 'fix:r1']) {
    const text = prompt(calls, label)
    assert.ok(text.includes(runner), label)
    assert.match(text, /commit as is/, label)
    assert.doesNotMatch(text, /baseline|make b|revert/i, label)
    assert.doesNotMatch(text, /Commit only|even with a gate/, label)
  }
})

test('W109: with no fast gate, implement and fix prompts say nothing about gates', async () => {
  const { calls } = await runCore(Object.assign({}, AB, fixed), 2, marked(false))
  for (const label of ['implement', 'fix:r1']) assert.doesNotMatch(prompt(calls, label), /\bgates?\b|baseline|run_gates/i, label)
})

test('W110: a check row with a test takes an optional red; one without moves to unverified, and stays a tested check', async () => {
  const props = (await runCore()).calls.find(c => c.label === 'implement').opts.schema.properties
  assert.equal(props.checks.items.properties.red.type, 'string')
  assert.ok(!props.checks.items.required.includes('red'))
  const implement = Object.assign({}, base().implement, { checks: [check('C1', { red: undefined })] })
  const { result, calls } = await runCore({ implement })
  assert.deepEqual(result.unverified, ['C1: test t reported no red line'])
  assert.equal(result.status, 'done_unverified')
  assert.deepEqual((await runCore()).result.unverified, [])
  assert.match(prompt(calls, 'implement'), /`red`/)
})

test('W111: implement defaults to haiku, high; fix to sonnet, high, whatever implement is set to', async () => {
  const opts = (calls, l) => { const c = calls.find(x => x.label === l); return [c.opts.model, c.opts.effort] }
  const fixes = { 'review:r1:code': major, 'fix:r1': { applied: [], rejected: [{ id: 'R1-code-1', argument: 'a' }], proofs: [], head: 'cccc222' } }
  const plain = await runCore(fixes, 2)
  assert.deepEqual(opts(plain.calls, 'implement'), ['haiku', 'high'])
  assert.deepEqual(opts(plain.calls, 'fix:r1'), ['sonnet', 'high'])
  const moved = await runCore(fixes, 2, withBlocks({ implement: { model: 'opus' } }))
  assert.deepEqual(opts(moved.calls, 'fix:r1'), ['sonnet', 'high'])
})

test('W118: the presets table: standard is the defaults, hard is sonnet on implement and fix, cheap stays', async () => {
  const doc = readFileSync(new URL('../../../docs/red-green/args-and-profile.md', import.meta.url), 'utf8')
  const preset = name => JSON.parse(doc.split('\n').find(l => l.startsWith(`| ${name} |`)).match(/`(\{.*\})`/)[1])
  assert.deepEqual(preset('standard'), {})
  assert.deepEqual(preset('hard'), { implement: { model: 'sonnet' }, fix: { model: 'sonnet' } })
  assert.deepEqual(preset('cheap'), { research: { model: 'sonnet' }, plan: { model: 'opus' }, implement: { model: 'haiku' }, fix: { model: 'haiku' } })
  const fixes = { 'review:r1:code': major, 'fix:r1': { applied: [], rejected: [{ id: 'R1-code-1', argument: 'a' }], proofs: [], head: 'cccc222' } }
  const { calls } = await runCore(fixes, 2, withBlocks(preset('hard')))
  for (const label of ['implement', 'fix:r1']) assert.equal(calls.find(c => c.label === label).opts.model, 'sonnet', label)
})

test('W50: a not_run row or a missing row gets one retry of the stage, whose rows are the result', async () => {
  const { result, calls } = await runCore({
    'gates:r1': gatesAt('bbbb111', gate('A', 'not_run', 'unfinished')),
    'gates:r1:retry': gatesAt('bbbb111', gate('A', 'green', 'a'), gate('B', 'green', 'b')),
  }, 1, twoGates)
  assert.deepEqual(calls.filter(c => c.label.startsWith('gates:')).map(c => c.label), ['gates:r1', 'gates:r1:retry'])
  assert.deepEqual(result.rounds[0].gates, [gate('A', 'green', 'a'), gate('B', 'green', 'b')])
  assert.deepEqual(result.failures, [])
  assert.equal(result.status, 'done')
})

test('W117: still no result after the retry: one failures entry naming the gates, no finding, no fix, and the round can be clean', async () => {
  const { result, calls } = await runCore({
    'gates:r1': gatesAt('bbbb111', gate('A', 'not_run', 'unfinished'), gate('B', 'green', 'b')),
    'gates:r1:retry': gatesAt('bbbb111', gate('A', 'not_run', 'STILL-UNFINISHED'), gate('B', 'green', 'b')),
  }, 1, twoGates)
  assert.ok(!called(calls, 'fix:r1'))
  assert.equal(result.leftover_findings.filter(f => f.source === 'gates').length, 0)
  assert.equal(result.failures.filter(f => /gates/.test(f)).length, 1)
  assert.match(result.failures.find(f => /gates/.test(f)), /A: STILL-UNFINISHED/)
  assert.equal(result.status, 'done_with_failures')
  assert.ok(called(calls, 'review:r1:code'))
})

test('W119: a gates step dead twice is one failure, not a finding per gate; a retry that dies keeps the first answer', async () => {
  const { result } = await runCore({ 'gates:r1': null, 'gates:r1:retry': null }, 1, twoGates)
  assert.equal(result.failures.filter(f => /gates gates:r1/.test(f)).length, 1)
  assert.equal(result.leftover_findings.filter(f => f.source === 'gates').length, 0)
  const kept = await runCore({ 'gates:r1': gatesAt('bbbb111', gate('A', 'red', 'RED'), gate('B', 'not_run', 'x')), 'gates:r1:retry': null,
    'fix:r1': { applied: [], rejected: [{ id: 'G1-A', argument: 'a' }], head: 'bbbb111' },
    'gates:r2': gatesAt('bbbb111', gate('A', 'red', 'RED'), gate('B', 'green', 'b')) }, 2, twoNoAttempts)
  assert.deepEqual(kept.result.rounds[0].gates.map(r => r.status), ['red', 'not_run'])
  assert.ok(called(kept.calls, 'fix:r1'))
})

test('W51: a declared gate without a status and line in the baseline fails the run before any agent is called', async () => {
  for (const B of [undefined, 'a line', { status: 'green' }, { line: 'l' }]) {
    const { result, calls } = await runCore({}, 1, { profile: twoGates.profile, baseline: { A: measured('a'), ...(B && { B }) } })
    assert.equal(calls.length, 0)
    assert.equal(result.status, 'failed')
    assert.match(result.note, /\bB\b/)
    assert.ok(!/\bA\b/.test(result.note.replace(/baseline/g, '')))
  }
})

test('W52: the result records per iteration the gates rows that gated its HEAD', async () => {
  const { result } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], head: 'cccc222' },
    'gates:r2': gatesAt('cccc222', gate('tests', 'green', 'NEXT 17 of 17')),
  }, 2)
  assert.deepEqual(result.rounds[0].gates, [gate('tests', 'green', '17 of 17')])
  assert.deepEqual(result.rounds[1].gates, [gate('tests', 'green', 'NEXT 17 of 17')])
})

test('W15: a fix that leaves HEAD alone reuses the gates result', async () => {
  const { calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [], rejected: [{ id: 'R1-code-1', argument: 'a' }], head: 'bbbb111' },
  }, 2)
  assert.ok(called(calls, 'review:r2:code'))
  assert.ok(!called(calls, 'gates:r2'))
})

test('W27: a dead fix ends the loop before the next step', async () => {
  const { calls } = await runCore({ 'review:r1:code': major, 'fix:r1': null }, 2)
  assert.ok(!called(calls, 'gates:r2'))
})

test('W07: a lens major without a trigger becomes a minor and is not fixed', async () => {
  const { result, calls } = await runCore({
    'review:r1:code': { verdict: 'findings', checked: [row('x')], findings: [finding('major', 'x.js:1', '')] },
  })
  const hit = result.advisory.filter(f => fileOf(f) === 'x.js:1')
  assert.equal(hit.length, 1)
  assert.equal(hit[0].severity, 'minor')
  assert.equal(hit[0].downgraded, true)
  assert.ok(!called(calls, 'fix:r1'))
  assert.deepEqual(result.leftover_findings, [])
})

test('W08: a lens with three minors keeps the first two', async () => {
  const { result } = await runCore({
    'review:r1:code': { verdict: 'findings', checked: [row('x')], findings: ['m1', 'm2', 'm3'].map(w => finding('minor', w, 't')) },
  })
  assert.equal(result.advisory.filter(f => f.source === 'code').length, 2)
  assert.deepEqual(result.advisory.map(fileOf).sort(), ['m1', 'm2'])
})

test('W09: an unmet requirement goes to fix as a major; unmet and unrowed ones end in the leftover', async () => {
  const requirements = { research: Object.assign({}, base().research, { requirements: ['R1: one', 'R2: two', 'R3: three'], test_harness: [harness('R1'), harness('R2', 'review'), harness('R3', 'review')] }) }
  const unmet = { verdict: 'findings', findings: [], checked: [row('R1', { status: 'met' }), row('R2', { status: 'unmet', promise: 'p', counterexample: 'c', evidence: 'clause x fails' })] }
  const { calls } = await runCore(Object.assign({ 'review:r1:checklist': unmet, 'fix:r1': { applied: [{ id: 'R1-R2', what: 'w' }], rejected: [], head: 'cccc222' } }, requirements), 2)
  assert.match(prompt(calls, 'fix:r1'), /R1-R2/)
  const { result } = await runCore(Object.assign({ 'review:r1:checklist': unmet }, requirements))
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

test('W18: a dead gates step is a failure', async () => {
  const deadGates = await runCore({ 'gates:r1': null, 'gates:r1:retry': null })
  assert.equal(deadGates.result.status, 'done_with_failures')
})

test('W19: an id-only rejection is accepted once the next review does not raise it; only the last iteration\'s red gate is left over', async () => {
  const { result } = await runCore({
    'gates:r1': gatesAt('bbbb111', gate('tests', 'red', 'RED 1')),
    'fix:r1': { applied: [], rejected: [{ id: 'G1-tests', argument: 'a' }, { id: 'Z1', argument: 'a' }], head: 'cccc222' },
    'gates:r2': gatesAt('cccc222', gate('tests', 'red', 'RED 2')),
  }, 2, noAttempts)
  assert.equal(withIds(result.leftover_findings, 'Z1').length, 0)
  assert.deepEqual(result.leftover_findings.filter(f => f.source === 'gates').map(f => f.id), ['G2-tests'])
})

test('W23: a run reviews every round with both lenses', async () => {
  const major = { verdict: 'findings', checked: [row('x')], findings: [finding('major', 'a:1', 't')] }
  const keep = { applied: [], rejected: [{ id: 'x', argument: 'a' }], head: 'bbbb111' }
  const { calls } = await runCore({
    'review:r1:code': major, 'fix:r1': keep,
    'review:r2:code': major, 'fix:r2': keep,
    'review:r3:checklist': clean([row('R1', { status: 'met' })]), 'review:r3:code': clean([row('x')]),
  }, 3)
  assert.ok(called(calls, 'review:r3:checklist'))
  assert.ok(called(calls, 'review:r3:code'))
})

test('W32: with default rounds a run plans three iterations, reviews two in full with both lenses', async () => {
  const { result, calls } = await runCore({}, 'default')
  assert.equal(result.rounds_planned, 3)
  assert.ok(called(calls, 'plan') && called(calls, 'review:r2:checklist') && called(calls, 'review:r2:code'))
  assert.match(prompt(calls, 'review:r1:code'), /Start from the change-site facts/)
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

test('W36b: a note shown by a command other than one repository search is dropped and listed', async () => {
  const { result, calls } = await runCore({
    research: research({ requirements: ['R1: one', 'R2: two', 'R3: three'], test_harness: [harness('R1'), harness('R2', 'review'), harness('R3', 'review')],
      facts: [fact('note', '$ git grep -n x', 'R1'), fact('note', '$ command -v uv', 'R2'), fact('note', '$ rg x; find / -name y', 'R3')] }),
  })
  assert.deepEqual(researchIn(prompt(calls, 'plan')).facts.map(f => f.fact), ['FACT-R1'])
  assert.deepEqual(result.dropped_facts.map(f => f.fact), ['FACT-R2', 'FACT-R3'])
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
  for (const s of ['COMMITS', 'run_in_background', 'or commit']) {
    assert.ok(!research.prompt.includes(s), s)
    assert.ok(prompt(calls, 'implement').includes(s), s)
  }
  for (const c of calls) assert.ok(!c.prompt.includes('research.md'), c.label)
})

test('W57: severity is major|minor, and no review prompt or round counter mentions blocker', async () => {
  const { result, calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], head: 'cccc222' },
  }, 2)
  const reviews = calls.filter(c => c.label.startsWith('review:'))
  assert.deepEqual(reviews.map(c => c.label).sort(), ['review:r1:checklist', 'review:r1:code', 'review:r2:checklist', 'review:r2:code'])
  for (const c of reviews) assert.ok(!/blocker/i.test(c.prompt), c.label)
  assert.deepEqual(calls.find(c => c.label === 'review:r1:code').opts.schema.properties.findings.items.properties.severity.enum, ['major', 'minor'])
  assert.ok(!('blocker' in result.rounds[0]))
})

test('W58: no rulings: a rejected finding reaches the next lens prompt in EARLIER FINDINGS with its argument', async () => {
  const { result, calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [], rejected: [{ id: 'R1-code-1', argument: 'ARGUMENT-TEXT' }], head: 'bbbb111' },
  }, 2)
  for (const l of ['review:r1:checklist', 'review:r1:code']) assert.ok(!('rulings' in calls.find(c => c.label === l).opts.schema.properties), l)
  const second = prompt(calls, 'review:r2:code')
  const past = JSON.parse(second.split('EARLIER FINDINGS')[1].split('\n')[1])
  assert.deepEqual(past, [{ id: 'R1-code-1', round: 1, where: { file: 'a:1', symbol: 'S' }, problem: 'p', outcome: 'rejected', argument: 'ARGUMENT-TEXT' }])
  assert.match(second, /re-raise a rejected one only as a finding whose `problem` answers its `argument`/)
  assert.ok(!/REJECTED|insist/.test(second))
  assert.ok(!('accepted_rejections' in result))
})

test('W59: lenses get the no-code preamble; the code lens may write proofs', async () => {
  const { calls } = await runCore({}, 2)
  // gates:r1 has the no-code preamble and, like the reviews, a notes field.
  const pre = prompt(calls, 'gates:r1').split('\n\nSTAGE:')[0]
  for (const l of ['review:r1:checklist', 'review:r1:code']) {
    const p = prompt(calls, l)
    assert.ok(p.startsWith(`${pre}\n\nSTAGE:`), l)
    for (const s of ['COMMITS', 'Gates:', 'or commit']) assert.ok(!p.includes(s), `${l}: ${s}`)
    assert.match(p, /read it at start and before returning, and follow its header/, l)
  }
  assert.match(prompt(calls, 'review:r1:code'), /written as a new, uncommitted file in the repository's test directory/)
  assert.ok(!/uncommitted file/.test(prompt(calls, 'review:r1:checklist')))
})

test('W60: the checklist lens starts from no code-review skill, and review_command has no effect', async () => {
  const plain = prompt((await runCore({})).calls, 'review:r1:checklist')
  assert.ok(!/code-review|Skill tool|starting pass/.test(plain))
  assert.equal(prompt((await runCore({}, 1, { review_command: 'REVIEW-CMD' })).calls, 'review:r1:checklist'), plain)
})

const proof = { path: 'tests/proof_a.test.js', command: 'npm test -- proof_a', red: 'FAIL proof_a: expected 1, got 2' }
const proven = { verdict: 'findings', checked: [row('x')], findings: [Object.assign(finding('major', 'a:1', 't'), { proof })] }

test('W61: a code-lens proof reaches the fix with its rules; a proof on a checklist finding is not sent and is a stray', async () => {
  const { result, calls } = await runCore({
    'review:r1:code': proven,
    'review:r1:checklist': { verdict: 'findings', checked: [row('R1', { status: 'met' })], findings: [Object.assign(finding('major', 'b:1', 't'), { proof: Object.assign({}, proof, { path: 'tests/other.js' }) })] },
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }, { id: 'R1-checklist-1', what: 'w' }], rejected: [], proofs: [{ id: 'R1-code-1', path: proof.path, outcome: 'rewritten' }], head: 'cccc222' },
  }, 2)
  const call = calls.find(c => c.label === 'fix:r1')
  const sent = sentTo(calls, 'fix:r1')
  assert.deepEqual(sent.find(f => f.id === 'R1-code-1').proof, proof)
  assert.ok(!('proof' in sent.find(f => f.id === 'R1-checklist-1')))
  assert.match(call.prompt, /run its `command` first/)
  assert.match(call.prompt, /green on HEAD is a valid rejection/i)
  assert.match(call.prompt, /rejected only with an argument against the test/)
  assert.match(call.prompt, /rewrite it into the suite in its style and commit it, or delete it/)
  assert.deepEqual(call.opts.schema.properties.proofs.items.properties.outcome.enum, ['rewritten', 'deleted'])
  assert.deepEqual(result.stray_proofs, [{ id: 'R1-checklist-1', path: 'tests/other.js' }])
})

test('W63: the fix accounts for a proof by its id even when it spells the path differently', async () => {
  const { result } = await runCore({
    'review:r1:code': proven,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], proofs: [{ id: 'R1-code-1', path: `./${proof.path}`, outcome: 'deleted' }], head: 'cccc222' },
  }, 2)
  assert.deepEqual(result.stray_proofs, [])
  assert.equal(result.status, 'done')
})

test('W62: a proof the fix does not account for, or whose fix died, is a stray and a failure', async () => {
  const omitted = await runCore({
    'review:r1:code': proven,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], proofs: [], head: 'cccc222' },
  }, 2)
  assert.deepEqual(omitted.result.stray_proofs, [{ id: 'R1-code-1', path: proof.path }])
  assert.equal(omitted.result.failures.filter(f => f.includes(proof.path)).length, 1)
  assert.equal(omitted.result.status, 'done_with_failures')
  const dead = await runCore({ 'review:r1:code': proven, 'fix:r1': null }, 2)
  assert.deepEqual(dead.result.stray_proofs, [{ id: 'R1-code-1', path: proof.path }])
  assert.equal(dead.result.failures.filter(f => f.includes(proof.path)).length, 1)
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
  assert.match(checklist, /For each requirement id — R1, R2, R3, R5 —/)
  assert.ok(checklist.includes(JSON.stringify(['R2: two', 'R3: three', 'R5: five'])))
  assert.ok(!/R4/.test(checklist.split('RESEARCH:')[0]))
  assert.deepEqual(result.verify_launch, [{ requirement: 'R4: four', how: 'LAUNCH-HOW' }])
  assert.deepEqual(result.verify_review, ['R2: two', 'R3: three', 'R5: five'])
  assert.deepEqual(result.leftover_findings.filter(f => f.id === 'R4'), [])
  assert.ok(!('unlisted_cases' in result))
})

test('W41: a case returned with an id reaches the implement prompt and the result with the full requirement line', async () => {
  const { result, calls } = await runCore({ implement: null, 'implement:retry': null })
  assert.match(prompt(calls, 'implement'), /"requirement":"R1: one"/)
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
  assert.match(prompt(calls, 'replan'), /keep each in one case\. Each `check` reads `arrange \| act \| assert`: \[\{"check":"a \| a \| x","cases":\["C1","C2"\]\}\]\. Keep every other case/)
  assert.ok(!/uncovered/.test(prompt(calls, 'replan')))
})

test('W134: the reason for a replan is logged before the call: uncovered ids and the duplicated checks\' case ids', async () => {
  const c = base().plan.cases[0]
  const { calls } = await runCore({
    research: research({ requirements: ['R1: one', 'R2: two'], test_harness: [harness('R1'), harness('R2')] }),
    plan: { cases: [c, Object.assign({}, c, { id: 'C2' })] }, replan: base().plan,
  })
  assert.equal(calls.find(k => k.label === 'replan').logged.at(-1), 'plan: replan: uncovered R2; duplicate checks in C1, C2')
  const dupOnly = await runCore({ plan: { cases: [c, Object.assign({}, c, { id: 'C2' })] }, replan: base().plan })
  assert.equal(dupOnly.calls.find(k => k.label === 'replan').logged.at(-1), 'plan: replan: uncovered none; duplicate checks in C1, C2')
})

// The one limit on what gets tested, as plan's rules and the code lens's default state it.
const LIMIT = 'Test only requirement behaviour, an invariant, a boundary, an error or a regression. Never test doc or message wording, a constant, private structure, the framework itself, a getter, or whether a mock was called; assert an exact message only when a requirement names that message.'

test('W135: plan, replan and the code lens hold the same limit on tests; the lens makes a banned test a major triggered by the test', async () => {
  const c = base().plan.cases[0]
  const { calls } = await runCore({ plan: { cases: [c, Object.assign({}, c, { id: 'C2' })] }, replan: base().plan })
  for (const label of ['plan', 'replan', 'review:r1:code']) assert.ok(prompt(calls, label).includes(LIMIT), label)
  assert.ok(prompt(calls, 'review:r1:code').includes(`${LIMIT} A test in the diff that breaks this is a major whose \`trigger\` is that test.`))
  assert.ok(!prompt(calls, 'review:r1:checklist').includes(LIMIT))
})

// A property case: the base case with a property over the given fields.
const propertyCase = (id, over) => Object.assign({}, base().plan.cases[0], { id, asserts: [id], property: Object.assign({ id: `m.${id}`, statement: 'S', source: 'R1', domain: '{"int":[0,9]}', mut: ['0'] }, over) })
const withProperty = { plan: { cases: [propertyCase('C1')] } }

test('P01: a case has an optional property: id, statement of at most 255 characters, source, domain and mut, a list', async () => {
  const { calls } = await runCore()
  const item = calls.find(c => c.label === 'plan').opts.schema.properties.cases.items
  assert.ok(!item.required.includes('property'))
  const p = item.properties.property
  assert.deepEqual(p.required, ['id', 'statement', 'source', 'domain', 'mut'])
  assert.equal(p.properties.statement.maxLength, 255)
  assert.deepEqual(p.properties.mut, { type: 'array', items: { type: 'string' } })
})

test('P02: plan and replan hold the property rule; with no framework the runner\'s domain language, with one its name', async () => {
  const c = base().plan.cases[0]
  const dup = { plan: { cases: [c, Object.assign({}, c, { id: 'C2' })] }, replan: base().plan }
  const runner = await runCore(dup)
  const framework = await runCore(dup, 1, withBlocks({ implement: { property_framework: 'fast-check' } }))
  for (const label of ['plan', 'replan']) {
    for (const { calls } of [runner, framework]) {
      const p = prompt(calls, label)
      assert.match(p, /a claim over a domain too large to enumerate gets a property case; a small finite domain is one case asserting a table of literal rows\./, label)
      assert.match(p, /the one-Act and single-literal rules are for the other cases\./, label)
      assert.match(p, /may go through a lower one, saying so in its Act; a literal case keeps the named seam\./, label)
    }
    assert.match(prompt(runner.calls, label), / \(JSON in the runner's language, one of \{"int":\[lo,hi\]\}.*\{"record":\{"<name>":<domain>,...\}\}.*; a claim over inputs it cannot state, such as objects, callbacks or state, stays a literal case\), `mut`/, label)
    assert.ok(!prompt(runner.calls, label).includes('fast-check'), label)
    assert.match(prompt(framework.calls, label), /covers \(in fast-check's terms\), `mut`/, label)
    assert.ok(!prompt(framework.calls, label).includes('"int"'), label)
  }
})

test('P03: a property source other than a requirement id or a listed fact\'s where, or a statement over 255, joins the one replan', async () => {
  const facts = [fact('code', ['src/a.cpp:1-2', 'src/b.cpp:3'], 'R1'), fact('note', 'docs/x.md § Y', 'R1')]
  const cases = [propertyCase('C1'), propertyCase('C2', { source: 'src/b.cpp:3', statement: 'x'.repeat(255) }), propertyCase('C3', { source: 'docs/x.md § Y' }),
    propertyCase('C4', { source: 'plan step 1' }), propertyCase('C5', { statement: 'x'.repeat(256) })]
  const { calls } = await runCore({ research: research({ facts }), plan: { cases }, replan: { cases: cases.slice(0, 3) } })
  assert.equal(count(calls, 'replan'), 1)
  const p = prompt(calls, 'replan')
  assert.ok(p.includes('These property cases fail their checks: C4: source "plan step 1" is neither a requirement id nor a listed fact\'s `where`; C5: statement over 255 characters: split it into flat contracts sharing an id prefix, one case each.'), p)
  assert.ok(!/C[123]: /.test(p.split('These property cases')[1].split('.')[0]))
  assert.match(calls.find(k => k.label === 'replan').logged.at(-1), /; property cases failing their checks: C4, C5$/)
  const ok = await runCore({ research: research({ facts }), plan: { cases: cases.slice(0, 3) } })
  assert.ok(!called(ok.calls, 'replan'))
})

test('P04: a property case still failing its checks after the replan is dropped, and what it leaves uncovered is reported', async () => {
  const bad = propertyCase('C2', { source: 'nowhere' })
  const { result, calls } = await runCore({
    research: research({ requirements: ['R1: one', 'R2: two'], test_harness: [harness('R1'), harness('R2')] }),
    plan: { cases: [base().plan.cases[0], Object.assign({}, bad, { requirement: 'R2' })] }, replan: { cases: [base().plan.cases[0], Object.assign({}, bad, { requirement: 'R2' })] },
  })
  assert.deepEqual(JSON.parse(prompt(calls, 'implement').split('CASES:\n')[1].split('\n')[0]).map(c => c.id), ['C1'])
  assert.match(calls.find(k => k.label === 'implement').logged.join('\n'), /plan: dropped C2: source "nowhere"/)
  assert.deepEqual(result.uncovered_requirements, ['R2'])
})

test('P10: a property id outside the marker form, an empty mut, a statement with a newline or a domain the runner rejects joins the replan, then is dropped', async () => {
  const cases = [propertyCase('C1', { statement: '😀'.repeat(255) }), propertyCase('C2', { id: 'm.a b' }), propertyCase('C3', { mut: [] }),
    propertyCase('C4', { statement: 'a\nb' }), propertyCase('C5', { domain: '{"int":[2,1]}' }), propertyCase('C6', { domain: '{"int":[0,' })]
  const { calls } = await runCore({ plan: { cases }, replan: { cases } })
  const p = prompt(calls, 'replan').split('These property cases fail their checks: ')[1].split('\n')[0]
  for (const s of ['C2: id "m.a b" is not a contract id, dot-separated segments of letters, digits, _ and -', 'C3: mut is empty',
    'C4: statement holds a line break; a marker is one line', 'C5: domain "{\\"int\\":[2,1]}" is one the runner rejects: want [lo, hi]', 'C6: domain "{\\"int\\":[0," is one the runner rejects: '])
    assert.ok(p.includes(s), `${s}\n${p}`)
  assert.ok(!p.includes('C1: '), p)
  assert.deepEqual(JSON.parse(prompt(calls, 'implement').split('CASES:\n')[1].split('\n')[0]).map(c => c.id), ['C1'])
  const framework = await runCore({ plan: { cases: [propertyCase('C1', { domain: 'fc.integer()' })] } }, 1, withBlocks({ implement: { property_framework: 'fast-check' } }))
  assert.ok(!called(framework.calls, 'replan'), 'a framework domain is in its own terms')
})

test('P05: with a property case and no framework, implement gets the marker, domain line and the runner\'s test-side protocol; with none, no property rule', async () => {
  const { calls } = await runCore(withProperty)
  const p = prompt(calls, 'implement')
  for (const s of ['`contract: <id>: <statement>`', 'checks that the property rejects each `mut` on the generated inputs, and prints each example before running it.',
    'the marker\'s next line is `domain: <domain>`', '`$PROPERTY_DIR/<id>.json`', 'does nothing when the file is absent', 'each printed line is `property: <id> <index>`, flushed', '`$PROPERTY_DIR/<id>.failed`'])
    assert.ok(p.includes(s), s)
  assert.ok(!/PROPERTY_SEED/.test(p))
  assert.ok(!/PROPERTY|contract: </.test(prompt((await runCore()).calls, 'implement')))
})

test('P11: with no framework, implement\'s runner note shows each property case\'s own domain by its least example, sized by the domain\'s minimums', async () => {
  const cases = [propertyCase('C1', { domain: '{"record":{"a":{"int":[3,9]},"b":{"bytes":[2,100000]}}}' }), propertyCase('C2', { domain: '{"tuple":[{"string":[1,9],"chars":"xy"},{"const":true}]}' })]
  const p = prompt((await runCore({ plan: { cases } })).calls, 'implement')
  assert.ok(p.includes('when the file is absent; one example of each case\'s domain: `m.C1` {"a":3,"b":[0,0]}, `m.C2` ["x",true]; each printed line'), p)
  assert.ok(!/one example of/.test(prompt((await runCore()).calls, 'implement')))
  const framework = { plan: { cases: [propertyCase('C1', { domain: 'fc.integer()' })] } }
  assert.ok(!/one example of/.test(prompt((await runCore(framework, 1, withBlocks({ implement: { property_framework: 'fast-check' } }))).calls, 'implement')))
})

test('P06: with a declared framework, implement writes the property in it, reading the seed and examples variables with their defaults', async () => {
  const { calls } = await runCore(withProperty, 1, withBlocks({ implement: { property_framework: 'fast-check', property_examples: 30 } }))
  const p = prompt(calls, 'implement')
  assert.ok(p.includes('Write it in fast-check\'s own idiom, seeded from `PROPERTY_SEED` (1 when unset) with `PROPERTY_EXAMPLES` examples (30 when unset).'), p)
  assert.ok(p.includes('`contract: <id>: <statement>`'))
  assert.ok(!/PROPERTY_DIR|domain: </.test(p))
  const byDefault = await runCore(withProperty, 1, withBlocks({ implement: { property_framework: 'fast-check' } }))
  assert.match(prompt(byDefault.calls, 'implement'), /`PROPERTY_EXAMPLES` examples \(100 when unset\)/)
})

test('P07: a property case\'s check row names its contract id', async () => {
  const { result } = await runCore(withProperty)
  assert.equal(result.implement.checks[0].contract, 'm.C1')
  assert.ok(!('contract' in (await runCore()).result.implement.checks[0]))
})

test('P08: with property cases, the code lens raises a property test lacking its wrong-output check as a major', async () => {
  const RULE = 'A property test (one with a `contract:` marker) lacking the check that its property rejects each named wrong output is a major whose `trigger` is that test.'
  const { calls } = await runCore(withProperty)
  assert.ok(prompt(calls, 'review:r1:code').includes(RULE))
  assert.ok(!prompt(calls, 'review:r1:checklist').includes(RULE))
  assert.ok(!prompt((await runCore()).calls, 'review:r1:code').includes('property test'))
})

test('P09: blocks.implement.property_framework is a string or null and property_examples an integer, else the run fails on config', async () => {
  for (const [field, value] of [['property_framework', 3], ['property_examples', 'many']]) {
    const { result, calls } = await runCore({}, 1, withBlocks({ implement: { [field]: value } }))
    assert.equal(calls.length, 0, field)
    assert.equal(result.stage, 'config', field)
    assert.match(result.note, new RegExp(`blocks\\.implement\\.${field}`), field)
  }
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
    for (const s of ['COMMITS', 'Gates:', 'run_in_background', 'Over-built', 'or commit']) assert.ok(!p.includes(s), `${label}: ${s}`)
    assert.match(p, /read it at start and before returning, and follow its header/, label)
  }
})

test('W53: no declared gates, an empty list or no fast or round gate fail on config before any agent', async () => {
  for (const gates of [null, [], [{ name: 'H', command: 'heavy', tier: 'acceptance' }]]) {
    const { result, calls } = await runCore({}, 1, Object.assign(withProfile({ gates }), { baseline: {} }))
    assert.equal(calls.length, 0)
    assert.equal(result.stage, 'config')
    assert.match(result.note, /no fast or round gate/)
  }
})

test('W54: a bad tier fails on config, and a gate\'s fast fails naming tier', async () => {
  const run = g => runCore({}, 1, withProfile({ gates: [g] }))
  const bad = await run({ name: 'tests', command: 'c', tier: 'nightly' })
  assert.equal(bad.result.stage, 'config')
  assert.match(bad.result.note, /tests: tier nightly is not fast, round or acceptance/)
  for (const fast of [true, false]) {
    const { result, calls } = await run({ name: 'tests', command: 'c', fast })
    assert.equal(calls.length, 0)
    assert.equal(result.stage, 'config')
    assert.match(result.note, /tests: fast moved to tier/)
  }
})

test('W55: the result carries the declared gates and no gates_questions; a removed discovery stage is never called', async () => {
  const { result, calls } = await runCore({})
  assert.ok(!called(calls, 'gates:discover'))
  assert.deepEqual(result.gates, [{ name: 'tests', command: 'npm test' }])
  assert.ok(!('gates_questions' in result))
})

test('W56: a gate named like an Object.prototype key still needs its own baseline entry', async () => {
  const { result, calls } = await runCore({}, 1, Object.assign(withProfile({ gates: [{ name: 'constructor', command: 'c' }] }), { baseline: {} }))
  assert.equal(calls.length, 0)
  assert.equal(result.status, 'failed')
})

test('W65: every review stage is read-only and may make one targeted run; no empty or project text', async () => {
  const { calls } = await runCore({}, 2)
  for (const l of ['review:r1:checklist', 'review:r1:code', 'review:r2:code']) {
    assert.match(prompt(calls, l), /Read-only: change and commit nothing in \/r\./, l)
    assert.match(prompt(calls, l), /At most one targeted run of the changed path/, l)
  }
  const checklist = prompt(calls, 'review:r1:checklist')
  assert.ok(!/\[\]/.test(checklist.split('RESEARCH:')[0]))
  assert.match(prompt(calls, 'review:r1:code'), /implement\.md § Code rules/)
})

test('W67: the checklist lens takes the statement as each id\'s promise and needs a counterexample row before met', async () => {
  const { calls } = await runCore({})
  const p = prompt(calls, 'review:r1:checklist')
  assert.match(p, /Review the change against its statement\. For each requirement id — R1 — the promise is the sentence of the statement it rests on/)
  assert.match(p, /`met` \(the counterexample was tried and the promise held\)/)
  for (const l of ['review:r1:checklist', 'review:r1:code']) assert.match(prompt(calls, l), /Compare against the statement \(\/t\.md and every document it points to, as written before the code\) and the research plan below\./, l)
  const rowSchema = calls.find(c => c.label === 'review:r1:checklist').opts.schema.properties.checked.items
  for (const k of ['promise', 'counterexample', 'status']) assert.ok(rowSchema.required.includes(k), k)
  assert.ok(!('promise' in calls.find(c => c.label === 'review:r1:code').opts.schema.properties.checked.items.properties))
})

test('W68: an unmet row reaches the fix with its promise as the problem and its counterexample as the trigger', async () => {
  const { calls } = await runCore({
    'review:r1:checklist': { verdict: 'findings', findings: [], checked: [row('R1', { status: 'unmet', promise: 'PROMISE-SENT', counterexample: 'COUNTER-SENT', evidence: 'EVIDENCE-SENT' })] },
    'fix:r1': { applied: [{ id: 'R1-R1', what: 'w' }], rejected: [], proofs: [], head: 'cccc222' },
  }, 2)
  const sent = sentTo(calls, 'fix:r1').find(f => f.id === 'R1-R1')
  assert.equal(sent.trigger, 'COUNTER-SENT')
  assert.match(sent.problem, /PROMISE-SENT.*EVIDENCE-SENT/)
  assert.ok(!/ticket/.test(sent.consequence))
})

test('W69: the implement schema asks for checks and questions, and no tests, committed, commits or gate_output', async () => {
  const { calls } = await runCore({})
  const props = calls.find(c => c.label === 'implement').opts.schema.properties
  for (const k of ['checks', 'questions']) assert.ok(k in props, k)
  for (const k of ['tests', 'committed', 'commits', 'gate_output']) assert.ok(!(k in props), k)
  assert.deepEqual(props.checks.items.properties.kind.enum, ['case', 'phrase'])
  assert.deepEqual(props.checks.items.anyOf, [{ required: ['test'] }, { required: ['unverified'] }])
  assert.deepEqual(props.questions.items.properties.settles.enum, ['owner', 'plan'])
  assert.match(prompt(calls, 'implement'), /each boundary it states — a limit, an empty input, a missing key, an error path, an exit code — and give each a phrase row/)
  assert.match(prompt(calls, 'implement'), /a phrase row is unverified only when this environment cannot run its test/)
})

test('W70: a case with no case row lands in unverified and the run is done_unverified; a phrase row does not stand for it', async () => {
  const implement = Object.assign({}, base().implement, { checks: [check('"C1"', { kind: 'phrase' })] })
  const { result } = await runCore({ implement })
  assert.deepEqual(result.unverified, ['case C1: no check reported'])
  assert.equal(result.status, 'done_unverified')
})

test('W71: an unverified row, case or phrase, lands in unverified and in the checklist lens prompt', async () => {
  const phrase = check('"an empty list is rejected"', { kind: 'phrase', test: undefined, unverified: 'NO-HARNESS' })
  const implement = Object.assign({}, base().implement, { checks: [check('C1', { test: undefined, unverified: 'NO-TOOL' }), phrase], unverified: ['FREE-TEXT'] })
  const { result, calls } = await runCore({ implement })
  const want = ['FREE-TEXT', 'C1: NO-TOOL', '"an empty list is rejected": NO-HARNESS']
  assert.deepEqual(result.unverified, want)
  assert.ok(prompt(calls, 'review:r1:checklist').includes(JSON.stringify(want)))
  assert.equal(result.status, 'done_unverified')
})

test('W72: the result\'s implement entry is the checks and the notes', async () => {
  const implement = Object.assign({}, base().implement, { notes: 'NOTES' })
  const { result } = await runCore({ implement })
  assert.deepEqual(result.implement, { checks: [check('C1')], notes: 'NOTES' })
  assert.equal(result.status, 'done')
})

test('W73: implement questions with a known id reach implement_questions alone; one for an unknown id is dropped', async () => {
  const q = { requirement: 'R1', question: 'QUESTION-SENT', reading: 'the ticket\'s', settles: 'plan' }
  const implement = Object.assign({}, base().implement, { questions: [q, Object.assign({}, q, { requirement: 'R9' })] })
  const { result, calls } = await runCore({ implement })
  assert.deepEqual(result.implement_questions, [q])
  assert.ok(calls.filter(c => c.label !== 'implement').every(c => !c.prompt.includes('QUESTION-SENT')))
  assert.equal(result.status, 'done')
})

test('W74: HEAD still at base gets one retry told no commit was made, even with tested rows; HEAD moved gets none', async () => {
  const atBase = Object.assign({}, base().implement, { head: 'aaaa000', checks: [], notes: 'NOTES-SENT' })
  const { calls } = await runCore({ implement: atBase, 'implement:retry': base().implement })
  assert.equal(count(calls, 'implement:retry'), 1)
  assert.match(prompt(calls, 'implement:retry'), /A previous attempt at this stage made NO commit \(HEAD still aaaa000\); its notes: "NOTES-SENT"\./)
  const moved = await runCore({ implement: Object.assign({}, base().implement, { checks: [] }) })
  assert.ok(!called(moved.calls, 'implement:retry'))
  const twice = await runCore({ implement: atBase, 'implement:retry': atBase })
  assert.equal(twice.result.status, 'failed')
  // Work left uncommitted is committed by the retry, so review never reads an empty diff.
  const uncommitted = await runCore({ implement: Object.assign({}, base().implement, { head: 'aaaa000' }), 'implement:retry': base().implement })
  assert.equal(count(uncommitted.calls, 'implement:retry'), 1)
})

test('W75: the implement prompt asks for a question\'s requirement as its id', async () => {
  const { calls } = await runCore({})
  assert.match(prompt(calls, 'implement'), /questions \(requirement: its id;/)
  assert.equal(prompt(calls, 'implement').split('contradicts the ticket').length, 2, 'the plan-question rule has one source')
})

test('W76: implement and fix commit their work as it stands, a red gate going to the fix; one commit is created by implement', async () => {
  const { calls } = await runCore({ 'gates:r1': gatesAt('bbbb111', gate('tests', 'red', 'RED 1')),
    'fix:r1': { applied: [], rejected: [{ id: 'G1-tests', argument: 'tests still red' }], proofs: [], head: 'bbbb111' } }, 2, noAttempts)
  assert.match(prompt(calls, 'implement'), /Commit your work as it stands\./)
  assert.ok(!/Commit only with/.test(prompt(calls, 'implement')))
  assert.match(prompt(calls, 'fix:r1'), /Commit your work as it stands\./)
  const one = await runCore({}, 1, { one_commit: true })
  assert.match(prompt(one.calls, 'implement'), /The implementation stage creates it/)
  assert.ok(!/leave it uncommitted/.test(prompt(one.calls, 'implement')))
})

test('W82: the fix schema holds only what the script reads: no committed, no gate_output', async () => {
  const { calls } = await runCore({ 'review:r1:code': major, 'fix:r1': { applied: [], rejected: [{ id: 'R1-code-1', argument: 'a' }], proofs: [], head: 'bbbb111' } }, 2)
  const s = calls.find(c => c.label === 'fix:r1').opts.schema
  assert.deepEqual(Object.keys(s.properties), ['applied', 'rejected', 'proofs', 'head', 'mailbox'])
  assert.deepEqual(s.required, ['applied', 'rejected', 'proofs', 'head'])
})

test('W90: every fix output field is read by the script or reaches the result: emptying it changes the result', async () => {
  const lens = { verdict: 'findings', checked: [row('x')], findings: proven.findings.concat(finding('major', 'b:1', 't')) }
  const fix = { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [{ id: 'R1-code-2', argument: 'a' }], proofs: [{ id: 'R1-code-1', path: proof.path, outcome: 'deleted' }], head: 'cccc222' }
  const run = res => runCore({ 'review:r1:code': lens, 'fix:r1': res }, 2)
  const { result, calls } = await run(fix)
  const fields = calls.find(c => c.label === 'fix:r1').opts.schema.properties
  for (const k of Object.keys(fields).filter(k => k !== 'mailbox')) {
    const empty = { array: [], string: 'bbbb111' }[fields[k].type]
    const other = (await run(Object.assign({}, fix, { [k]: empty }))).result
    assert.notDeepEqual(other, result, k)
  }
})

test('W83: profile.blocks.<name>.model and effort override the defaults; a block with no model runs on the one it follows', async () => {
  const opts = (calls, l) => [calls.find(c => c.label === l).opts.model, calls.find(c => c.label === l).opts.effort]
  const run = { 'review:r1:code': major, 'fix:r1': { applied: [], rejected: [{ id: 'R1-code-1', argument: 'a' }], proofs: [], head: 'cccc222' } }
  const plain = (await runCore(run, 2)).calls
  const want = { research: ['opus', 'high'], plan: ['opus', 'high'], implement: ['haiku', 'high'], 'gates:r1': ['haiku', 'medium'], 'review:r1:code': ['opus', 'high'],
    'fix:r1': ['sonnet', 'high'] }
  for (const [l, w] of Object.entries(want)) assert.deepEqual(opts(plain, l), w, l)
  const { calls } = await runCore(run, 2, withBlocks({ research: { model: 'sonnet', effort: 'max' }, fix: { model: 'haiku' }, review: { effort: 'low' } }))
  assert.deepEqual(opts(calls, 'research'), ['sonnet', 'max'])
  assert.deepEqual(opts(calls, 'plan'), ['sonnet', 'high'])
  assert.deepEqual(opts(calls, 'fix:r1'), ['haiku', 'high'])
  assert.deepEqual(opts(calls, 'review:r1:code'), ['opus', 'low'])
})

test('W84: the review rounds and min rounds, and the minors cap come from the block config', async () => {
  const three = (await runCore({}, 3)).result
  assert.deepEqual([three.rounds_planned, three.rounds_run], [3, 2])
  const once = (await runCore({}, 3, withBlocks({ review: { min: 1 } }))).result
  assert.equal(once.rounds_run, 1)
  const minors = { verdict: 'findings', checked: [row('x')], findings: ['m1', 'm2', 'm3'].map(w => finding('minor', w, 't')) }
  const capped = await runCore({ 'review:r1:code': minors }, 1, withBlocks({ review: { minors: 1 } }))
  assert.deepEqual(capped.result.advisory.map(fileOf), ['m1'])
  assert.match(prompt(capped.calls, 'review:r1:code'), /report at most 1 minors/)
  assert.match(prompt((await runCore({})).calls, 'review:r1:code'), /report at most 2 minors/)
})

test('W85: a removed arg, or a block, field, duty or lens the config does not know, fails the run before any agent', async () => {
  for (const extra of [{ models: { fix: 'sonnet' } }, { rounds: 2 }, { extra_rounds: 1 }, { min_rounds: 1 },
    withBlocks({ reviews: {} }), withBlocks({ review: { round: 2 } }), withBlocks({ review: { duties: { probe: true } } }), withBlocks({ review: { lenses: ['mechanics'] } })]) {
    const { result, calls } = await runCore({}, 1, extra)
    assert.equal(calls.length, 0, JSON.stringify(extra))
    assert.equal(result.status, 'failed')
    assert.equal(result.stage, 'config')
  }
  const { result } = await runCore({}, 1, { rounds: 2 })
  assert.match(result.note, /args\.rounds.*profile\.blocks\.review\.rounds/)
})

// The validator on every agent schema of the core: per schema a valid sample, and per keyword the schema uses an
// invalid one. A schema's keywords are found by walking it, so a keyword without an invalid sample fails the test.
const keywordsOf = s => [...new Set(Object.keys(s).concat(Object.values(s.properties || {}).flatMap(keywordsOf),
  s.items ? keywordsOf(s.items) : [], (s.anyOf || []).flatMap(keywordsOf)))]
const edit = (v, fn) => { const c = clone(v); fn(c); return c }
const fullResearch = Object.assign({ questions: [] }, base().research)
const lensClean = clean([row('R1', { status: 'met', promise: 'p', counterexample: 'c' })])
const fixRes = { applied: [{ id: 'a', what: 'w' }], rejected: [], proofs: [], head: 'h' }
const common = () => ({ type: 'x', properties: { mailbox: [{ id: 'm', status: 'applied', why: 7 }] }, required: {}, items: { mailbox: ['x'] }, enum: { mailbox: [{ id: 'm', status: 'odd', why: 'w' }] } })
const SAMPLES = {
  research: [fullResearch, {
    pattern: edit(fullResearch, r => { r.requirements = ['one'] }),
    anyOf: edit(fullResearch, r => { r.facts[0].where = 5 }),
    minItems: edit(fullResearch, r => { r.facts[0].requirements = [] }),
    maxLength: edit(fullResearch, r => { r.plan = ['x'.repeat(601)] }),
    enum: edit(fullResearch, r => { r.facts[0].kind = 'guess' }),
    required: edit(fullResearch, r => { delete r.test_harness }),
  }],
  plan: [{ cases: base().plan.cases, questions: [] }, { required: { cases: [] }, enum: { cases: [Object.assign({}, base().plan.cases[0], { requirement: 'R9' })], questions: [] },
    maxLength: { cases: [Object.assign({}, base().plan.cases[0], { property: { id: 'm.p', statement: 'x'.repeat(256), source: 'R1', domain: '{}', mut: [] } })], questions: [] } }],
  implement: [base().implement, {
    anyOf: edit(base().implement, r => { delete r.checks[0].test }),
    enum: edit(base().implement, r => { r.checks[0].kind = 'other' }),
    required: edit(base().implement, r => { delete r.head }),
  }],
  'gates:r1': [gatesAt('h'), { enum: gatesAt('h', gate('tests', 'amber', 'l')), required: { gates: [] } }],
  'review:r1:checklist': [lensClean, { enum: clean([row('R1', { status: 'maybe', promise: 'p', counterexample: 'c' })]), required: clean([row('R1', { status: 'met' })]),
    pattern: edit(lensClean, r => { r.findings = [finding('major', ' ', 't')] }) }],
  'review:r1:code': [clean([row('x')]), { enum: { verdict: 'dirty', findings: [], checked: [] }, required: { verdict: 'clean', findings: [] },
    pattern: edit(clean([row('x')]), r => { r.findings = [finding('major', '', 't')] }) }],
  'fix:r1': [fixRes, { enum: edit(fixRes, r => { r.proofs = [{ id: 'a', path: 'p', outcome: 'kept' }] }), required: { applied: [], rejected: [], proofs: [] } }],
}

test('V01: every agent schema of the core takes its valid sample and rejects an invalid one per keyword it uses', async () => {
  const { calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], proofs: [], head: 'cccc222' },
  }, 2)
  for (const [label, [valid, own]] of Object.entries(SAMPLES)) {
    const schema = calls.find(c => c.label === label).opts.schema
    assert.deepEqual(validate(schema, valid), [], label)
    const invalid = Object.assign(common(), own)
    for (const k of keywordsOf(schema)) {
      assert.ok(k in invalid, `${label}: no invalid sample for ${k}`)
      assert.notDeepEqual(validate(schema, invalid[k]), [], `${label}: ${k}`)
    }
  }
})

test('V02: the validator throws on a keyword it does not support, wherever it sits in the schema', () => {
  assert.throws(() => validate({ type: 'string', format: 'date' }, 'x'), /unsupported schema keyword.*format/)
  const deep = { type: 'object', properties: { a: { type: 'array', items: { type: 'string', minLength: 1 } } } }
  assert.throws(() => validate(deep, {}), /unsupported schema keyword.*minLength/)
})

test('V03: the validator names the place of each error', () => {
  const s = { type: 'object', properties: { a: { type: 'array', items: { type: 'string', enum: ['x'] } } }, required: ['a', 'b'] }
  assert.deepEqual(validate(s, { a: ['x', 'y'] }), ['$: b missing', '$.a[1]: "y" not in ["x"]'])
  assert.deepEqual(validate({ type: 'integer' }, 2.5), ['$: number, not integer'])
})

test('V04: a value no anyOf branch takes gets the errors of the branch it comes closest to', () => {
  const finding = { type: 'object', properties: { id: { type: 'string' }, severity: { type: 'string', enum: ['major', 'minor'] }, problem: { type: 'string' } }, required: ['id', 'severity', 'problem'] }
  const group = { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 2 }, views: { type: 'array', items: finding } }, required: ['ids', 'views'] }
  const s = { type: 'array', items: { anyOf: [finding, group] } }
  assert.deepEqual(validate(s, [{ id: 'a', severity: 'blocker', problem: 'p' }]), ['$[0].severity: "blocker" not in ["major","minor"]'])
  assert.deepEqual(validate(s, [{ ids: ['a', 'b'], views: [{ id: 'a', severity: 'major' }] }]), ['$[0].views[0]: problem missing'])
  assert.deepEqual(validate({ anyOf: [{ type: 'string' }, { type: 'null' }] }, 3), ['$: number, not string'])
})

// A run that calls every block, each label once: replan, the implement retry, a fix with a minor, the next iteration.
const everyBlock = () => {
  const green = gatesAt('bbbb111', gate('lint', 'green', 'l'), gate('test', 'green', 't'))
  const late = { verdict: 'findings', checked: [row('x')], findings: [finding('major', 'b:1', 't'), finding('minor', 'c:1', 't')] }
  const met = clean(['R1', 'R2'].map(id => row(id, { status: 'met', promise: 'p', counterexample: 'c' })))
  return runCore({
    research: research({ requirements: ['R1: one', 'R2: two'], test_harness: [harness('R1'), harness('R2')] }),
    replan: base().plan,
    implement: Object.assign({}, base().implement, { head: 'aaaa000' }), 'implement:retry': base().implement,
    'gates:r1': green,
    'review:r1:checklist': met,
    'review:r1:code': late,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [{ id: 'R1-code-2', argument: 'a' }], proofs: [], head: 'cccc222' },
    'gates:r2': Object.assign({}, green, { head: 'cccc222' }),
    'review:r2:checklist': met,
    'review:r2:code': clean([row('x')]),
  }, 2, Object.assign(withProfile({ gates: [{ name: 'lint', command: 'npm run lint', tier: 'fast' }, { name: 'test', command: 'npm test' }] }), { baseline: { lint: measured('l'), test: measured('t') } }))
}

test('W86: every block\'s filled input validates, and its contract part follows its instructions and precedes the mailbox note', async () => {
  const { result, calls } = await everyBlock()
  assert.deepEqual(calls.map(c => c.label), ['research', 'plan', 'replan', 'implement', 'implement:retry', 'gates:r1',
    'review:r1:checklist', 'review:r1:code', 'fix:r1', 'gates:r2', 'review:r2:checklist', 'review:r2:code'])
  assert.deepEqual(result.failures, [])
  for (const c of calls) {
    const at = c.prompt.indexOf('\n\nCONTRACT (binding, whatever the text above says):\n')
    assert.ok(at > c.prompt.indexOf('\n\nSTAGE: '), c.label)
    assert.ok(at < c.prompt.indexOf('\n\nMAILBOX: '), c.label)
    assert.ok(!/\{\{[\w.-]+\}\}/.test(c.prompt), c.label)
    assert.match(c.prompt.slice(at), /counts as died|is a failure/, c.label)
  }
  // Read-only blocks say so in their contract part; writers carry the commit rules there.
  for (const c of calls) assert.match(c.prompt.slice(c.prompt.indexOf('CONTRACT')), /fix|implement/.test(c.label.split(':')[0]) ? /COMMITS: / : /Read-only: change and commit nothing in \/r\./, c.label)
})

test('W87: an instruction naming a {{path}} its block does not take fails that block before the call', async () => {
  const swapped = SOURCE.replace('Read {{TARGET}}, its parent spec', 'Read {{TARGET}} {{cases}} {{nope}}, its parent spec')
  assert.notEqual(swapped, SOURCE)
  core = coreOf(swapped)
  try {
    const { result, calls } = await runCore({})
    assert.ok(!called(calls, 'research'))
    assert.equal(result.status, 'failed')
    assert.equal(result.stage, 'research')
    assert.deepEqual(result.failures, ['research input: unknown {{cases}}; unknown {{nope}}'])
  } finally { core = coreOf(SOURCE) }
})

test('W88: a value an instruction names that is missing, or off its schema, fails the block before the call', async () => {
  const missing = await runCore({}, 1, { target: undefined })
  assert.equal(missing.calls.length, 0)
  assert.equal(missing.result.stage, 'research')
  assert.deepEqual(missing.result.failures, ['research input: $: TARGET missing'])
  const swapped = SOURCE.replace('round, rounds: N, TARGET', "round, rounds: 'three', TARGET")
  assert.notEqual(swapped, SOURCE)
  core = coreOf(swapped)
  try {
    const typed = await runCore({})
    assert.ok(!called(typed.calls, 'review:r1:code'))
    assert.deepEqual(typed.result.failures, ['review:r1:checklist input: $.rounds: string, not integer', 'review:r1:code input: $.rounds: string, not integer', 'review r1 checklist', 'review r1 code'])
  } finally { core = coreOf(SOURCE) }
})

test('W89: a block config value off its registry schema fails the run before any agent, naming the field', async () => {
  for (const [blocks, wrong] of [[{ review: { rounds: 'auto' } }, 'blocks.review.rounds'], [{ review: { rounds: '3' } }, 'blocks.review.rounds'],
    [{ review: { minors: '2' } }, 'blocks.review.minors'], [{ review: { lenses: 'code' } }, 'blocks.review.lenses'],
    [{ review: { lenses: ['mechanics'] } }, 'blocks.review.lenses[0]'], [{ review: { duties: { order: 'yes' } } }, 'blocks.review.duties.order'],
    [{ research: { model: 3 } }, 'blocks.research.model'], [{ gates: { effort: 2 } }, 'blocks.gates.effort'],
    [{ gates: { gates: [{ name: 'g' }] } }, 'blocks.gates.gates[0]'],
    [{ plan: { prompt: ['x'] } }, 'blocks.plan.prompt'], [{ fix: { skill: 1 } }, 'blocks.fix.skill'], [{ review: { runtime: 3 } }, 'blocks.review.runtime']]) {
    const { result, calls } = await runCore({}, 1, withBlocks(blocks))
    assert.equal(calls.length, 0, JSON.stringify(blocks))
    assert.equal(result.stage, 'config')
    assert.ok(result.note.startsWith(`${wrong}:`), result.note)
  }
})

// The instructions of a call: what sits between the preamble and the contract part.
const instructions = p => p.slice(p.indexOf('\n\n', p.indexOf('\n- Repo agent instructions')) + 2, p.indexOf('\n\nCONTRACT (binding'))

test('W91: a project prompt replaces a block\'s instructions, filled from its inputs, and the contract part still follows', async () => {
  const { calls } = await runCore({}, 1, withBlocks({ research: { prompt: 'PROJECT RESEARCH of {{TARGET}}.' } }))
  const p = prompt(calls, 'research')
  assert.equal(instructions(p), 'PROJECT RESEARCH of /t.md.')
  assert.ok(p.startsWith('You are one agent in a workflow run implementing /t.md.'))
  assert.match(p, /\n\nCONTRACT \(binding, whatever the text above says\):\nRead-only/)
  const wrong = await runCore({}, 1, withBlocks({ research: { prompt: 'Read {{TARGET}} and {{nope}}.' } }))
  assert.equal(wrong.calls.length, 0)
  assert.equal(wrong.result.stage, 'config')
  assert.equal(wrong.result.note, 'profile.blocks.research.prompt: unknown placeholder {{nope}}')
})

test('W92: {{default}} in a project prompt inlines the default instructions of each call of the block', async () => {
  const plain = (await runCore({})).calls
  const { calls } = await runCore({}, 1, withBlocks({ review: { prompt: 'BEFORE\n{{default}}\nAFTER {{BASE}}' } }))
  for (const l of ['review:r1:checklist', 'review:r1:code']) {
    assert.equal(instructions(prompt(calls, l)), `BEFORE\n${instructions(prompt(plain, l))}\nAFTER aaaa000`, l)
    assert.match(instructions(prompt(calls, l)), new RegExp(`Lens: ${l.split(':')[2]}\\.`), l)
  }
})

test('W93: a skill path replaces the how-to with reading it, followed by the call\'s data; a block given both prompt and skill fails the run before any agent', async () => {
  const { calls } = await runCore({ 'review:r1:code': major, 'fix:r1': { applied: [], rejected: [{ id: 'R1-code-1', argument: 'a' }], proofs: [], head: 'bbbb111' } },
    2, withBlocks({ fix: { skill: '/p/fix.md' } }))
  const plain = await runCore({ 'review:r1:code': major, 'fix:r1': { applied: [], rejected: [{ id: 'R1-code-1', argument: 'a' }], proofs: [], head: 'bbbb111' } }, 2)
  const fix = prompt(calls, 'fix:r1')
  const data = name => JSON.stringify(JSON.parse(prompt(plain.calls, 'fix:r1').split(`\n${name}:\n`)[1].split('\n\n')[0]))
  assert.equal(instructions(fix), `Read /p/fix.md and follow it.\n\nROUND:\n1\n\nIMPLEMENT_SKILL:\n/t/.claude/workflows/red-green/skills/implement.md\n\nFINDINGS:\n${data('FINDINGS')}\n\nFIXED:\n[]\n\nRESEARCH:\n${data('RESEARCH')}`)
  assert.match(fix, /CONTRACT[^]*COMMITS: /)
  assert.ok(!/verify before you agree|Start from the change-site facts/.test(fix))
  const both = await runCore({}, 1, withBlocks({ implement: { skill: '/p/impl.md', prompt: 'x' } }))
  assert.equal(both.calls.length, 0)
  assert.equal(both.result.stage, 'config')
  assert.match(both.result.note, /blocks\.implement: prompt or skill, not both/)
})

test('W95: the removed profile strings and the moved profile fields fail the run before any agent, naming where they went', async () => {
  for (const [field, value, where] of [['research', 'text', /profile\.blocks\.research\.prompt as "\{\{default\}\}\\n<text>"/], ['runtime', 'text', /profile\.blocks\.review\.runtime/],
    ['gates', TESTS, /profile\.blocks\.gates\.gates/]]) {
    const args = withProfile()
    args.profile[field] = value
    const { result, calls } = await runCore({}, 1, args)
    assert.equal(calls.length, 0, field)
    assert.equal(result.stage, 'config', field)
    assert.match(result.note, new RegExp(`profile\\.${field}\\b`), field)
    assert.match(result.note, where, field)
  }
})

test('W96: blocks.review.runtime is where the code lens checks that every new branch executes; null leaves it out', async () => {
  const { calls } = await runCore({}, 1, withBlocks({ review: { runtime: 'Node 22 on the CI image' } }))
  assert.ok(prompt(calls, 'review:r1:code').includes('would every new branch execute as intended in Node 22 on the CI image, is every new assertion falsifiable'))
  assert.ok(prompt((await runCore({})).calls, 'review:r1:code').includes('would every new branch execute as intended, is every new assertion falsifiable'))
})

test('W97: the notes\' data are typed values: one off its registry schema fails the block before the call', async () => {
  for (const [from, to, label, wrong] of [['unverified: impl.unverified,', "unverified: 'x',", 'review:r1:checklist', '$.unverified: string, not array'],
    ['duplicates: dup,', "duplicates: 'x',", 'replan', '$.duplicates: string, not array']]) {
    const swapped = SOURCE.replace(from, to)
    assert.notEqual(swapped, SOURCE, from)
    core = coreOf(swapped)
    try {
      const { result, calls } = await runCore({ plan: { cases: base().plan.cases.concat(Object.assign({}, base().plan.cases[0], { id: 'C2' })) }, replan: base().plan })
      assert.ok(!called(calls, label), label)
      assert.ok(result.failures.includes(`${label} input: ${wrong}`), JSON.stringify(result.failures))
    } finally { core = coreOf(SOURCE) }
  }
})

test('W98: a research plan step over 600 characters gets one research:retry with the errors, same model and effort; its good answer goes on', async () => {
  const long = Object.assign({}, base().research, { plan: ['ok', 'x'.repeat(601)] })
  const good = Object.assign({}, base().research, { plan: ['GOOD-STEP'] })
  const { result, calls } = await runCore({ research: long, 'research:retry': good })
  assert.equal(count(calls, 'research:retry'), 1)
  const first = calls.find(c => c.label === 'research'), retry = calls.find(c => c.label === 'research:retry')
  assert.ok(!/previous answer/.test(first.prompt))
  assert.match(retry.prompt, /STAGE: research\. A previous answer at this stage failed the core's checks: "\$\.plan\[1\]: longer than 600"\./)
  assert.match(retry.prompt, /MAILBOX: you are `research:retry`\. If \/run\/mailbox\.md exists, read it at start and before returning/)
  assert.deepEqual([retry.opts.model, retry.opts.effort, retry.opts.schema], [first.opts.model, first.opts.effort, first.opts.schema])
  assert.ok(prompt(calls, 'plan').includes('GOOD-STEP'))
  assert.notEqual(result.status, 'failed')
})

test('W99: a research:retry that fails the checks too is a dead research; the run fails at research', async () => {
  const long = Object.assign({}, base().research, { plan: ['x'.repeat(601)] })
  const { result, calls } = await runCore({ research: long, 'research:retry': long })
  assert.ok(!called(calls, 'plan'))
  assert.equal(result.status, 'failed')
  assert.equal(result.stage, 'research')
  assert.deepEqual(result.failures, ['research:retry output: $.plan[0]: longer than 600'])
})

test('W101: a relayed message is to be mentioned in notes only by a stage whose schema has notes', async () => {
  const { calls } = await everyBlock()
  for (const c of calls) assert.equal(/mention it in (your )?notes/.test(c.prompt), 'notes' in c.opts.schema.properties, c.label)
  assert.ok(calls.some(c => 'notes' in c.opts.schema.properties) && calls.some(c => !('notes' in c.opts.schema.properties)))
})

test('W102: a checklist with an unmet row answers verdict findings, even with no other finding; clean with one is silent', async () => {
  const unmet = row('R1', { status: 'unmet', promise: 'p', counterexample: 'c' })
  const sent = await runCore({ 'review:r1:checklist': { verdict: 'findings', findings: [], checked: [unmet] },
    'fix:r1': { applied: [{ id: 'R1-R1', what: 'w' }], rejected: [], proofs: [], head: 'cccc222' } }, 2)
  assert.ok(!sent.result.failures.some(f => /silent/.test(f)), JSON.stringify(sent.result.failures))
  assert.match(prompt(sent.calls, 'fix:r1'), /R1-R1/)
  const quiet = await runCore({ 'review:r1:checklist': clean([unmet]) })
  assert.ok(quiet.result.failures.includes('review r1 checklist silent: verdict clean with 0 findings and an unmet row'), JSON.stringify(quiet.result.failures))
  assert.match(prompt(sent.calls, 'review:r1:checklist'), /verdict `clean` exactly when findings is empty and no row is `unmet`/)
})

test('W103: code rules end their line', async () => {
  const ruled = await runCore({ 'review:r1:code': major, 'fix:r1': { applied: [], rejected: [{ id: 'R1-code-1', argument: 'a' }], proofs: [], head: 'bbbb111' } }, 2, withProfile({ code_rules: ['RULE-ONE'] }))
  assert.match(prompt(ruled.calls, 'fix:r1'), /- RULE-ONE\nVerify each finding first/)
})

test('W104: the mailbox note is one line naming the label; only implement and the fixes also read before a long run or commit', async () => {
  const { calls } = await everyBlock()
  for (const c of calls) {
    const writes = /^(implement|fix)(:|$)/.test(c.label)
    assert.ok(c.prompt.endsWith(`\n\nMAILBOX: you are \`${c.label}\`. If /run/mailbox.md exists, read it at start${writes ? ', before each long run or commit' : ''} and before returning, and follow its header; never edit it. List what you handle in \`mailbox\`.`), c.label)
  }
})

test('W105: a non-string value fills in as compact JSON', async () => {
  const { calls } = await runCore({ 'review:r1:code': major, 'fix:r1': { applied: [], rejected: [{ id: 'R1-code-1', argument: 'a' }], proofs: [], head: 'bbbb111' } }, 2)
  const fix = prompt(calls, 'fix:r1')
  assert.ok(fix.includes(`FINDINGS:\n${JSON.stringify(sentTo(calls, 'fix:r1'))}\n`))
  assert.ok(fix.includes(`RESEARCH:\n${JSON.stringify(Object.assign({}, base().research, { files: ['src/a.cpp'] }))}\n`))
})

test('W106: a profile string\'s {{base}}, {{run}}, {{repo}} and {{tools}} reach the agents filled in from args', async () => {
  const { calls } = await runCore({}, 1, withProfile({
    gates: [{ name: 'tests', command: 'make -C {{repo}} test' }],
    code_rules: ['diff against {{base}}'], context: ['notes in {{run}}/notes'],
    blocks: { research: { prompt: '{{default}}\nSee {{tools}}/docs.' } } }))
  assert.ok(prompt(calls, 'gates:r1').includes('make -C /r test'))
  assert.ok(prompt(calls, 'implement').includes('- diff against aaaa000'))
  assert.ok(prompt(calls, 'research').includes('\nSee /t/docs.'))
  for (const c of calls) {
    assert.ok(c.prompt.includes('- notes in /run/notes'), c.label)
    assert.ok(!/\{\{(base|run|repo|tools)\}\}/.test(c.prompt), c.label)
  }
})

test('W107: any other {{...}} in a profile string fails the run before any agent, naming it and where; {{default}} only in a block prompt', async () => {
  for (const [over, named] of [[{ code_rules: ['x {{nope}}'] }, /profile\.code_rules\[0\]: unknown placeholder \{\{nope\}\}/],
    [{ gates: [{ name: 'tests', command: 'make {{BASE}}' }] }, /profile\.blocks\.gates\.gates\[0\]\.command: unknown placeholder \{\{BASE\}\}/],
    [{ blocks: { research: { prompt: '{{default}} {{bogus}}' } } }, /profile\.blocks\.research\.prompt: unknown placeholder \{\{bogus\}\}/],
    [{ context: ['{{default}}'] }, /profile\.context\[0\]: unknown placeholder \{\{default\}\}/]]) {
    const { result, calls } = await runCore({}, 1, withProfile(over))
    assert.equal(calls.length, 0, JSON.stringify(over))
    assert.equal(result.status, 'failed')
    assert.equal(result.stage, 'config')
    assert.match(result.note, named)
  }
})

// The linear loop: order of labels and the result. Every review stub below answers clean unless the case says otherwise.
const labels = calls => calls.map(c => c.label).filter(l => !['research', 'plan', 'implement'].includes(l))
const lensesOf = r => [`review:r${r}:checklist`, `review:r${r}:code`]
const applied = (id, head) => ({ applied: [{ id, what: 'w' }], rejected: [], proofs: [], head })
const minorsOnly = (...wheres) => ({ verdict: 'findings', checked: [row('x')], findings: wheres.map(w => finding('minor', w, 't')) })

test('L01: a clean run reviews min iterations and ends with an empty result', async () => {
  const { result, calls } = await runCore({}, 'default')
  assert.deepEqual(labels(calls), ['gates:r1', ...lensesOf(1), ...lensesOf(2)])
  assert.deepEqual([result.status, result.rounds_planned, result.rounds_run], ['done', 3, 2])
  assert.deepEqual([result.leftover_findings, result.advisory, result.failures, result.stray_proofs], [[], [], [], []])
})

test('L02: the loop runs at most rounds iterations and never grows, whatever the last one found', async () => {
  const { result, calls } = await runCore({
    'review:r1:code': major, 'fix:r1': applied('R1-code-1', 'cccc222'),
    'review:r2:code': major, 'fix:r2': applied('R2-code-1', 'dddd333'), 'gates:r3': gatesAt('dddd333'),
    'review:r3:code': major,
  }, 3)
  assert.deepEqual(labels(calls), ['gates:r1', ...lensesOf(1), 'fix:r1', 'gates:r2', ...lensesOf(2), 'fix:r2', 'gates:r3', ...lensesOf(3)])
  assert.deepEqual([result.rounds_planned, result.rounds_run], [3, 3])
  assert.deepEqual(result.leftover_findings.map(f => f.id), ['R3-code-1'])
})

test('L03: a clean iteration at min ends the loop; one past min after a finding does too', async () => {
  const atMin = await runCore({}, 3)
  assert.equal(atMin.result.rounds_run, 2)
  const past = await runCore({ 'review:r2:code': major, 'fix:r2': applied('R2-code-1', 'cccc222') }, 4)
  assert.deepEqual(labels(past.calls), ['gates:r1', ...lensesOf(1), ...lensesOf(2), 'fix:r2', 'gates:r3', ...lensesOf(3)])
  assert.equal(past.result.rounds_run, 3)
})

test('L04: a clean iteration before min makes no fix and reviews the same code again: no gates in between', async () => {
  const { calls } = await runCore({}, 3)
  assert.deepEqual(labels(calls), ['gates:r1', ...lensesOf(1), ...lensesOf(2)])
})

test('L05: each fix is followed by gates and a full review', async () => {
  const { calls } = await runCore({ 'review:r1:checklist': major, 'fix:r1': applied('R1-checklist-1', 'cccc222') }, 2)
  assert.deepEqual(labels(calls), ['gates:r1', ...lensesOf(1), 'fix:r1', 'gates:r2', ...lensesOf(2)])
})

test('L06: the last iteration makes no fix, and its majors are left over', async () => {
  const { result, calls } = await runCore({ 'review:r1:code': major })
  assert.deepEqual(labels(calls), ['gates:r1', ...lensesOf(1)])
  assert.deepEqual(result.leftover_findings.map(f => [f.id, f.severity]), [['R1-code-1', 'major']])
})

test('L07: minors alone make no fix, and reach advisory', async () => {
  const { result, calls } = await runCore({ 'review:r1:code': minorsOnly('m:1') }, 2)
  assert.deepEqual(labels(calls), ['gates:r1', ...lensesOf(1), ...lensesOf(2)])
  assert.deepEqual(result.advisory.map(fileOf), ['m:1'])
})

test('L08: a dead-lens iteration with only minors is not clean and makes no fix', async () => {
  const { result, calls } = await runCore({ 'review:r1:checklist': null, 'review:r1:code': minorsOnly('m:1') }, 3, withBlocks({ review: { min: 1 } }))
  assert.deepEqual(labels(calls), ['gates:r1', ...lensesOf(1), ...lensesOf(2)])
  assert.equal(result.rounds_run, 2)
  assert.deepEqual(result.advisory.map(fileOf), ['m:1'])
})

test('L09: minors reach fix together with a major', async () => {
  const both = { verdict: 'findings', checked: [row('x')], findings: [finding('major', 'a:1', 't'), finding('minor', 'm:1', 't')] }
  const { calls } = await runCore({ 'review:r1:code': both, 'fix:r1': applied('R1-code-1', 'cccc222') }, 2)
  assert.deepEqual(sentTo(calls, 'fix:r1').map(f => [f.id, f.severity]), [['R1-code-1', 'major'], ['R1-code-2', 'minor']])
})

test('L10: fixed and rejected minors enter the earlier-findings history; applied ones leave advisory, rejected ones stay', async () => {
  const three = { verdict: 'findings', checked: [row('x')], findings: [finding('major', 'a:1', 't'), finding('minor', 'm:1', 't'), finding('minor', 'm:2', 't')] }
  const { result, calls } = await runCore({ 'review:r1:code': three,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }, { id: 'R1-code-2', what: 'w' }], rejected: [{ id: 'R1-code-3', argument: 'ARG' }], proofs: [], head: 'cccc222' } }, 2)
  const past = JSON.parse(prompt(calls, 'review:r2:code').split('EARLIER FINDINGS')[1].split('\n')[1])
  assert.deepEqual(past.map(f => [f.id, f.outcome]), [['R1-code-1', 'fixed'], ['R1-code-2', 'fixed'], ['R1-code-3', 'rejected']])
  assert.deepEqual(result.advisory.map(f => f.id), ['R1-code-3'])
})

test('L11: last-iteration majors and unmet rows are left over once each; an unverified row is reported, with no severity', async () => {
  const { result } = await runCore({
    research: Object.assign({}, base().research, { requirements: ['R1: one', 'R2: two'], test_harness: [harness('R1'), harness('R2', 'review')] }),
    'review:r1:checklist': { verdict: 'findings', findings: [], checked: [row('R1', { status: 'unmet', promise: 'p', counterexample: 'c' }), row('R2', { status: 'unverified', promise: 'p', counterexample: 'c' })] },
    'review:r1:code': major,
  })
  assert.deepEqual(result.leftover_findings.map(f => [f.id, f.severity, f.status]), [['R1-code-1', 'major', undefined], ['R1', undefined, 'unmet'], ['R2', undefined, 'unverified']])
})

test('L12: a red gate at the last iteration is left over, also when HEAD did not move since its rows', async () => {
  const red = gatesAt('bbbb111', gate('tests', 'red', 'RED'))
  const last = await runCore({ 'gates:r1': red }, 1, noAttempts)
  assert.deepEqual(last.result.leftover_findings.map(f => f.id), ['G1-tests'])
  const rejected = await runCore({ 'gates:r1': red, 'fix:r1': { applied: [], rejected: [{ id: 'G1-tests', argument: 'a' }], proofs: [], head: 'bbbb111' } }, 2, noAttempts)
  assert.ok(!called(rejected.calls, 'gates:r2'))
  assert.deepEqual(rejected.result.leftover_findings.map(f => f.source), ['gates'])
})

test('L13: advisory holds minors no fix applied, from any iteration, deduplicated', async () => {
  const { result } = await runCore({ 'review:r1:code': minorsOnly('same:1', 'r1:1'), 'review:r2:code': minorsOnly('same:1', 'r2:1') }, 2)
  assert.deepEqual(result.advisory.map(fileOf), ['same:1', 'r1:1', 'r2:1'])
})

test('L30: a minor dropped over the cap with a proof is a stray and a failure', async () => {
  const proof = { path: 'tests/dropped.js', command: 'c', red: 'r' }
  const three = ['m1', 'm2', 'm3'].map(w => finding('minor', w, 't'))
  three[2].proof = proof
  const { result } = await runCore({ 'review:r1:code': { verdict: 'findings', checked: [row('x')], findings: three } })
  assert.deepEqual(result.advisory.map(fileOf), ['m1', 'm2'])
  assert.deepEqual(result.stray_proofs.map(s => s.path), [proof.path])
  assert.ok(result.failures.some(f => f.includes(proof.path)))
})

test('L31: the closing fix also gets earlier minors not yet handled, each once', async () => {
  const findings = (...fs) => ({ verdict: 'findings', checked: [row('x')], findings: fs })
  const { calls } = await runCore({
    'review:r1:code': minorsOnly('old:1', 'same:1'),
    'review:r2:code': findings(finding('major', 'big:1', 't'), finding('minor', 'same:1', 't')),
    'fix:r2': { applied: [{ id: 'R2-code-1', what: 'w' }, { id: 'R2-code-2', what: 'w' }], rejected: [{ id: 'R1-code-1', argument: 'a' }], proofs: [], head: 'cccc222' },
    'review:r3:code': findings(finding('major', 'big:2', 't')),
    'fix:r3': applied('R3-code-1', 'dddd333'),
    'gates:r4': gatesAt('dddd333'),
    'review:r4:checklist': clean([row('R1', { status: 'met' })]), 'review:r4:code': clean([row('x')]),
  }, 4)
  assert.deepEqual(sentTo(calls, 'fix:r2').map(fileOf).sort(), ['big:1', 'old:1', 'same:1'])
  assert.deepEqual(sentTo(calls, 'fix:r3').map(fileOf), ['big:2'], 'each earlier minor was handled, the rejected and the duplicate too')
})

test('L14: minor_fixes leaves the result; no minor fix or fix review stage is called', async () => {
  const { result, calls } = await runCore({ 'review:r1:code': minorsOnly('m:1') })
  assert.ok(!('minor_fixes' in result))
  assert.ok(!calls.some(c => /^(fix:minor|review:fix)/.test(c.label)))
  assert.ok(!('recheck' in result.rounds[0]))
})

test('L15: a rejection the next review does not raise again is accepted', async () => {
  const { result } = await runCore({ 'review:r1:code': major, 'fix:r1': { applied: [], rejected: [{ id: 'R1-code-1', argument: 'a' }], proofs: [], head: 'bbbb111' } }, 2)
  assert.deepEqual(result.leftover_findings, [])
})

test('L16: each lens gets from_head and the last fix\'s outcomes and is told to verify them; a review with no fix before it is not', async () => {
  const two = { verdict: 'findings', checked: [row('x')], findings: [finding('major', 'a:1', 't'), finding('major', 'b:1', 't')] }
  const { calls } = await runCore({ 'review:r1:code': two, 'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [{ id: 'R1-code-2', argument: 'ARG-1' }], proofs: [], head: 'cccc222' } }, 2)
  for (const l of lensesOf(2)) {
    const p = prompt(calls, l)
    assert.ok(p.includes('git diff bbbb111..HEAD'), l)
    assert.match(p, /a claim that fails is a new major/, l)
    assert.match(p, /weakened, deleted or left asserting nothing it promises is a new major/, l)
    assert.deepEqual(JSON.parse(p.split('OUTCOMES:\n')[1].split('\n')[0]), [{ id: 'R1-code-1', where: { file: 'a:1', symbol: 'S' }, problem: 'p', outcome: 'fixed' },
      { id: 'R1-code-2', where: { file: 'b:1', symbol: 'S' }, problem: 'p', outcome: 'rejected', argument: 'ARG-1' }], l)
  }
  for (const l of lensesOf(1)) assert.ok(!/OUTCOMES:|claim that fails/.test(prompt(calls, l)), l)
  const off = await runCore({ 'review:r1:code': major, 'fix:r1': applied('R1-code-1', 'cccc222') }, 2, withBlocks({ review: { duties: { test_case_review: false } } }))
  assert.match(prompt(off.calls, 'review:r2:code'), /OUTCOMES:/)
  assert.ok(!/is a new major too/.test(prompt(off.calls, 'review:r2:code')))
})

test('L17: the outcomes reach only the iteration after the fix', async () => {
  const { calls } = await runCore({ 'review:r1:code': major, 'fix:r1': applied('R1-code-1', 'cccc222'), 'review:r2:checklist': null }, 3)
  assert.match(prompt(calls, 'review:r2:code'), /OUTCOMES:/)
  assert.ok(!/OUTCOMES:/.test(prompt(calls, 'review:r3:code')))
})

test('L18: applied findings with head unchanged are one entry in failures; all rejected with head unchanged is none', async () => {
  const stuck = await runCore({ 'review:r1:code': major, 'fix:r1': applied('R1-code-1', 'bbbb111') }, 2)
  assert.equal(stuck.result.failures.filter(f => /head unchanged/.test(f)).length, 1)
  assert.match(stuck.result.failures.find(f => /head unchanged/.test(f)), /R1-code-1/)
  assert.equal(stuck.result.status, 'done_with_failures')
  const rejected = await runCore({ 'review:r1:code': major, 'fix:r1': { applied: [], rejected: [{ id: 'R1-code-1', argument: 'a' }], proofs: [], head: 'bbbb111' } }, 2)
  assert.deepEqual(rejected.result.failures, [])
})

test('L19: the code lens is told to write no proof file in the last iteration; before it, none for a minor', async () => {
  const { calls } = await runCore({}, 2)
  assert.match(prompt(calls, 'review:r1:code'), /written as a new, uncommitted file/)
  assert.match(prompt(calls, 'review:r1:code'), /no proof file for a minor/)
  assert.ok(!/uncommitted file/.test(prompt(calls, 'review:r2:code')))
  assert.match(prompt(calls, 'review:r2:code'), /Write no proof file/)
  assert.ok(!/proof file/.test(prompt(calls, 'review:r1:checklist')))
})

const noTrigger = () => ({ verdict: 'findings', checked: [row('x')], findings: [Object.assign(finding('major', 'a:1', ''), { proof })] })

test('L20: a finding downgraded to minor loses its proof, and the next fix is told to delete the file', async () => {
  const both = noTrigger()
  both.findings.push(finding('major', 'b:1', 't'))
  const { result, calls } = await runCore({ 'review:r1:code': both,
    'fix:r1': { applied: [{ id: 'R1-code-2', what: 'w' }], rejected: [], proofs: [{ id: 'R1-code-1', path: proof.path, outcome: 'deleted' }], head: 'cccc222' } }, 2)
  const sent = sentTo(calls, 'fix:r1').find(f => f.id === 'R1-code-1')
  assert.equal(sent.severity, 'minor')
  assert.ok(!('proof' in sent))
  const contract = prompt(calls, 'fix:r1').split('CONTRACT')[1]
  assert.ok(contract.includes('Delete each of these proof files'))
  assert.ok(contract.includes(`R1-code-1 ${proof.path}`))
  assert.deepEqual(result.stray_proofs, [])
  assert.ok(!('proof' in result.advisory.find(f => f.id === 'R1-code-1')))
  const ignored = await runCore({ 'review:r1:code': both, 'fix:r1': { applied: [], rejected: [], proofs: [], head: 'bbbb111' } }, 2)
  assert.deepEqual(ignored.result.stray_proofs, [{ id: 'R1-code-1', path: proof.path }])
})

test('L21: a clean iteration\'s proof is a stray for the main thread, as is one on a last iteration\'s major', async () => {
  const onMinor = await runCore({ 'review:r1:code': noTrigger() })
  assert.deepEqual(labels(onMinor.calls), ['gates:r1', ...lensesOf(1)])
  assert.deepEqual(onMinor.result.stray_proofs, [{ id: 'R1-code-1', path: proof.path }])
  const onMajor = await runCore({ 'review:r1:code': proven })
  assert.deepEqual(onMajor.result.stray_proofs, [{ id: 'R1-code-1', path: proof.path }])
})

test('L22: review.extra, blocks.minor-fix and blocks.fix-review fail on config with a note saying where each went', async () => {
  for (const [blocks, note] of [[{ review: { extra: 1 } }, /profile\.blocks\.review\.extra moved to profile\.blocks\.review\.rounds/],
    [{ 'minor-fix': { effort: 'low' } }, /profile\.blocks\.minor-fix moved to profile\.blocks\.fix/],
    [{ 'fix-review': { effort: 'low' } }, /profile\.blocks\.fix-review moved to profile\.blocks\.review/]]) {
    const { result, calls } = await runCore({}, 1, withBlocks(blocks))
    assert.equal(calls.length, 0, JSON.stringify(blocks))
    assert.equal(result.stage, 'config')
    assert.match(result.note, note)
  }
})

test('L23: rounds < 1, min < 1 and min > rounds fail on config; rounds: 1 alone names min in its note', async () => {
  for (const [review, note] of [[{ rounds: 0, min: 0 }, /blocks\.review\.rounds: 0/], [{ rounds: 2, min: 0 }, /blocks\.review\.min: 0/], [{ rounds: 2, min: 3 }, /blocks\.review\.min: 3/]]) {
    const { result, calls } = await runCore({}, 'default', withBlocks({ review }))
    assert.equal(calls.length, 0, JSON.stringify(review))
    assert.equal(result.stage, 'config')
    assert.match(result.note, note)
  }
  const { result } = await runCore({}, 'default', withBlocks({ review: { rounds: 1 } }))
  assert.equal(result.stage, 'config')
  assert.match(result.note, /blocks\.review\.min: 2 is over rounds 1: set min too/)
})

// One gate, tests, red with this line, and an attempt's or a fix's answer.
const redAt = (head, line = 'RED') => gatesAt(head, gate('tests', 'red', line))
const fixedAs = (id, head) => ({ applied: [{ id, what: 'w' }], rejected: [], head })

test('W120: a red gate goes to fix as a major from the gates source, before any review, and the stage runs again', async () => {
  const { result, calls } = await runCore({
    'gates:r1': redAt('bbbb111', 'FIRST-RED'),
    'fix:r1:a1': fixedAs('G1-tests', 'cccc222'),
    'gates:r1:a1': gatesAt('cccc222'),
  })
  assert.deepEqual(labels(calls).filter(l => /^(gates|fix|review)/.test(l)), ['gates:r1', 'fix:r1:a1', 'gates:r1:a1', 'review:r1:checklist', 'review:r1:code'])
  const [sent] = sentTo(calls, 'fix:r1:a1')
  assert.deepEqual([sent.id, sent.source, sent.severity, sent.where], ['G1-tests', 'gates', 'major', 'tests'])
  assert.match(sent.problem, /FIRST-RED/)
  assert.deepEqual(result.failures, [])
  assert.deepEqual(result.leftover_findings, [])
})

test('W121: attempts repeat up to fix_attempts per iteration, default 2, with rounds untouched', async () => {
  const over = {
    'gates:r1': redAt('bbbb111'),
    'fix:r1:a1': fixedAs('G1-tests', 'cccc222'), 'gates:r1:a1': redAt('cccc222'),
    'fix:r1:a2': fixedAs('G1a1-tests', 'dddd333'), 'gates:r1:a2': redAt('dddd333'),
    'fix:r1': fixedAs('G1a2-tests', 'eeee444'), 'gates:r2': gatesAt('eeee444'),
  }
  const { result, calls } = await runCore(over, 2)
  assert.deepEqual(labels(calls).filter(l => /^(gates|fix)/.test(l)), ['gates:r1', 'fix:r1:a1', 'gates:r1:a1', 'fix:r1:a2', 'gates:r1:a2', 'fix:r1', 'gates:r2'])
  assert.equal(result.rounds_planned, 2)
  assert.equal(result.rounds_run, 2)
  const one = await runCore(over, 2, withBlocks({ gates: { fix_attempts: 1 } }))
  assert.equal(count(one.calls, 'fix:r1:a1'), 1)
  assert.ok(!called(one.calls, 'fix:r1:a2'))
})

test('W122: past the limit the review gets a note naming the gates still red and the attempts made; the iteration is never clean', async () => {
  const { result, calls } = await runCore({
    'gates:r1': redAt('bbbb111'),
    'fix:r1:a1': fixedAs('G1-tests', 'cccc222'), 'gates:r1:a1': redAt('cccc222'),
    'fix:r1:a2': fixedAs('G1a1-tests', 'dddd333'), 'gates:r1:a2': redAt('dddd333', 'LAST-RED'),
  })
  for (const l of ['review:r1:checklist', 'review:r1:code']) assert.match(prompt(calls, l), /Still red after 2 attempts at a fix: tests\./)
  assert.deepEqual(result.leftover_findings.map(f => [f.source, f.severity, f.where]), [['gates', 'major', 'tests']])
  assert.match(result.leftover_findings[0].problem, /LAST-RED/)
  assert.equal(result.rounds[0].major, 1)
})

test('W123: no note while every gate is green or known_red, also after an attempt', async () => {
  const { calls } = await runCore({ 'gates:r1': redAt('bbbb111'), 'fix:r1:a1': fixedAs('G1-tests', 'cccc222'), 'gates:r1:a1': gatesAt('cccc222', gate('tests', 'known_red', 'old')) })
  assert.ok(!/Still red/.test(prompt(calls, 'review:r1:code')))
})

test('W124: an attempt in the last iteration runs, and that iteration\'s review covers it from where the attempts started', async () => {
  const { calls, result } = await runCore({
    'gates:r1': redAt('bbbb111'),
    'fix:r1:a1': fixedAs('G1-tests', 'cccc222'), 'gates:r1:a1': redAt('cccc222'),
    'fix:r1:a2': fixedAs('G1a1-tests', 'dddd333'), 'gates:r1:a2': gatesAt('dddd333'),
  })
  const code = prompt(calls, 'review:r1:code')
  assert.ok(code.includes('git diff bbbb111..HEAD'))
  const outcomes = code.split('OUTCOMES:\n')[1]
  assert.ok(outcomes.includes('"id":"G1-tests"') && outcomes.includes('"id":"G1a1-tests"'))
  assert.deepEqual(result.leftover_findings, [])
  assert.deepEqual(result.failures, [])
})

test('W125: a review after a fix and attempts covers both, from the start of the fix', async () => {
  const { calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': fixedAs('R1-code-1', 'cccc222'), 'gates:r2': redAt('cccc222'),
    'fix:r2:a1': fixedAs('G2-tests', 'dddd333'), 'gates:r2:a1': gatesAt('dddd333'),
  }, 2)
  const code = prompt(calls, 'review:r2:code')
  assert.ok(code.includes('git diff bbbb111..HEAD'))
  const outcomes = code.split('OUTCOMES:\n')[1]
  assert.ok(outcomes.includes('"id":"R1-code-1"') && outcomes.includes('"id":"G2-tests"'))
})

test('W126: fix_attempts 0 sends a red gate straight to review with the note; below 0 fails on config', async () => {
  const { calls } = await runCore({ 'gates:r1': redAt('bbbb111') }, 1, withBlocks({ gates: { fix_attempts: 0 } }))
  assert.ok(!called(calls, 'fix:r1:a1'))
  assert.match(prompt(calls, 'review:r1:code'), /Still red after 0 attempts at a fix: tests\./)
  const bad = await runCore({}, 1, withBlocks({ gates: { fix_attempts: -1 } }))
  assert.equal(bad.calls.length, 0)
  assert.equal(bad.result.stage, 'config')
  assert.match(bad.result.note, /fix_attempts: -1/)
})

test('W127: a fix leaving HEAD unmoved ends the iteration\'s attempts; red still comes from the latest rows in the next one', async () => {
  const silent = { applied: [], rejected: [], head: 'bbbb111' }
  const { calls } = await runCore({
    'gates:r1': redAt('bbbb111'), 'fix:r1:a1': silent, 'fix:r1': silent,
    'fix:r2:a1': fixedAs('G1-tests', 'cccc222'), 'gates:r2:a1': gatesAt('cccc222'),
  }, 2)
  assert.deepEqual(labels(calls).filter(l => /^(gates|fix)/.test(l)), ['gates:r1', 'fix:r1:a1', 'fix:r1', 'fix:r2:a1', 'gates:r2:a1'])
  assert.match(prompt(calls, 'review:r1:code'), /Still red after 1 attempts/)
})

test('W128: a gate rejected at this HEAD gets no new attempt, and its rows are reused with no stage agent', async () => {
  const rejects = id => ({ applied: [], rejected: [{ id, argument: 'a' }], head: 'bbbb111' })
  const { calls, result } = await runCore({ 'gates:r1': redAt('bbbb111'), 'fix:r1:a1': rejects('G1-tests') }, 2)
  assert.deepEqual(labels(calls).filter(l => /^(gates|fix)/.test(l)), ['gates:r1', 'fix:r1:a1'])
  assert.match(prompt(calls, 'review:r1:code'), /Still red after 1 attempts/)
  assert.ok(!called(calls, 'review:r2:code'), 'identical code is not reviewed again')
  assert.equal(result.rounds_run, 1)
  assert.deepEqual(result.leftover_findings.map(fileOf), ['tests'])
})

test('W133: the note counts a gate\'s attempts across the run, not this iteration', async () => {
  const rejectAll = { applied: [], rejected: [{ id: 'G1a1-tests', argument: 'x' }, { id: 'R1-code-1', argument: 'y' }], proofs: [], head: 'cccc222' }
  const { calls } = await runCore({
    'gates:r1': redAt('bbbb111'), 'fix:r1:a1': fixedAs('G1-tests', 'cccc222'), 'gates:r1:a1': redAt('cccc222'),
    'review:r1:code': major, 'fix:r1': rejectAll,
  }, 2, withBlocks({ gates: { fix_attempts: 1 } }))
  assert.ok(!called(calls, 'fix:r2:a1'))
  assert.match(prompt(calls, 'review:r2:code'), /Still red after 1 attempts/)
})

test('W129: rejected at an earlier HEAD, a gate red at a new one gets an attempt', async () => {
  const { calls } = await runCore({
    'gates:r1': gatesAt('bbbb111', gate('A', 'red', 'a'), gate('B', 'red', 'b')),
    'fix:r1:a1': { applied: [{ id: 'G1-B', what: 'w' }], rejected: [{ id: 'G1-A', argument: 'x' }], head: 'cccc222' },
    'gates:r1:a1': gatesAt('cccc222', gate('A', 'red', 'a'), gate('B', 'green', 'b')),
    'fix:r1:a2': fixedAs('G1a1-A', 'dddd333'),
    'gates:r1:a2': gatesAt('dddd333', gate('A', 'green', 'a'), gate('B', 'green', 'b')),
  }, 1, twoGates)
  assert.deepEqual(sentTo(calls, 'fix:r1:a2').map(fileOf), ['A'])
})

test('W130: with HEAD unchanged the stage runs again only while a gate holds no result', async () => {
  const reused = await runCore({ 'gates:r1': gatesAt('bbbb111') }, 2)
  assert.ok(!called(reused.calls, 'gates:r2'))
  const { calls } = await runCore({
    'gates:r1': gatesAt('bbbb111', gate('tests', 'not_run', 'x')), 'gates:r1:retry': gatesAt('bbbb111', gate('tests', 'not_run', 'x')),
    'gates:r2': gatesAt('bbbb111'),
  }, 2)
  assert.ok(called(calls, 'gates:r2'))
})

test('W131: attempts do not count toward the rule on a finding that recurs after two fixes', async () => {
  const { calls } = await runCore({
    'gates:r1': redAt('bbbb111'), 'fix:r1:a1': fixedAs('G1-tests', 'cccc222'), 'gates:r1:a1': redAt('cccc222'),
    'fix:r1:a2': fixedAs('G1a1-tests', 'dddd333'), 'gates:r1:a2': gatesAt('dddd333'),
    'review:r1:code': major, 'fix:r1': fixedAs('R1-code-1', 'eeee444'), 'gates:r2': gatesAt('eeee444'),
  }, 2)
  const text = prompt(calls, 'fix:r1')
  assert.ok(!/EARLIER FIXES/.test(text))
  assert.ok(!/recurs after two fixes/.test(text))
  assert.ok(/EARLIER FINDINGS/.test(prompt(calls, 'review:r2:code')))
})

test('W132: labels are unique, a retry inside an attempt too', async () => {
  const none = gatesAt('cccc222', gate('tests', 'not_run', 'x'))
  const { calls } = await runCore({
    'gates:r1': gatesAt('bbbb111', gate('tests', 'not_run', 'x')), 'gates:r1:retry': redAt('bbbb111'),
    'fix:r1:a1': fixedAs('G1-tests', 'cccc222'), 'gates:r1:a1': none, 'gates:r1:a1:retry': gatesAt('cccc222'),
  })
  const seen = calls.map(c => c.label)
  assert.equal(new Set(seen).size, seen.length)
  assert.ok(called(calls, 'gates:r1:a1:retry'))
})

// No mutation in the run: an iteration is gates, review and fix; mutation runs by hand (skills/mutate.mjs).
test('MU01: an iteration runs gates, the lenses and fix with no mutation step, and the result holds no mutation', async () => {
  const { result, calls } = await runCore({ 'review:r1:code': major, 'fix:r1': applied('R1-code-1', 'cccc222') }, 2, withProfile())
  assert.deepEqual(labels(calls), ['gates:r1', ...lensesOf(1), 'fix:r1', 'gates:r2', ...lensesOf(2)])
  assert.ok(!('mutation' in result) && !('mutation_skipped' in result))
})

test('MU02: blocks.mutation, whatever it holds, fails the run on config before any agent, naming the by-hand command', async () => {
  for (const mutation of [{}, { test: 'T' }, { tool: 'X' }]) {
    const { result, calls } = await runCore({}, 1, { profile: { blocks: { gates: { gates: TESTS }, mutation } } })
    assert.equal(calls.length, 0, JSON.stringify(mutation))
    assert.equal(result.stage, 'config')
    assert.match(result.note, /profile\.blocks\.mutation .*skills\/mutate\.mjs/)
  }
})

test('MU04: a top-level profile.mutation, the by-hand command\'s section, is ignored by the run', async () => {
  const plain = await runCore({}, 1, withProfile())
  const { result, calls } = await runCore({}, 1, withProfile({ mutation: { include: ['src/**'], exclude: ['vendor/**'], skip_lines: ['^\\s*//'] } }))
  assert.deepEqual(labels(calls), labels(plain.calls))
  assert.deepEqual(calls.map(c => c.prompt), plain.calls.map(c => c.prompt))
  assert.equal(result.status, plain.result.status)
})

test('MU03: {{mutate_from}} is an unknown placeholder', async () => {
  const { result, calls } = await runCore({}, 1, withProfile({ gates: [{ name: 'tests', command: 'npm test {{mutate_from}}' }] }))
  assert.equal(calls.length, 0)
  assert.match(result.note, /profile\.blocks\.gates\.gates\[0\]\.command: unknown placeholder \{\{mutate_from\}\}/)
})

test('MU15: a gate rejected at this HEAD as the only major ends the loop with no fix; it stays a major and reaches leftover_findings', async () => {
  const red = gatesAt('bbbb111', gate('tests', 'red', 'F'))
  const rejected = { applied: [], rejected: [{ id: 'G1-tests', argument: 'a' }], proofs: [], head: 'bbbb111' }
  const { result, calls } = await runCore({ 'gates:r1': red, 'fix:r1:a1': rejected }, 2)
  assert.deepEqual(labels(calls), ['gates:r1', 'fix:r1:a1', ...lensesOf(1)])
  assert.deepEqual(result.rounds.map(r => r.major), [1])
  assert.deepEqual(result.leftover_findings.map(f => [f.id, f.severity]), [['G1-tests', 'major']])
  const withOther = await runCore({ 'gates:r1': red, 'fix:r1:a1': rejected, 'review:r1:code': major, 'fix:r1': applied('R1-code-1', 'cccc222') }, 2)
  assert.deepEqual(sentTo(withOther.calls, 'fix:r1').map(f => f.id), ['G1-tests', 'R1-code-1'])
})

// Findings are grouped by place: both lenses' findings on one file and symbol reach fix as one item.
const placed = (where, problem, fix) => ({ severity: 'major', where, problem, trigger: 't', consequence: 'c', fix })
const lensSaid = (...fs) => ({ verdict: 'findings', checked: [row('x')], findings: fs })
const ANCHOR = { file: 'src/baton.cpp', symbol: 'BatonPeer::Advance' }
const outcomesIn = (calls, label) => JSON.parse(prompt(calls, label).split('OUTCOMES:\n')[1].split('\n')[0])

test('GR01: two lenses\' findings in different words on one file and symbol reach fix as one item, answered once for each', async () => {
  const { result, calls } = await runCore({
    'review:r1:checklist': { verdict: 'findings', checked: [row('R1', { status: 'met' })], findings: [placed(Object.assign({ lines: '178-188' }, ANCHOR), 'the anchor is set once per bench period', 'reset it')] },
    'review:r1:code': lensSaid(placed(ANCHOR, 'the playout anchor drifts', 'anchor per frame')),
    'fix:r1': { applied: [{ id: 'R1-checklist-1', what: 'w' }], rejected: [], proofs: [], head: 'cccc222' },
  }, 2)
  assert.deepEqual(sentTo(calls, 'fix:r1'), [{ id: 'R1-checklist-1', ids: ['R1-checklist-1', 'R1-code-1'], severity: 'major', where: Object.assign({ lines: '178-188' }, ANCHOR), views: [
    { lens: 'checklist', severity: 'major', problem: 'the anchor is set once per bench period', trigger: 't', consequence: 'c', fix: 'reset it' },
    { lens: 'code', severity: 'major', problem: 'the playout anchor drifts', trigger: 't', consequence: 'c', fix: 'anchor per frame' }] }])
  assert.equal(result.rounds[0].major, 2, 'rounds count findings, not groups')
  assert.deepEqual(outcomesIn(calls, 'review:r2:code').map(o => [o.id, o.outcome]), [['R1-checklist-1', 'fixed'], ['R1-code-1', 'fixed']])
})

test('GR02: two findings on different symbols of one file stay apart', async () => {
  const { calls } = await runCore({
    'review:r1:code': lensSaid(placed(ANCHOR, 'p1', 'f1'), placed({ file: ANCHOR.file, symbol: 'BatonPeer::Author' }, 'p2', 'f2')),
    'fix:r1': applied('R1-code-1', 'cccc222'),
  }, 2)
  assert.deepEqual(sentTo(calls, 'fix:r1').map(f => [f.id, f.where.symbol]), [['R1-code-1', 'BatonPeer::Advance'], ['R1-code-2', 'BatonPeer::Author']])
})

test('GR03: a group left at the last iteration is one leftover item; a rejection applies to each member', async () => {
  const both = lensSaid(placed(ANCHOR, 'p1', 'f1'), placed(ANCHOR, 'p2', 'f2'))
  const { result } = await runCore({ 'review:r1:code': both })
  assert.deepEqual(result.leftover_findings.map(f => [f.ids, f.views.length]), [[['R1-code-1', 'R1-code-2'], 2]])
  // Fix answers a group by any member's id.
  const rejected = await runCore({ 'review:r1:code': both, 'fix:r1': { applied: [], rejected: [{ id: 'R1-code-2', argument: 'ARG' }], proofs: [], head: 'bbbb111' } }, 2)
  assert.deepEqual(outcomesIn(rejected.calls, 'review:r2:code').map(o => [o.id, o.outcome, o.argument]), [['R1-code-1', 'rejected', 'ARG'], ['R1-code-2', 'rejected', 'ARG']])
})

test('GR04: a finding without a file or symbol gets one retry with the errors; one still without stays alone and is logged', async () => {
  const noFile = placed({ symbol: 'x' }, 'p', 'f')
  const { result, calls } = await runCore({ 'review:r1:code': lensSaid(noFile), 'review:r1:code:retry': lensSaid(placed(ANCHOR, 'p', 'f')) })
  assert.match(prompt(calls, 'review:r1:code:retry'), /findings\[0\]\.where: file missing/)
  assert.deepEqual(result.leftover_findings.map(f => f.id), ['R1-code-1'])
  const noSymbol = placed({ file: ANCHOR.file, symbol: '' }, 'r', 'f')
  assert.match(prompt((await runCore({ 'review:r1:code': lensSaid(noSymbol), 'review:r1:code:retry': lensSaid(noSymbol) })).calls, 'review:r1:code:retry'), /findings\[0\]\.where\.symbol: .* does not match/)
  const noFile2 = placed({ symbol: ANCHOR.symbol }, 'p2', 'f')
  const unplaced = lensSaid(noFile, placed(ANCHOR, 'q', 'f'), noFile2)
  const still = await runCore({ 'review:r1:code': unplaced, 'review:r1:code:retry': unplaced })
  assert.deepEqual(still.result.leftover_findings.map(f => f.ids || f.id), ['R1-code-1', 'R1-code-2', 'R1-code-3'], 'each unplaced finding alone, by its id')
  assert.deepEqual(still.result.failures, [])
  assert.ok(still.logs.some(l => /R1-code: findings without a place, each kept alone: .*file missing/.test(l)), still.logs.join('\n'))
  assert.ok(!called((await runCore({ 'review:r1:code': lensSaid(placed(ANCHOR, 'q', 'f')) })).calls, 'review:r1:code:retry'))
})

// The start skill's fast-forward rule (result.md): an item blocks when its severity is major or its status unmet.
const blocking = result => result.leftover_findings.filter(f => f.severity === 'major' || f.status === 'unmet')

test('GR05: a leftover group carries its members\' ids and the highest severity, so grouped majors block', async () => {
  const minor = Object.assign(placed(ANCHOR, 'p2', 'f2'), { severity: 'minor' })
  const { result } = await runCore({ 'review:r1:checklist': { verdict: 'findings', checked: [row('R1', { status: 'met' })], findings: [placed(ANCHOR, 'p1', 'f1')] },
    'review:r1:code': lensSaid(placed(ANCHOR, 'p3', 'f3')) })
  assert.deepEqual(result.leftover_findings.map(f => [f.ids, f.severity]), [[['R1-checklist-1', 'R1-code-1'], 'major']])
  assert.equal(blocking(result).length, 1)
  const mixed = await runCore({ 'review:r1:code': lensSaid(minor, placed(ANCHOR, 'p3', 'f3')), 'fix:r1': applied('R1-code-1', 'cccc222') }, 2)
  assert.deepEqual(sentTo(mixed.calls, 'fix:r1').map(f => [f.ids, f.severity]), [[['R1-code-2', 'R1-code-1'], 'major']])
})
