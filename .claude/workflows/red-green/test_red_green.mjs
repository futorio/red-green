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
const finding = (severity, where, trigger) => ({ severity, where, trigger, problem: 'p', consequence: 'c', fix: 'f' })
// A mutant aimed at case C<i>, its first hunk at src/a.cpp line 10 + i; a mutation step's result of some.
const PATCH = i => `diff --git a/src/a.cpp b/src/a.cpp\n--- a/src/a.cpp\n+++ b/src/a.cpp\n@@ -${10 + i},3 +${10 + i},3 @@\n ctx\n-before${i}\n+after${i}\n ctx\n`
const mutant = (i, status) => ({ target: `C${i}`, patch: PATCH(i), status: status || 'survived' })
const step = (...ms) => ({ applies: true, ran: true, mutants: ms })
const MUT = { build: 'BUILD-CMD', test: 'TEST-CMD' }
const TESTS = [{ name: 'tests', command: 'npm test' }]
// Args whose profile declares these gates (TESTS unless given; null: none) and mutation commands (MUT unless given;
// null: no mutation block), with these block configs over them and the other profile fields as given.
const withProfile = ({ gates = TESTS, mutation = MUT, blocks = {}, ...rest } = {}) => ({ profile: Object.assign(rest, { blocks: Object.assign({}, blocks, {
  gates: Object.assign(gates ? { gates } : {}, blocks.gates) }, (mutation || blocks.mutation) && { mutation: Object.assign({}, mutation, blocks.mutation) }) }) })
const withBlocks = blocks => withProfile({ blocks })
const fact = (kind, where, ...requirements) => ({ kind, fact: `FACT-${requirements.join('-')}`, where, requirements })
const harness = (requirement, by) => ({ requirement, by: by || 'test', how: 'h' })
const gate = (name, status, line) => ({ name, status, line })
const check = (ref, extra) => Object.assign({ kind: 'case', ref, requirement: 'R1', test: { file: 'f', name: 't' } }, extra)
const gatesAt = (head, ...rows) => ({ head, gates: rows.length ? rows : [gate('tests', 'green', '17 of 17')] })

// The recorded results of one clean round and its mutation step; a case overrides the labels it is about.
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
    mutation: step(),
    'fix:r1': { applied: [], rejected: [], head: 'bbbb111' },
    'fix:minor': { applied: [], rejected: [], head: 'bbbb111' },
    'review:fix:r1': clean([row('x')]),
    'review:fix:r1:1': clean([row('x')]),
    'review:fix:r2': clean([row('x')]),
    'review:fix:r3': clean([row('x')]),
    'gates:r1:recheck': gatesAt('cccc222'),
    'gates:r2:recheck': gatesAt('cccc222'),
  }, over)
}

// Runs the core. results[label] is a value, or a function of (call) returning one; null is a dead agent.
// rounds: profile.blocks.review.rounds, 1 when not given, the default when 'default'; extra: more args, whose
// profile.blocks merge over that.
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
  const args = { repo: '/r', branch: 'b', tools: '/t', run: '/run', base: 'aaaa000', target: '/t.md', baseline: { tests: '17 of 17' }, profile: withProfile().profile }
  Object.assign(args, extra)
  const blocks = Object.assign({}, args.profile.blocks)
  blocks.review = Object.assign(rounds === 'default' ? {} : { rounds: rounds || 1 }, blocks.review)
  args.profile = Object.assign({}, args.profile, { blocks })
  const result = await core(args, agent, parallel, () => {}, () => {})
  return { result, calls, events }
}

const prompt = (calls, label) => calls.find(c => c.label === label).prompt
const called = (calls, label) => calls.some(c => c.label === label)
const count = (calls, label) => calls.filter(c => c.label === label).length
const withIds = (xs, id) => xs.filter(x => x.id === id)
const major = { verdict: 'findings', checked: [row('x')], findings: [finding('major', 'a:1', 't')] }
const mutants = (...ids) => step(...ids.map(i => mutant(i)))
const sentTo = (calls, label) => JSON.parse(prompt(calls, label).split('FINDINGS:\n')[1].split('\n\nRESEARCH:')[0])

test('W01: a survivor is a major M-<n> placed by its first hunk header that reaches fix; killed and invalid ones make no finding', async () => {
  const { result, calls } = await runCore({
    mutation: step(mutant(1, 'killed'), mutant(2, 'invalid'), mutant(3)),
    'fix:r1': { applied: [], rejected: [{ id: 'M-3', argument: 'a' }], head: 'bbbb111' },
  })
  const sent = sentTo(calls, 'fix:r1')
  assert.deepEqual(sent.map(f => [f.id, f.source, f.severity, f.where]), [['M-3', 'mutation', 'major', 'src/a.cpp:13']])
  assert.match(sent[0].problem, /C3/)
  assert.equal(sent[0].trigger, PATCH(3))
  assert.match(sent[0].fix, /reject/)
  assert.equal(result.advisory.filter(f => f.source === 'mutation').length, 0)
})

test('W02: the mutation schema is {applies, ran, not_run?, mutants: [{target, patch, status}]}', async () => {
  const { calls } = await runCore({})
  const s = calls.find(c => c.label === 'mutation').opts.schema
  assert.deepEqual(Object.keys(s.properties), ['applies', 'ran', 'not_run', 'mutants', 'mailbox'])
  assert.deepEqual(s.required, ['applies', 'ran', 'mutants'])
  const item = s.properties.mutants.items
  assert.deepEqual(Object.keys(item.properties), ['target', 'patch', 'status'])
  assert.deepEqual(item.required, ['target', 'patch', 'status'])
  assert.deepEqual(item.properties.status.enum, ['killed', 'survived', 'invalid', 'not_run'])
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
const twoGates = { profile: withProfile({ gates: [{ name: 'A', command: 'make a' }, { name: 'B', command: 'make b' }] }).profile, baseline: { A: 'A-BASE 3 of 3', B: 'B-BASE ok' } }

test('W04: the lens prompts carry each gate as name, status and line; the checklist job carries the scope sentence', async () => {
  const { calls } = await runCore({ 'gates:r1': gatesAt('bbbb111', gate('A', 'green', 'GATE-SENTINEL 3 of 3'), gate('B', 'green', 'B ok')) }, 1, twoGates)
  for (const label of ['review:r1:checklist', 'review:r1:code']) {
    assert.ok(prompt(calls, label).includes('A: green — GATE-SENTINEL 3 of 3\nB: green — B ok'), label)
    assert.ok(!/re-check the scope/.test(prompt(calls, label)), label)
  }
  assert.match(prompt(calls, 'review:r1:checklist'), /Scope: a change the statement does not call for is a finding\./)
  assert.ok(!/does not call for/.test(prompt(calls, 'review:r1:code')))
})

test('W05: a red gate is one major finding made by the script; on the recheck it is left over, a green gate makes none', async () => {
  const { result, calls } = await runCore({
    'gates:r1': gatesAt('bbbb111', gate('A', 'red', 'A-RED 2 of 3'), gate('B', 'green', 'B ok')),
    'fix:r1': { applied: [{ id: 'G1-A', what: 'w' }], rejected: [], head: 'cccc222' },
    'gates:r1:recheck': gatesAt('cccc222', gate('A', 'red', 'A-STILL-RED 1 of 3'), gate('B', 'green', 'B ok')),
    mutation: step(),
  }, 1, twoGates)
  const sent = sentTo(calls, 'fix:r1')
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
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], head: 'cccc222' },
    'gates:r2': gatesAt('cccc222'),
    mutation: step(),
  }, 2)
  const second = prompt(calls, 'gates:r2')
  assert.ok(!/already ran at|git diff --name-only|docs only|tests only/.test(second))
  assert.equal(second.replace(/cccc222/g, 'H').replace(/gates:r2/g, 'L'), prompt(calls, 'gates:r1').replace(/bbbb111/g, 'H').replace(/gates:r1/g, 'L'))
})

test('W49: the gates step names every declared gate with its command and baseline, and its schema takes only their names', async () => {
  const { calls } = await runCore({ 'gates:r1': gatesAt('bbbb111', gate('A', 'green', 'a'), gate('B', 'green', 'b')) }, 1, twoGates)
  const call = calls.find(c => c.label === 'gates:r1')
  const stage = call.prompt.split('STAGE: gates')[1].split('MAILBOX')[0]
  for (const s of ['A: `make a` (baseline: A-BASE 3 of 3)', 'B: `make b` (baseline: B-BASE ok)']) assert.ok(stage.includes(s), s)
  assert.ok(prompt(calls, 'implement').includes('A: `make a` (baseline: A-BASE 3 of 3)'))
  const item = call.opts.schema.properties.gates.items
  assert.deepEqual(item.properties.name.enum, ['A', 'B'])
  assert.deepEqual(item.properties.status.enum, ['green', 'red', 'not_run'])
  assert.deepEqual(Object.keys(call.opts.schema.properties), ['head', 'gates', 'notes', 'mailbox'])
  assert.match(stage, /to completion/)
  assert.match(stage, /run_in_background/)
  for (const w of [/scope/i, /recount/i, /changed_files/, /git diff/, /SEVERITY/, /blocker/, /already ran at/, /mutation/i, /reviewers/, /cut a gate short/]) assert.ok(!w.test(stage), String(w))
  for (const s of ['COMMITS', 'Gates:', 'Over-built']) assert.ok(!call.prompt.includes(s), s)
})

// The writers' gates line: the fast and slow lists when both kinds exist, one list otherwise, and when to run them.
const gatesLine = (calls, label) => prompt(calls, label).split('\n').find(l => l.startsWith('- Gates'))
const marked = (a, b) => ({ profile: withProfile({ gates: [Object.assign({ name: 'A', command: 'make a' }, a !== undefined && { fast: a }),
  Object.assign({ name: 'B', command: 'make b' }, b !== undefined && { fast: b })] }).profile, baseline: twoGates.baseline })
const fixed = { 'review:r1:code': { verdict: 'findings', findings: [finding('major', 'a.js:1', 't')], checked: [row('x')] },
  'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], head: 'cccc222' }, 'gates:r1:recheck': gatesAt('cccc222', gate('A', 'green', 'a'), gate('B', 'green', 'b')) }
const AB = { 'gates:r1': gatesAt('bbbb111', gate('A', 'green', 'a'), gate('B', 'green', 'b')) }

test('W108: with fast and slow gates, implement and fix get both lists and run the fast ones each cycle, every gate before a commit; the result keeps the marks', async () => {
  const { calls, result } = await runCore(Object.assign({}, AB, fixed), 1, marked(true))
  assert.deepEqual(result.gates, [{ name: 'A', command: 'make a', fast: true }, { name: 'B', command: 'make b' }])
  for (const label of ['implement', 'fix:r1']) {
    assert.equal(gatesLine(calls, label), '- Gates, fast: A: `make a` (baseline: A-BASE 3 of 3); slow: B: `make b` (baseline: B-BASE ok). Run the fast gates after each TDD cycle and every gate once before each commit. Each baseline was measured before the run (re-measure, never quote). "Green" means no gate worse than its baseline.', label)
  }
  const stage = prompt(calls, 'gates:r1').split('STAGE: gates')[1]
  for (const s of ['A: `make a` (baseline: A-BASE 3 of 3)', 'B: `make b` (baseline: B-BASE ok)']) assert.ok(stage.includes(s), s)
  assert.ok(!/fast/.test(stage))
})

test('W109: with one kind of gate the writers get one list; the fast rule appears only when a gate is fast', async () => {
  const lines = async gates => { const { calls } = await runCore(Object.assign({}, AB, fixed), 1, gates); return ['implement', 'fix:r1'].map(l => gatesLine(calls, l)) }
  const list = '- Gates: A: `make a` (baseline: A-BASE 3 of 3); B: `make b` (baseline: B-BASE ok). '
  const tail = ' Each baseline was measured before the run (re-measure, never quote). "Green" means no gate worse than its baseline.'
  const slow = `${list}Run every gate once before each commit.${tail}`
  assert.deepEqual(await lines(marked(false)), [slow, slow])
  assert.deepEqual(await lines(twoGates), [slow, slow])
  const fast = `${list}Run the gates after each TDD cycle and every gate once before each commit.${tail}`
  assert.deepEqual(await lines(marked(true, true)), [fast, fast])
})

test('W50: a not_run row and a declared gate with no row are each a major gates finding with the reason, not a failure', async () => {
  const { result, calls } = await runCore({
    'gates:r1': gatesAt('bbbb111', gate('A', 'not_run', 'NO-TIME cap hit')),
    'gates:r1:recheck': gatesAt('cccc222', gate('A', 'green', 'a'), gate('B', 'green', 'b')),
    'fix:r1': { applied: [{ id: 'G1-A', what: 'w' }, { id: 'G1-B', what: 'w' }], rejected: [], head: 'cccc222' },
  }, 1, twoGates)
  const sent = sentTo(calls, 'fix:r1')
  assert.deepEqual(sent.map(f => [f.id, f.source, f.severity, f.where]), [['G1-A', 'gates', 'major', 'A'], ['G1-B', 'gates', 'major', 'B']])
  assert.match(sent[0].problem, /NO-TIME cap hit/)
  assert.match(sent[1].problem, /no row/)
  assert.equal(result.failures.filter(f => /gates/.test(f)).length, 0)
})

test('W111: a dead gates step is a failure, not a finding per gate', async () => {
  const { result } = await runCore({ 'gates:r1': null }, 1, twoGates)
  assert.equal(result.failures.filter(f => /gates gates:r1/.test(f)).length, 1)
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
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], head: 'cccc222' },
    'gates:r1:recheck': gatesAt('cccc222', gate('tests', 'green', 'RECHECK 17 of 17')),
    mutation: step(),
  })
  assert.deepEqual(result.rounds[0].gates, [gate('tests', 'green', '17 of 17')])
  assert.deepEqual(result.rounds[0].recheck, [gate('tests', 'green', 'RECHECK 17 of 17')])
})

test('W15: a fix that leaves HEAD alone reuses the gates result', async () => {
  const { calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], head: 'bbbb111' },
  }, 2)
  assert.ok(called(calls, 'review:r2:code'))
  assert.ok(!called(calls, 'gates:r2'))
})

test('W16: a run with survivors makes no ruling call; the fix alone may reject one', async () => {
  const { calls } = await runCore({
    mutation: mutants(1),
    'fix:r1': { applied: [], rejected: [{ id: 'M-1', argument: 'equivalent' }], head: 'bbbb111' },
  })
  assert.ok(called(calls, 'fix:r1'))
  assert.deepEqual(calls.map(c => c.label).filter(l => /survivor|rul/.test(l)), [])
})

test('W77: the generator gets the tested checks and the runner with the build, test and timeout; model models.mutation, haiku by default', async () => {
  const implement = Object.assign({}, base().implement, { checks: [check('C1', { test: { file: 'TESTED-FILE', name: 'TESTED-NAME' } }), check('"UNTESTED PHRASE"', { kind: 'phrase', test: undefined, unverified: 'no tool' }), check('C2', { test: { file: 'FLAKY-FILE', name: 'n' }, unverified: 'flaky' })] })
  const { calls } = await runCore({ implement }, 1, withProfile({ mutation: { build: "make 'b'", test: 'TEST-CMD', timeout: 7 } }))
  const call = calls.find(c => c.label === 'mutation')
  assert.equal(call.opts.model, 'haiku')
  assert.equal(call.opts.effort, 'medium')
  assert.ok(call.prompt.includes('node /t/.claude/workflows/red-green/skills/mutate.mjs --mutants /run/mutants.json --repo /r --head bbbb111 --dir /run --test \'TEST-CMD\' --build \'make \'\\\'\'b\'\\\'\'\' --timeout 7'))
  assert.match(call.prompt, /TESTED-FILE/)
  assert.ok(!/UNTESTED PHRASE|FLAKY-FILE/.test(call.prompt))
  assert.match(call.prompt, /at most 5 on edges/)
  assert.match(call.prompt, /git diff aaaa000\.\.HEAD/)
  assert.match(call.prompt, /\/t\.md/)
  assert.equal((await runCore({}, 1, withBlocks({ mutation: { model: 'sonnet' } }))).calls.find(c => c.label === 'mutation').opts.model, 'sonnet')
})

test('W78: the plug-in form puts the profile\'s tool text in the prompt and no runner or checks', async () => {
  const { calls } = await runCore({}, 1, withProfile({ mutation: { tool: 'PLUGIN-TOOL-TEXT' } }))
  const p = prompt(calls, 'mutation')
  assert.match(p, /PLUGIN-TOOL-TEXT/)
  assert.match(p, /`operator`/)
  assert.ok(!/`target` the check ref/.test(p))
  assert.ok(!/mutate\.mjs|CHECKS/.test(p))
})

test('W79: the result\'s mutation holds every mutant with id, place, patch and status, and counts by status', async () => {
  const { result } = await runCore({
    mutation: step(mutant(1, 'killed'), mutant(2, 'invalid'), mutant(3), mutant(4, 'killed')),
    'fix:r1': { applied: [], rejected: [{ id: 'M-3', argument: 'a' }], head: 'bbbb111' },
  })
  assert.deepEqual(result.mutation, {
    mutants: [[1, 'killed'], [2, 'invalid'], [3, 'survived'], [4, 'killed']].map(([i, status]) => ({ id: `M-${i}`, target: `C${i}`, file: 'src/a.cpp', line: 10 + i, patch: PATCH(i), status })),
    counts: { killed: 2, survived: 1, invalid: 1, not_run: 0 },
  })
  assert.equal((await runCore({ mutation: { applies: false, ran: false, mutants: [] } })).result.mutation, null)
  const none = await runCore({}, 1, withProfile({ mutation: null }))
  assert.ok(!called(none.calls, 'mutation'))
  assert.equal(none.result.mutation, null)
  assert.equal(none.result.status, 'done')
})

test('W80: a mutant\'s file is its patch\'s +++ side, the --- side when that is /dev/null, without a timestamp', async () => {
  const at = (from, to, line) => ({ target: 'C1', patch: `--- ${from}\t2026-01-01 00:00:00\n+++ ${to}\t2026-01-02 00:00:00\n@@ -${line},1 +${line},1 @@\n-a\n+b\n`, status: 'killed' })
  const { result } = await runCore({ mutation: step(at('a/old.cpp', 'b/new.cpp', 5), at('a/gone.cpp', '/dev/null', 1)) })
  assert.deepEqual(result.mutation.mutants.map(m => [m.file, m.line]), [['new.cpp', 5], ['gone.cpp', 1]])
})

test('W81: blocks.mutation given with neither test nor tool, with a build and no test, or a tool beside test or build, fails the run before any agent', async () => {
  for (const mutation of [{}, { timeout: 9 }, { edges: 3 }, { build: 'B' }, { tool: 'T', test: 'X' }, { tool: 'T', build: 'B' }]) {
    const { result, calls } = await runCore({}, 1, withProfile({ mutation }))
    assert.equal(calls.length, 0, JSON.stringify(mutation))
    assert.equal(result.stage, 'config')
    assert.match(result.note, /blocks\.mutation/)
  }
})

test('W24: the mutation step runs once, in its own step after a clean round, never in a gates step', async () => {
  const { calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], head: 'cccc222' },
    'gates:r2': gatesAt('cccc222'),
    mutation: step(),
  }, 2)
  assert.equal(count(calls, 'mutation'), 1)
  assert.match(prompt(calls, 'mutation'), /--head cccc222 /)
  assert.match(prompt(calls, 'mutation'), /TEST-CMD/)
  for (const label of ['gates:r1', 'gates:r2']) assert.ok(!/TEST-CMD|mutate\.mjs/.test(prompt(calls, label)), label)
  const order = calls.map(c => c.label)
  assert.ok(order.indexOf('mutation') > order.indexOf('review:r2:code'))
})

test('W25: survivors get a fix and one more round without the tool, past the planned rounds', async () => {
  const { result, calls } = await runCore({
    mutation: mutants(1),
    'fix:r1': { applied: [{ id: 'M-1', what: 'w' }], rejected: [], head: 'cccc222' },
    'gates:r2': gatesAt('cccc222'),
  }, 1)
  assert.ok(called(calls, 'review:r2:code'))
  assert.equal(count(calls, 'mutation'), 1)
  assert.equal(result.rounds_run, 2)
  assert.deepEqual(result.leftover_findings, [])
})

test('W26: a run that ends without a clean round still runs the step once, and every survivor is left over', async () => {
  const keep = { applied: [], rejected: [{ id: 'R1-code-1', argument: 'a' }], head: 'bbbb111' }
  const { result, calls } = await runCore({
    'review:r1:code': major, 'fix:r1': keep,
    mutation: step(mutant(1), mutant(2), mutant(3, 'killed')),
  })
  assert.equal(count(calls, 'mutation'), 1)
  assert.equal(count(calls, 'fix:r1'), 1)
  assert.deepEqual(result.leftover_findings.filter(f => f.source === 'mutation').map(f => f.id), ['M-1', 'M-2'])
  assert.deepEqual(result.advisory.filter(f => f.source === 'mutation'), [])
})

test('W27: a dead fix stops the run before the tool', async () => {
  const { calls } = await runCore({ 'review:r1:code': major, 'fix:r1': null })
  assert.ok(!called(calls, 'mutation'))
})

test('W07: a lens major without a trigger becomes a minor and is not fixed', async () => {
  const { result, calls } = await runCore({
    'review:r1:code': { verdict: 'findings', checked: [row('x')], findings: [finding('major', 'x.js:1', '')] },
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
    'review:r1:code': { verdict: 'findings', checked: [row('x')], findings: ['m1', 'm2', 'm3'].map(w => finding('minor', w, 't')) },
  })
  assert.equal(result.advisory.filter(f => f.source === 'code').length, 2)
  assert.deepEqual(result.advisory.map(f => f.where).sort(), ['m1', 'm2'])
})

test('W09: an unmet requirement goes to fix as a major, unmet and unrowed ones end in the leftover', async () => {
  const { result, calls } = await runCore({
    research: Object.assign({}, base().research, { requirements: ['R1: one', 'R2: two', 'R3: three'], test_harness: [harness('R1'), harness('R2', 'review'), harness('R3', 'review')] }),
    'review:r1:checklist': { verdict: 'findings', findings: [], checked: [row('R1', { status: 'met' }), row('R2', { status: 'unmet', promise: 'p', counterexample: 'c', evidence: 'clause x fails' })] },
    'fix:r1': { applied: [{ id: 'R1-R2', what: 'w' }], rejected: [], head: 'bbbb111' },
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

test('W18: a dead mutation step, one that did not run, a not_run mutant or a dead gates step is a failure; applies false is not', async () => {
  assert.equal((await runCore({ mutation: null })).result.status, 'done_with_failures')
  const notRun = await runCore({ mutation: { applies: true, ran: false, not_run: 'NO-NODE', mutants: [] } })
  assert.equal(notRun.result.status, 'done_with_failures')
  assert.ok(notRun.result.failures.some(f => /NO-NODE/.test(f)))
  const bad = await runCore({ mutation: step(mutant(1, 'killed'), mutant(2, 'not_run')) })
  assert.equal(bad.result.status, 'done_with_failures')
  assert.equal(bad.result.failures.filter(f => /mutation/.test(f)).length, 1)
  assert.match(bad.result.failures.find(f => /mutation/.test(f)), /M-2/)
  assert.equal((await runCore({ mutation: { applies: false, ran: false, mutants: [] } })).result.status, 'done')
  const noGates = await runCore({ 'gates:r1': null })
  assert.equal(noGates.result.status, 'done_with_failures')
})

test('W19: id-only rejections and a gate red again with a new line each stay one finding', async () => {
  const { result } = await runCore({
    'gates:r1': gatesAt('bbbb111', gate('tests', 'red', 'RED 1')),
    'fix:r1': { applied: [], rejected: [{ id: 'G1-tests', argument: 'a' }, { id: 'Z1', argument: 'a' }, { id: 'Z2', argument: 'a' }], head: 'cccc222' },
    'gates:r1:recheck': gatesAt('cccc222', gate('tests', 'red', 'RED 2')),
    mutation: step(),
  })
  assert.deepEqual(['Z1', 'Z2'].map(id => withIds(result.leftover_findings, id).length), [1, 1])
  assert.equal(result.leftover_findings.filter(f => f.source === 'gates').length, 2)
  const ids = result.leftover_findings.map(f => f.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('W22: a survivor the fix rejected without moving HEAD is not sent to fix again', async () => {
  const { calls } = await runCore({
    mutation: mutants(1),
    'fix:r1': { applied: [], rejected: [{ id: 'M-1', argument: 'a' }], head: 'bbbb111' },
    'fix:r2': { applied: [], rejected: [], head: 'bbbb111' },
  })
  assert.ok(!called(calls, 'fix:r2'))
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

test('W28: with review.extra, a major fixed in the last planned round gets one more full round', async () => {
  const { result, calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], head: 'cccc222' },
    'gates:r2': gatesAt('cccc222'),
    mutation: step(),
  }, 1, withBlocks({ review: { extra: 1 } }))
  assert.ok(called(calls, 'review:r2:code'))
  assert.equal(result.rounds_run, 2)
  assert.deepEqual(result.leftover_findings, [])
})

test('W29: with review.extra, a major still found in the extra round is fixed and its fix gets a fix-diff review', async () => {
  const again = { verdict: 'findings', checked: [row('x')], findings: [finding('major', 'a:2', 't')] }
  const { result, calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], head: 'cccc222' },
    'gates:r2': gatesAt('cccc222'),
    'review:r2:code': again,
    'fix:r2': { applied: [{ id: 'R2-code-1', what: 'w' }], rejected: [], head: 'dddd333' },
    'gates:r2:recheck': gatesAt('dddd333'),
    mutation: step(),
  }, 1, withBlocks({ review: { extra: 1 } }))
  assert.ok(!called(calls, 'review:r3:code'))
  assert.match(prompt(calls, 'review:fix:r2'), /git diff cccc222\.\.HEAD/)
  assert.deepEqual(withIds(result.leftover_findings, 'R2-code-1'), [])
})

test('W30: minors go to one cheap fixer; applied ones leave advisory, rejected ones stay', async () => {
  const minors = { verdict: 'findings', checked: [row('x')], findings: [finding('minor', 'a:1', 't1'), finding('minor', 'a:2', 't2')] }
  const { result, calls } = await runCore({
    'review:r1:code': minors,
    'fix:minor': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [{ id: 'R1-code-2', argument: 'a' }], head: 'cccc222' },
  })
  const call = calls.find(c => c.label === 'fix:minor')
  assert.equal(call.opts.model, 'sonnet')
  assert.deepEqual(result.advisory.map(f => f.id).sort(), ['R1-code-2'])
  assert.deepEqual(result.minor_fixes.applied.map(a => a.id), ['R1-code-1'])
})

test('W31: no minors calls no minor fixer; a dead one is a failure', async () => {
  assert.ok(!called((await runCore({})).calls, 'fix:minor'))
  const minor = { verdict: 'findings', checked: [row('x')], findings: [finding('minor', 'a:1', 't1')] }
  assert.equal((await runCore({ 'review:r1:code': minor, 'fix:minor': null })).result.status, 'done_with_failures')
})

test('W32: with default rounds a run plans, reviews two full rounds with both lenses, then runs the mutation tool', async () => {
  const { result, calls } = await runCore({}, 'default')
  assert.equal(result.rounds_planned, 2)
  assert.ok(called(calls, 'plan') && called(calls, 'review:r2:checklist') && called(calls, 'review:r2:code') && called(calls, 'mutation'))
  assert.match(prompt(calls, 'review:r1:code'), /Start from the change-site facts/)
})

test('W33: the last round\'s fix gets a fix-diff review; its major is fixed and reviewed once more, then left over', async () => {
  const late = { verdict: 'findings', checked: [row('x')], findings: [finding('major', 'b:1', 't')] }
  const { result, calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], head: 'cccc222' },
    'review:fix:r1': late,
    'fix:r1:review': { applied: [{ id: 'F1-1', what: 'w' }], rejected: [], head: 'dddd333' },
    'review:fix:r1:1': late,
    'gates:r1:recheck': gatesAt('dddd333'),
    mutation: step(),
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
  for (const s of ['COMMITS', 'Gates:', 'run_in_background', 'or commit']) {
    assert.ok(!research.prompt.includes(s), s)
    assert.ok(prompt(calls, 'implement').includes(s), s)
  }
  for (const c of calls) assert.ok(!c.prompt.includes('research.md'), c.label)
})

test('W34: a minor fix that moves HEAD calls no fix-diff review', async () => {
  const minorOnly = { verdict: 'findings', checked: [row('x')], findings: [finding('minor', 'c:1', '')] }
  const { result, calls } = await runCore({
    'review:r1:code': minorOnly,
    'fix:minor': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], head: 'eeee444' },
  })
  assert.ok(called(calls, 'fix:minor'))
  assert.ok(!calls.some(c => c.label.startsWith('review:fix')))
  assert.match(prompt(calls, 'fix:minor'), /CONTRACT[^]*Commit only with no gate worse than before your edit\. If one is, revert your edits and reject every finding\./)
  assert.equal(prompt(calls, 'fix:minor').split('worse than before your edit').length, 2, 'the gate bar has one source')
  assert.equal(result.status, 'done')
})

test('W57: severity is major|minor, and no review prompt or round counter mentions blocker', async () => {
  const { result, calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], head: 'cccc222' },
    mutation: mutants(1),
  })
  const reviews = calls.filter(c => c.label.startsWith('review:'))
  assert.deepEqual(reviews.map(c => c.label).sort(), ['review:fix:r1', 'review:r1:checklist', 'review:r1:code'])
  for (const c of reviews) assert.ok(!/blocker/i.test(c.prompt), c.label)
  for (const l of ['review:r1:code', 'review:fix:r1']) assert.deepEqual(calls.find(c => c.label === l).opts.schema.properties.findings.items.properties.severity.enum, ['major', 'minor'])
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
  assert.deepEqual(past, [{ id: 'R1-code-1', round: 1, where: 'a:1', problem: 'p', outcome: 'rejected', argument: 'ARGUMENT-TEXT' }])
  assert.match(second, /re-raise a rejected one only as a finding whose `problem` answers its `argument`/)
  assert.ok(!/REJECTED|insist/.test(second))
  assert.ok(!('accepted_rejections' in result))
})

test('W59: lenses and fix-diff reviews get the no-code preamble; the code lens may write proofs', async () => {
  const { calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], head: 'cccc222' },
    mutation: mutants(1),
  })
  // gates:r1 has the no-code preamble and, like the reviews, a notes field.
  const pre = prompt(calls, 'gates:r1').split('\n\nSTAGE:')[0]
  for (const l of ['review:r1:checklist', 'review:r1:code', 'review:fix:r1']) {
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
  })
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
  })
  assert.deepEqual(result.stray_proofs, [])
  assert.equal(result.status, 'done')
})

test('W64: a proof on a minor goes to the minor fixer to delete; a stray from a round fix does not skip the minor fix', async () => {
  const minorProof = { verdict: 'findings', checked: [row('x')], findings: [Object.assign(finding('major', 'a:1', ''), { proof })] }
  const kept = await runCore({
    'review:r1:code': minorProof,
    'fix:minor': { applied: [], rejected: [{ id: 'R1-code-1', argument: 'a' }], proofs: [{ id: 'R1-code-1', path: proof.path, outcome: 'deleted' }], head: 'bbbb111' },
  })
  assert.match(prompt(kept.calls, 'fix:minor'), /Delete the file of every finding with a `proof`/)
  assert.deepEqual(kept.result.stray_proofs, [])
  assert.equal(kept.result.status, 'done')
  const both = { verdict: 'findings', checked: [row('x')], findings: [Object.assign(finding('major', 'a:1', 't'), { proof }), finding('minor', 'b:1', '')] }
  const leaked = await runCore({
    'review:r1:code': both,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], proofs: [], head: 'cccc222' },
  })
  assert.ok(called(leaked.calls, 'fix:minor'))
  assert.deepEqual(leaked.result.stray_proofs, [{ id: 'R1-code-1', path: proof.path }])
  assert.equal(leaked.result.status, 'done_with_failures')
})

test('W62: a proof the fix does not account for, or whose fix died, is a stray and a failure', async () => {
  const omitted = await runCore({
    'review:r1:code': proven,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], proofs: [], head: 'cccc222' },
  })
  assert.deepEqual(omitted.result.stray_proofs, [{ id: 'R1-code-1', path: proof.path }])
  assert.equal(omitted.result.failures.filter(f => f.includes(proof.path)).length, 1)
  assert.equal(omitted.result.status, 'done_with_failures')
  const dead = await runCore({ 'review:r1:code': proven, 'fix:r1': null })
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

// A profile without gates, and what the discovery step finds.
const noGates = Object.assign(withProfile({ gates: null }), { baseline: 'ignored' })
const discovered = (over) => Object.assign({
  gates: [{ name: 'lint', command: 'npm run lint', source: 'AGENTS.md', line: 'LINT-BASE 0 errors', fast: true }, { name: 'test', command: 'npm test', source: 'AGENTS.md', line: 'TEST-BASE 9 of 9', fast: false }],
  questions: [],
}, over)

test('W53: with no profile.gates the discovery step runs first, and its gates and lines drive the gates step and the preamble', async () => {
  const q = { command: 'npm run e2e', source: 'AGENTS.md', question: 'needs a browser: a gate?' }
  const { result, calls } = await runCore({
    'gates:discover': discovered({ questions: [q, Object.assign({}, q, { source: 'Makefile' })] }),
    'gates:r1': gatesAt('bbbb111', gate('lint', 'green', 'l'), gate('test', 'green', 't')),
  }, 1, noGates)
  assert.deepEqual(calls.slice(0, 2).map(c => c.label), ['gates:discover', 'research'])
  const call = calls[0]
  assert.equal(call.opts.model, 'sonnet')
  assert.ok(call.prompt.includes('Where: the repo\'s agent instructions, then CI config, then the task runner; the first source that names gates wins. A gate: a command CI or those instructions require before a commit; runs with no human, network or secrets; pass/fail by exit code; writes nothing to the tree.'))
  for (const s of ['COMMITS', 'Gates:']) assert.ok(!call.prompt.includes(s), s)
  assert.match(call.prompt, /run_in_background/)
  assert.match(call.prompt, /`source` the source of the gate it bears on/)
  assert.match(call.prompt, /Run each gate exactly as its `command` reads, once, to completion; one that cannot run that way here is a question/)
  assert.deepEqual(Object.keys(call.opts.schema.properties.gates.items.properties), ['name', 'command', 'source', 'line', 'fast'])
  assert.deepEqual(call.opts.schema.properties.gates.items.required, ['name', 'command', 'source', 'line', 'fast'])
  const instructions = call.prompt.split('STAGE: gates discovery.')[1].split('MAILBOX')[0]
  assert.match(instructions, /A fast gate: a static check that reads the source without building it \(lint, format check, typecheck\); a build, a test suite, or a gate you are unsure of is slow\./)
  assert.deepEqual(Object.keys(call.opts.schema.properties.questions.items.properties), ['command', 'source', 'question'])
  assert.deepEqual(calls.find(c => c.label === 'gates:r1').opts.schema.properties.gates.items.properties.name.enum, ['lint', 'test'])
  assert.ok(prompt(calls, 'implement').includes('- Gates, fast: lint: `npm run lint` (baseline: LINT-BASE 0 errors); slow: test: `npm test` (baseline: TEST-BASE 9 of 9).'))
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
  // A project where no gate can run here: the questions saying why are the result.
  const q = { command: 'make check', source: 'AGENTS.md', question: 'make is not installed' }
  const { result } = await runCore({ 'gates:discover': discovered({ gates: [], questions: [q] }) }, 1, noGates)
  assert.deepEqual(result.gates_questions, [q])
})

test('W55: with profile.gates given no discovery step runs, and the result carries the declared gates and no questions', async () => {
  const { result, calls } = await runCore({})
  assert.ok(!called(calls, 'gates:discover'))
  assert.deepEqual(result.gates, [{ name: 'tests', command: 'npm test' }])
  assert.deepEqual(result.gates_questions, [])
})

test('W56: a gate named like an Object.prototype key still needs its own baseline entry', async () => {
  const { result, calls } = await runCore({}, 1, Object.assign(withProfile({ gates: [{ name: 'constructor', command: 'c' }] }), { baseline: {} }))
  assert.equal(calls.length, 0)
  assert.equal(result.status, 'failed')
})

test('W65: every review stage is read-only; the targeted run is every lens and the fix review; no empty or project text', async () => {
  const { calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], proofs: [], head: 'cccc222' },
    mutation: mutants(1),
  })
  for (const l of ['review:r1:checklist', 'review:r1:code', 'review:fix:r1']) assert.match(prompt(calls, l), /Read-only: change and commit nothing in \/r\./, l)
  for (const l of ['review:r1:checklist', 'review:r1:code', 'review:fix:r1']) assert.match(prompt(calls, l), /At most one targeted run of the changed path/, l)
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
    'fix:r1': { applied: [{ id: 'R1-R1', what: 'w' }], rejected: [], proofs: [], head: 'bbbb111' },
  })
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

test('W76: implement commits its work as it stands, a red gate going to the fix; fix keeps the green bar or commits nothing; the minor fix keeps the gates as it found them; one commit is created by implement', async () => {
  const minor = { verdict: 'findings', checked: [row('x')], findings: [finding('minor', 'm:1', 't')] }
  const { calls } = await runCore({ 'gates:r1': gatesAt('bbbb111', gate('tests', 'red', 'RED 1')), 'review:r2:code': minor,
    'fix:r1': { applied: [], rejected: [{ id: 'G1-tests', argument: 'tests still red' }], proofs: [], head: 'bbbb111' } }, 2)
  assert.match(prompt(calls, 'implement'), /Commit your work as it stands, even with a gate worse than its baseline/)
  assert.ok(!/Commit only with/.test(prompt(calls, 'implement')))
  assert.ok(prompt(calls, 'fix:r1').includes('Commit only with every gate at its baseline or better. If a gate stays worse than its baseline, revert your edits, report `head` unchanged and reject every finding, naming each such gate in its `argument`.'))
  assert.ok(prompt(calls, 'fix:minor').includes('Commit only with no gate worse than before your edit.'))
  assert.ok(!/baseline or better/.test(prompt(calls, 'fix:minor')))
  const one = await runCore({}, 1, { one_commit: true })
  assert.match(prompt(one.calls, 'implement'), /The implementation stage creates it/)
  assert.ok(!/leave it uncommitted/.test(prompt(one.calls, 'implement')))
})

test('W82: the fix schema holds only what the script reads: no committed, no gate_output', async () => {
  const { calls } = await runCore({ 'review:r1:code': major })
  const s = calls.find(c => c.label === 'fix:r1').opts.schema
  assert.deepEqual(Object.keys(s.properties), ['applied', 'rejected', 'proofs', 'head', 'mailbox'])
  assert.deepEqual(s.required, ['applied', 'rejected', 'proofs', 'head'])
})

test('W90: every fix output field is read by the script or reaches the result: emptying it changes the result', async () => {
  const lens = { verdict: 'findings', checked: [row('x')], findings: proven.findings.concat(finding('major', 'b:1', 't')) }
  const fix = { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [{ id: 'R1-code-2', argument: 'a' }], proofs: [{ id: 'R1-code-1', path: proof.path, outcome: 'deleted' }], head: 'cccc222' }
  const run = res => runCore({ 'review:r1:code': lens, 'fix:r1': res })
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
  const minor = { verdict: 'findings', checked: [row('x')], findings: [finding('minor', 'a:1', 't')] }
  const run = { 'review:r1:code': major, 'fix:r1': { applied: [], rejected: [{ id: 'R1-code-1', argument: 'a' }], proofs: [], head: 'cccc222' }, 'review:fix:r1': minor }
  const plain = (await runCore(run)).calls
  const want = { research: ['opus', 'high'], plan: ['opus', 'high'], implement: ['sonnet', 'high'], 'gates:r1': ['sonnet', 'medium'], 'review:r1:code': ['opus', 'high'],
    'fix:r1': ['sonnet', 'high'], 'review:fix:r1': ['opus', 'high'], mutation: ['haiku', 'medium'], 'fix:minor': ['sonnet', 'medium'] }
  for (const [l, w] of Object.entries(want)) assert.deepEqual(opts(plain, l), w, l)
  const { calls } = await runCore(run, 1, withBlocks({ research: { model: 'sonnet', effort: 'max' }, implement: { model: 'haiku' }, review: { effort: 'low' }, 'minor-fix': { model: 'opus' } }))
  assert.deepEqual(opts(calls, 'research'), ['sonnet', 'max'])
  assert.deepEqual(opts(calls, 'plan'), ['sonnet', 'high'])
  assert.deepEqual(opts(calls, 'fix:r1'), ['haiku', 'high'])
  assert.deepEqual(opts(calls, 'review:r1:code'), ['opus', 'low'])
  assert.deepEqual(opts(calls, 'review:fix:r1'), ['opus', 'high'])
  assert.deepEqual(opts(calls, 'fix:minor'), ['opus', 'medium'])
})

test('W84: the review rounds, extra and min rounds, the minors cap, the edge cap and the mutant timeout come from the block config', async () => {
  const three = (await runCore({}, 3)).result
  assert.deepEqual([three.rounds_planned, three.rounds_run], [3, 2])
  const once = (await runCore({}, 3, withBlocks({ review: { min: 1 } }))).result
  assert.equal(once.rounds_run, 1)
  const minors = { verdict: 'findings', checked: [row('x')], findings: ['m1', 'm2', 'm3'].map(w => finding('minor', w, 't')) }
  const capped = await runCore({ 'review:r1:code': minors }, 1, withBlocks({ review: { minors: 1 } }))
  assert.deepEqual(capped.result.advisory.map(f => f.where), ['m1'])
  assert.match(prompt(capped.calls, 'review:r1:code'), /report at most 1 minors/)
  assert.match(prompt((await runCore({})).calls, 'review:r1:code'), /report at most 2 minors/)
  const mut = (await runCore({}, 1, withBlocks({ mutation: { edges: 2, timeout: 60 } }))).calls
  assert.match(prompt(mut, 'mutation'), /at most 2 on edges/)
  assert.match(prompt(mut, 'mutation'), /--timeout 60`/)
  assert.match(prompt((await runCore({})).calls, 'mutation'), /--timeout 300`/)
})

test('W85: a removed arg, or a block, field, duty or lens the config does not know, fails the run before any agent', async () => {
  for (const extra of [{ models: { mutation: 'sonnet' } }, { rounds: 2 }, { extra_rounds: 1 }, { min_rounds: 1 },
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
  plan: [{ cases: base().plan.cases, questions: [] }, { required: { cases: [] }, enum: { cases: [Object.assign({}, base().plan.cases[0], { requirement: 'R9' })], questions: [] } }],
  implement: [base().implement, {
    anyOf: edit(base().implement, r => { delete r.checks[0].test }),
    enum: edit(base().implement, r => { r.checks[0].kind = 'other' }),
    required: edit(base().implement, r => { delete r.head }),
  }],
  'gates:r1': [gatesAt('h'), { enum: gatesAt('h', gate('tests', 'amber', 'l')), required: { gates: [] } }],
  'review:r1:checklist': [lensClean, { enum: clean([row('R1', { status: 'maybe', promise: 'p', counterexample: 'c' })]), required: clean([row('R1', { status: 'met' })]) }],
  'review:r1:code': [clean([row('x')]), { enum: { verdict: 'dirty', findings: [], checked: [] }, required: { verdict: 'clean', findings: [] } }],
  mutation: [step(mutant(1)), { enum: step(mutant(1, 'zombie')), required: { applies: true, mutants: [] } }],
  'fix:r1': [fixRes, { enum: edit(fixRes, r => { r.proofs = [{ id: 'a', path: 'p', outcome: 'kept' }] }), required: { applied: [], rejected: [], proofs: [] } }],
  'gates:discover': [discovered(), { required: { gates: [] } }],
}

test('V01: every agent schema of the core takes its valid sample and rejects an invalid one per keyword it uses', async () => {
  const { calls } = await runCore({
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], proofs: [], head: 'cccc222' },
  })
  calls.push(...(await runCore({ 'gates:discover': discovered() }, 1, noGates)).calls)
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

// A run that calls every block, each label once: discovery, replan, the implement retry, a fix and its fix-diff
// review with one more fix and review, the recheck, mutation and the minor fix.
const everyBlock = () => {
  const green = gatesAt('bbbb111', gate('lint', 'green', 'l'), gate('test', 'green', 't'))
  const late = { verdict: 'findings', checked: [row('x')], findings: [finding('major', 'b:1', 't'), finding('minor', 'c:1', 't')] }
  return runCore({
    'gates:discover': discovered(),
    research: research({ requirements: ['R1: one', 'R2: two'], test_harness: [harness('R1'), harness('R2')] }),
    replan: base().plan,
    implement: Object.assign({}, base().implement, { head: 'aaaa000' }), 'implement:retry': base().implement,
    'gates:r1': green,
    'review:r1:checklist': clean(['R1', 'R2'].map(id => row(id, { status: 'met', promise: 'p', counterexample: 'c' }))),
    'review:r1:code': major,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [], proofs: [], head: 'cccc222' },
    'review:fix:r1': late,
    'fix:r1:review': { applied: [{ id: 'F1-1', what: 'w' }], rejected: [], proofs: [], head: 'dddd333' },
    'review:fix:r1:1': clean([row('x')]),
    'gates:r1:recheck': Object.assign({}, green, { head: 'dddd333' }),
    'fix:minor': { applied: [], rejected: [{ id: 'F1-2', argument: 'a' }], proofs: [], head: 'dddd333' },
  }, 1, noGates)
}

test('W86: every block\'s filled input validates, and its contract part follows its instructions and precedes the mailbox note', async () => {
  const { result, calls } = await everyBlock()
  assert.deepEqual(calls.map(c => c.label), ['gates:discover', 'research', 'plan', 'replan', 'implement', 'implement:retry', 'gates:r1',
    'review:r1:checklist', 'review:r1:code', 'fix:r1', 'review:fix:r1', 'fix:r1:review', 'review:fix:r1:1', 'gates:r1:recheck', 'mutation', 'fix:minor'])
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
  const swapped = SOURCE.replace("'config.edges': edges,", "'config.edges': 'five',")
  assert.notEqual(swapped, SOURCE)
  core = coreOf(swapped)
  try {
    const typed = await runCore({})
    assert.ok(!called(typed.calls, 'mutation'))
    assert.deepEqual(typed.result.failures, ['mutation input: $.config.edges: string, not integer', 'mutation'])
  } finally { core = coreOf(SOURCE) }
})

test('W89: a block config value off its registry schema fails the run before any agent, naming the field', async () => {
  for (const [blocks, wrong] of [[{ review: { rounds: 'auto' } }, 'blocks.review.rounds'], [{ review: { rounds: '3' } }, 'blocks.review.rounds'],
    [{ review: { minors: '2' } }, 'blocks.review.minors'], [{ mutation: { timeout: 'x' } }, 'blocks.mutation.timeout'],
    [{ mutation: { edges: 'five' } }, 'blocks.mutation.edges'], [{ review: { lenses: 'code' } }, 'blocks.review.lenses'],
    [{ review: { lenses: ['mechanics'] } }, 'blocks.review.lenses[0]'], [{ review: { duties: { order: 'yes' } } }, 'blocks.review.duties.order'],
    [{ research: { model: 3 } }, 'blocks.research.model'], [{ gates: { effort: 2 } }, 'blocks.gates.effort'],
    [{ gates: { gates: [{ name: 'g' }] } }, 'blocks.gates.gates'], [{ mutation: { test: 7 } }, 'blocks.mutation.test'],
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
    1, withBlocks({ fix: { skill: '/p/fix.md' } }))
  const plain = await runCore({ 'review:r1:code': major, 'fix:r1': { applied: [], rejected: [{ id: 'R1-code-1', argument: 'a' }], proofs: [], head: 'bbbb111' } })
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

test('W94: the gates and mutation approaches are read from profile.blocks: declared gates or discovery, generated mutants or a tool', async () => {
  const declared = await runCore({}, 1, Object.assign(withProfile({ gates: [{ name: 'G', command: 'make g' }], mutation: { test: 'T-CMD', timeout: 9 } }), { baseline: { G: 'G-BASE' } }))
  assert.ok(!called(declared.calls, 'gates:discover'))
  assert.ok(prompt(declared.calls, 'implement').includes('G: `make g` (baseline: G-BASE)'))
  assert.ok(prompt(declared.calls, 'mutation').includes("--test 'T-CMD' --timeout 9`"))
  const found = await runCore({ 'gates:discover': discovered(), 'gates:r1': gatesAt('bbbb111', gate('lint', 'green', 'l'), gate('test', 'green', 't')) },
    1, withProfile({ gates: null, mutation: { tool: 'TOOL-TEXT' } }))
  assert.ok(called(found.calls, 'gates:discover'))
  assert.match(prompt(found.calls, 'mutation'), /TOOL-TEXT/)
})

test('W95: the removed profile strings and the moved profile fields fail the run before any agent, naming where they went', async () => {
  for (const [field, value, where] of [['research', 'text', /profile\.blocks\.research\.prompt as "\{\{default\}\}\\n<text>"/], ['runtime', 'text', /profile\.blocks\.review\.runtime/],
    ['gates', TESTS, /profile\.blocks\.gates\.gates/], ['mutation', MUT, /profile\.blocks\.mutation\b/]]) {
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

test('W100: the fix review gets each given finding with its outcome, a rejected one with the fixer\'s argument', async () => {
  const two = { verdict: 'findings', checked: [row('x')], findings: [finding('major', 'a:1', 't'), finding('major', 'b:1', 't')] }
  const { calls } = await runCore({
    'review:r1:code': two,
    'fix:r1': { applied: [{ id: 'R1-code-1', what: 'w' }], rejected: [{ id: 'R1-code-2', argument: 'ARG-1' }], proofs: [], head: 'cccc222' },
    'review:fix:r1': major,
    'fix:r1:review': { applied: [], rejected: [{ id: 'F1-1', argument: 'ARG-2' }], proofs: [], head: 'dddd333' },
  })
  const given = label => JSON.parse(prompt(calls, label).split('GIVEN:\n')[1].split('\n\n')[0])
  assert.deepEqual(given('review:fix:r1'), [{ id: 'R1-code-1', where: 'a:1', problem: 'p', outcome: 'fixed' },
    { id: 'R1-code-2', where: 'b:1', problem: 'p', outcome: 'rejected', argument: 'ARG-1' }])
  assert.deepEqual(given('review:fix:r1:1'), [{ id: 'F1-1', where: 'a:1', problem: 'p', outcome: 'rejected', argument: 'ARG-2' }])
  assert.match(prompt(calls, 'review:fix:r1'), /each `fixed` finding is fixed by the diff; each `rejected` one: its `argument` holds against the code/)
})

test('W101: a relayed message is to be mentioned in notes only by a stage whose schema has notes', async () => {
  const { calls } = await everyBlock()
  for (const c of calls) assert.equal(/mention it in (your )?notes/.test(c.prompt), 'notes' in c.opts.schema.properties, c.label)
  assert.ok(calls.some(c => 'notes' in c.opts.schema.properties) && calls.some(c => !('notes' in c.opts.schema.properties)))
})

test('W102: a checklist with an unmet row answers verdict findings, even with no other finding; clean with one is silent', async () => {
  const unmet = row('R1', { status: 'unmet', promise: 'p', counterexample: 'c' })
  const sent = await runCore({ 'review:r1:checklist': { verdict: 'findings', findings: [], checked: [unmet] },
    'fix:r1': { applied: [{ id: 'R1-R1', what: 'w' }], rejected: [], proofs: [], head: 'bbbb111' } })
  assert.ok(!sent.result.failures.some(f => /silent/.test(f)), JSON.stringify(sent.result.failures))
  assert.match(prompt(sent.calls, 'fix:r1'), /R1-R1/)
  const quiet = await runCore({ 'review:r1:checklist': clean([unmet]), 'fix:r1': { applied: [], rejected: [], proofs: [], head: 'bbbb111' } })
  assert.ok(quiet.result.failures.includes('review r1 checklist silent: verdict clean with 0 findings and an unmet row'), JSON.stringify(quiet.result.failures))
  assert.match(prompt(sent.calls, 'review:r1:checklist'), /verdict `clean` exactly when findings is empty and no row is `unmet`/)
})

test('W103: a runner that did not run, a step that does not apply and a repository with no gate are answers, not deaths; code rules end their line', async () => {
  const { calls } = await everyBlock()
  const mutation = prompt(calls, 'mutation')
  assert.match(mutation, /exit 2 means it did not run: ran false, not_run its stderr\./)
  assert.match(mutation, /when it does not, ran is false and mutants \[\]\./)
  assert.match(mutation, /\nAnswer, or the stage counts as died\./)
  assert.ok(!/run every mutant/.test(mutation))
  const discover = prompt(calls, 'gates:discover')
  assert.match(discover, /A repository with no gate: gates \[\] and a question saying where you looked\.\nAnswer, or the stage counts as died\./)
  assert.ok(!/disagree/.test(discover))
  const ruled = await runCore({ 'review:r1:code': major, 'fix:r1': { applied: [], rejected: [{ id: 'R1-code-1', argument: 'a' }], proofs: [], head: 'bbbb111' } }, 1, withProfile({ code_rules: ['RULE-ONE'] }))
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
  const { calls } = await runCore({ 'review:r1:code': major, 'fix:r1': { applied: [], rejected: [{ id: 'R1-code-1', argument: 'a' }], proofs: [], head: 'bbbb111' } })
  const fix = prompt(calls, 'fix:r1')
  assert.ok(fix.includes(`FINDINGS:\n${JSON.stringify(sentTo(calls, 'fix:r1'))}\n`))
  assert.ok(fix.includes(`RESEARCH:\n${JSON.stringify(Object.assign({}, base().research, { files: ['src/a.cpp'] }))}\n`))
})

test('W106: a profile string\'s {{base}}, {{run}}, {{repo}} and {{tools}} reach the agents filled in from args', async () => {
  const { calls } = await runCore({}, 1, withProfile({
    gates: [{ name: 'tests', command: 'make -C {{repo}} test' }], mutation: { test: 'T {{run}}/m' },
    code_rules: ['diff against {{base}}'], context: ['notes in {{run}}/notes'],
    blocks: { research: { prompt: '{{default}}\nSee {{tools}}/docs.' } } }))
  assert.ok(prompt(calls, 'implement').includes('tests: `make -C /r test`'))
  assert.ok(prompt(calls, 'implement').includes('- diff against aaaa000'))
  assert.ok(prompt(calls, 'mutation').includes("--test 'T /run/m'"))
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
