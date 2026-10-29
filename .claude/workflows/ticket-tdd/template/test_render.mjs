// Renders the template and checks it against the hand-written core, and prints stage prompts through the CLI.
//
//     node --test .claude/workflows/ticket-tdd/template/test_render.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { render, DEFAULT, template, defaults, stageCall, validate, REGISTRY } from './render.mjs'

const CORE = readFileSync(new URL('../../ticket-tdd.js', import.meta.url), 'utf8')
const CLI = new URL('./render.mjs', import.meta.url).pathname
const variant = over => Object.assign(JSON.parse(JSON.stringify(DEFAULT)), over)
const changedLines = (a, b) => {
  const x = a.split('\n'), y = b.split('\n')
  assert.equal(x.length, y.length, 'a key changed the line count')
  return x.map((l, i) => l === y[i] ? null : i + 1).filter(Boolean)
}
const lineOf = (src, needle) => src.split('\n').findIndex(l => l.includes(needle)) + 1
const tmp = mkdtempSync(join(tmpdir(), 'tdd-render-'))
const file = (name, obj) => { const p = join(tmp, name); writeFileSync(p, JSON.stringify(obj)); return p }
const cli = (...a) => execFileSync('node', [CLI, ...a], { encoding: 'utf8' })

test('T01: the default config renders the hand-written core byte for byte', () => {
  assert.equal(render(DEFAULT), CORE)
})

test('T02: the CLI with no config prints the core', () => {
  assert.equal(cli(), CORE)
})

// A config names only the block fields it changes; each changes only the one line that holds the block defaults.
const blocks = b => ({ blocks: b })
const BLOCKS_LINE = lineOf(CORE, 'mergeBlocks({"research"')
const onlyBlocksLine = out => assert.deepEqual(changedLines(render(DEFAULT), out), [BLOCKS_LINE])

test('T03: the lens list changes only the block defaults line', () => {
  const out = render(blocks({ review: { lenses: ['code'] } }))
  onlyBlocksLine(out)
  assert.match(out, /"lenses":\["code"\]/)
})

test('T04: a block model changes only the block defaults line', () => {
  const out = render(blocks({ review: { model: 'sonnet' } }))
  onlyBlocksLine(out)
  assert.match(out, /"review":\{"model":"sonnet","effort":"high"/)
})

test('T05: a config naming the removed probe or same_frame duty, an unknown block or field is an error naming it', () => {
  for (const k of ['probe', 'same_frame']) assert.throws(() => render(blocks({ review: { duties: { [k]: true } } })), new RegExp(`unknown field: review.duties.${k}`))
  assert.throws(() => render(blocks({ planner: {} })), /unknown block: planner/)
  assert.throws(() => render(blocks({ mutation: { edge: 3 } })), /unknown field: mutation.edge/)
})

test('T05b: the order duty changes only the block defaults line, and merges key by key', () => {
  const out = render(blocks({ review: { duties: { order: true } } }))
  onlyBlocksLine(out)
  assert.match(out, /"duties":\{"test_case_review":true,"order":true\}/)
})

test('T06: test-case review off changes only the block defaults line', () => {
  const out = render(blocks({ review: { duties: { test_case_review: false } } }))
  onlyBlocksLine(out)
  assert.match(out, /"duties":\{"test_case_review":false,"order":false\}/)
})

test('T07: an unknown config key or lens, or a value off its schema, is an error, not a silent default', () => {
  assert.throws(() => render(variant({ lens: {} })), /unknown config key: lens/)
  assert.throws(() => render(blocks({ review: { lenses: ['mechanics'] } })), /blocks\.review\.lenses\[0\]: "mechanics" not in \["checklist","code"\]/)
  assert.throws(() => render(blocks({ review: { rounds: 'auto' } })), /blocks\.review\.rounds: string, not integer/)
  for (const k of ['models', 'lenses', 'duties']) assert.throws(() => render({ [k]: {} }), new RegExp(`unknown config key: ${k}`))
})

test('T08: --prompt prints the code lens prompt of a case, with its gate lines and mailbox note', () => {
  const caseFile = file('case.json', { args: { base: 'c0ffee1', target: '/case/ticket.md' }, gate_lines: ['CASE-GATE 3 of 3'] })
  const out = cli('--case', caseFile, '--prompt', 'review:r1:code')
  assert.ok(out.startsWith('You are one agent in a workflow run implementing /case/ticket.md.'))
  assert.ok(out.includes('Lens: code. Read the code as code'))
  assert.ok(out.includes('CONTRACT (binding, whatever the text above says):\nRead-only: change and commit nothing in'))
  assert.ok(out.includes('gates: green — CASE-GATE 3 of 3'))
  assert.ok(out.includes('MAILBOX: you are `review:r1:code`.'))
  assert.ok(!out.includes('Lens: checklist'))
})

test('T09: --prompt renders the config it is given', () => {
  const caseFile = file('case2.json', {})
  const cfg = file('order.json', blocks({ review: { duties: { order: true } } }))
  assert.ok(cli(cfg, '--case', caseFile, '--prompt', 'review:r1:code').includes('ORDER RULE'))
  assert.ok(!cli('--case', caseFile, '--prompt', 'review:r1:code').includes('ORDER RULE'))
})

test('T10: a stage the case does not reach is an error naming it', () => {
  const caseFile = file('case3.json', {})
  assert.throws(() => execFileSync('node', [CLI, '--case', caseFile, '--prompt', 'fix:r1'], { stdio: 'pipe' }), /stage fix:r1 not reached/)
})

test('T11: --json prints the stage prompt with the schema, model and effort its agent gets', () => {
  const caseFile = file('case4.json', {})
  const cfg = file('sonnet.json', blocks({ review: { model: 'sonnet' } }))
  const out = JSON.parse(cli(cfg, '--case', caseFile, '--prompt', 'review:r1:code', '--json'))
  assert.equal(out.prompt, cli(cfg, '--case', caseFile, '--prompt', 'review:r1:code'))
  assert.equal(out.model, 'sonnet')
  assert.equal(out.effort, 'high')
  assert.deepEqual(out.schema.required, ['verdict', 'findings', 'checked'])
  assert.ok('mailbox' in out.schema.properties)
})

test('T12: a case whose profile declares no gates reaches the lenses through a stub discovery step', () => {
  const caseFile = file('case5.json', { args: { profile: {} }, gate_lines: ['FOUND-GATE ok'] })
  assert.ok(cli('--case', caseFile, '--prompt', 'review:r1:code').includes(': green — FOUND-GATE ok'))
})

// fixtures.json: the sha256 of the render of every slot variant; a change that alters the render re-records them.
test('T13: every recorded slot variant renders byte for byte as recorded', () => {
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'))
  for (const [name, { config, sha256 }] of Object.entries(fixtures))
    assert.equal(createHash('sha256').update(render(config)).digest('hex'), sha256, name)
})

// A core directory of the given files, for the assembly errors.
const coreDir = files => {
  const dir = mkdtempSync(join(tmp, 'core-'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, `${name}.js`), text)
  return dir
}

test('T14: an @include of a part no block defines is an error naming it', () => {
  const dir = coreDir({ orchestrator: '// @part main\n// @include a missing\n', a: '// @part one\nx\n' })
  assert.throws(() => template(dir), /no part a missing/)
})

test('T15: an @include of a part already included is an error naming it', () => {
  const dir = coreDir({ orchestrator: '// @part main\n// @include a one\n// @include a one\n', a: '// @part one\nx\n' })
  assert.throws(() => template(dir), /part a one included twice/)
})

test('T16: a part never included is an error naming it', () => {
  const dir = coreDir({ orchestrator: '// @part main\n// @include a one\n', a: '// @part one\nx\n// @part two\ny\n' })
  assert.throws(() => template(dir), /parts never included: a two/)
})

// A defaults directory of the given Markdown files.
const defaultsDir = files => {
  const dir = mkdtempSync(join(tmp, 'defaults-'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, `${name}.md`), text)
  return dir
}

test('T17: a default part is its lines verbatim, its last newline dropped, with each {{> block part}} replaced by that part', () => {
  const dir = defaultsDir({
    a: '<!-- header -->\n<!-- @part one -->\n lead {{> b two}} {{run}}\n<!-- @part blank -->\n\nX\n\n',
    b: '<!-- @part two -->\nB {{> b three}}\n<!-- @part three -->\ntrail \n',
  })
  assert.deepEqual(defaults(dir), { a: { one: ' lead B trail  {{run}}', blank: '\nX\n' }, b: { two: 'B trail ', three: 'trail ' } })
})

test('T18: an include of a part no defaults file defines, or of a part that includes itself, is an error naming it', () => {
  assert.throws(() => defaults(defaultsDir({ a: '<!-- @part one -->\n{{> a two}}\n' })), /no default part a two/)
  assert.throws(() => defaults(defaultsDir({ a: '<!-- @part one -->\n{{> a two}}\n<!-- @part two -->\n{{> a one}}\n' })), /default part a one includes itself/)
})

// The conformance command on a recorded real output of the code lens (wf-ablation t31, th-x02-impl--full--002).
const RECORDED = new URL('./conformance/review-code.json', import.meta.url).pathname
const conform = (...a) => {
  try { return { code: 0, report: JSON.parse(execFileSync('node', [CLI, ...a], { encoding: 'utf8', stdio: 'pipe' })) } }
  catch (e) { return { code: e.status, report: JSON.parse(e.stdout) } }
}

test('T19: --conform passes a recorded real output and reports what the script made of it', () => {
  const { code, report } = conform('--conform', 'review:r1:code', RECORDED)
  assert.equal(code, 0)
  assert.deepEqual(report.schema_errors, [])
  assert.deepEqual(report.failures, [])
  assert.equal(report.status, 'done')
  assert.deepEqual(report.findings.map(f => [f.sent_to, f.id, f.severity, f.where]), [['fix:r1', 'R1-code-1', 'major', 'docs/adr/0003-model-intel-rsqrtss.md (not in the diff); docs/coop/data-setup.md:40'],
    ['fix:minor', 'R1-code-2', 'minor', 'scripts/coop/build-arch.sh:12']])
  assert.deepEqual(report.advisory.map(f => f.id), ['R1-code-2'])
  assert.deepEqual(report.verdicts.filter(v => v.lens === 'code').map(v => [v.round, v.verdict, v.count]), [[1, 'findings', 2], [2, 'clean', 0]])
})

test('T20: --conform fails a drifted output, naming its schema errors and what the script made of it', () => {
  const recorded = () => JSON.parse(readFileSync(RECORDED, 'utf8'))
  const silent = recorded()
  silent.findings[0].severity = 'blocker'
  silent.checked = []
  const { code, report } = conform('--conform', 'review:r1:code', file('silent.json', silent))
  assert.equal(code, 1)
  assert.deepEqual(report.schema_errors, ['$.findings[0].severity: "blocker" not in ["major","minor"]'])
  assert.equal(report.status, 'done_with_failures')
  // The blocker reaches the fix's input check, which fails that fix before its call.
  assert.deepEqual(report.failures, ['review r1 code silent: no checked rows', 'fix:r1 input: $.findings[0].severity: "blocker" not in ["major","minor"]', 'fix r1'])
  // A renamed field the script reads: the run itself breaks, and the report says where.
  const renamed = recorded()
  renamed.rows = renamed.checked
  delete renamed.checked
  const broken = conform('--conform', 'review:r1:code', file('renamed.json', renamed))
  assert.equal(broken.code, 1)
  assert.deepEqual(broken.report.schema_errors, ['$: checked missing'])
  assert.match(broken.report.crash, /checked/)
})

test('T21: --conform reads a fix\'s findings and the checklist\'s ids from the call, not its prompt text', () => {
  const cfg = file('plugins.json', blocks({ fix: { prompt: 'Fix these: {{findings}}' }, review: { prompt: 'Ids {{check_ids}}.' } }))
  const { code, report } = conform(cfg, '--conform', 'review:r1:code', RECORDED)
  assert.equal(code, 0, JSON.stringify(report.failures))
  assert.deepEqual(report.findings.map(f => [f.sent_to, f.id]), [['fix:r1', 'R1-code-1'], ['fix:minor', 'R1-code-2']])
})

// The default render's prompts, byte for byte: per case and label, the first 16 hex digits of the prompt's sha256. A
// change to a prompt re-records them on purpose, and its commit states each prompt's byte delta. The cases reach every
// call with every note on: a fix with proofs and earlier fixes under one_commit, a replan with uncovered and duplicate
// checks, a retry, a checklist with verify-by-review ids and unverified claims, gates discovery, both mutation
// approaches. Moved fields sit at their new places: blocks.gates, .mutation, .review.runtime and .research (a prompt
// wrapping {{default}}).
const G = [{ name: 'gates', command: 'GATES' }]
const met = id => ({ verdict: 'clean', findings: [], checked: [{ item: id, evidence: 'e', status: 'met', promise: 'p', counterexample: 'c' }] })
const said = (severity, where, proof) => Object.assign({ severity, where, problem: `P-${where}`, trigger: 't', consequence: 'c', fix: 'f' }, proof && { proof: { path: `t/${where}.test`, command: 'npm t', red: 'red' } })
const findings = (...fs) => ({ verdict: 'findings', findings: fs, checked: [{ item: 'x', evidence: 'e' }] })
const fixedAt = (id, what, head, proof) => ({ applied: [{ id, what }], rejected: [], proofs: proof ? [{ id, path: proof, outcome: 'deleted' }] : [], head })
const cleanRounds = { 'review:r1:checklist': met('R1'), 'review:r1:code': met('x'), 'review:r2:checklist': met('R1'), 'review:r2:code': met('x') }
const ACAE = {
  plain: [{ args: { profile: { blocks: { gates: { gates: G }, mutation: { test: 'TEST-CMD' } } } }, results: cleanRounds },
    { research: '6911c78e1828d634', plan: 'f6a4abaf5ce38b49', implement: '88df35966d59d806', 'gates:r1': '0cc4614b3825b623', 'review:r1:checklist': 'e684b9a6afefd3d4',
      'review:r1:code': '3030a3c16944a404', 'review:r2:checklist': '371d3731e8c2638c', 'review:r2:code': '61a9ccc87c363b5d', mutation: 'cc7bcf5d93e7e172' }],
  fixes: [{ args: { one_commit: true, profile: { code_rules: ['rule one'], commit: 'imperative mood', context: ['ctx line'], blocks: {
    gates: { gates: G }, mutation: { build: 'B-CMD', test: 'TEST-CMD', timeout: 9 }, research: { prompt: '{{default}}\n- Also read NOTES.md.' }, review: { runtime: 'Node 22' } } } },
  results: { 'review:r1:checklist': met('R1'), 'review:r1:code': findings(said('major', 'a.js:1', true), said('minor', 'b.js:2')),
    'fix:r1': fixedAt('R1-code-1', 'w', 'H2', 't/a.js:1.test'), 'review:r2:checklist': met('R1'), 'review:r2:code': findings(said('major', 'c.js:3', true)),
    'fix:r2': fixedAt('R2-code-1', 'w2', 'H3', 't/c.js:3.test'), 'review:fix:r2': findings(said('major', 'd.js:4')), 'fix:r2:review': fixedAt('F1-1', 'w3', 'H4'),
    'review:fix:r2:1': { verdict: 'clean', findings: [], checked: [{ item: 'x', evidence: 'e' }] }, mutation: { applies: false, ran: false, mutants: [] } } },
  { research: 'dfecb403802054b6', implement: 'ab79b46629fc8bdc', 'review:r1:code': '4d6992e8c4bbc426', 'fix:r1': '4a52d24435c5988f', 'gates:r2': '85f06a733be7ed6c',
    'review:r2:checklist': 'd8ccb92231bd1fa0', 'review:r2:code': '66c5ed56c70934e7', 'fix:r2': '6a7d799c271f57a2', 'review:fix:r2': '04e8815ac3e1fc76',
    'fix:r2:review': 'e52e3d52712c385a', 'review:fix:r2:1': '2254c405d7f17b35', 'gates:r2:recheck': 'db1d924b42508b00', mutation: 'bcb5efae64a79923', 'fix:minor': 'eb3003f8624f888d' }],
  replan: [{ args: { profile: { blocks: { gates: { gates: G } } } }, results: {
    research: { requirements: ['R1: one', 'R2: two', 'R3: three'], facts: [], plan: ['step'], test_harness: [{ requirement: 'R1', by: 'test', how: 'h' }, { requirement: 'R2', by: 'test', how: 'h' }, { requirement: 'R3', by: 'review', how: 'h' }] },
    plan: { cases: [{ id: 'C1', requirement: 'R1', title: 't', arrange: 'a', act: 'a', asserts: ['x'] }, { id: 'C2', requirement: 'R1', title: 't2', arrange: 'a', act: 'a', asserts: ['x'] }], questions: [] },
    implement: { head: 'BASE', checks: [], unverified: [], questions: [], notes: 'stuck' },
    'implement:retry': { head: 'H1', checks: [], unverified: ['no tool for X'], questions: [] } } },
  { replan: '2e5cb623c17f1c06', 'implement:retry': '69317e27ce19df42', 'review:r1:checklist': '511aad0626c85e69', 'review:r1:code': '6d031971cfbaa6f4' }],
  discover: [{ args: { profile: { blocks: { mutation: { tool: 'TOOL-TEXT' }, review: { duties: { order: true } } } } }, results: cleanRounds },
    { 'gates:discover': '444f52c2e1401992', 'gates:r1': '0cc4614b3825b623', 'review:r1:code': 'efd58533adc558f4', mutation: '7eb79d9049fe8c09' }],
}

test('T22: the default render\'s prompts are these', async () => {
  const source = render(DEFAULT)
  for (const [name, [kase, want]] of Object.entries(ACAE))
    for (const [label, sha] of Object.entries(want))
      assert.equal(createHash('sha256').update((await stageCall(source, kase, label)).prompt).digest('hex').slice(0, 16), sha, `${name} ${label}`)
})

test('T23: a stage the run does not reach because of a failure is an error naming that failure', async () => {
  await assert.rejects(stageCall(render(DEFAULT), { args: { profile: { blocks: { nope: {} } } } }, 'research'), /run failed at config: unknown block: nope/)
  await assert.rejects(stageCall(render(blocks({ research: { prompt: '{{nope}}' } })), {}, 'plan'), /run failed at research: research input: unknown \{\{nope\}\}/)
  const caseFile = file('case-config.json', { args: { profile: { blocks: { nope: {} } } } })
  assert.throws(() => execFileSync('node', [CLI, '--case', caseFile, '--prompt', 'review:r1:code'], { stdio: 'pipe' }), /run failed at config: unknown block: nope/)
})

test('T25: a replay takes a recorded research plan step over 600 characters as given: no research:retry, review gets it verbatim', async () => {
  const step = 'RECORDED-' + 'x'.repeat(700)
  const research = { requirements: ['R1: the ticket'], facts: [], plan: [step], test_harness: [{ requirement: 'R1', by: 'test', how: 'h' }] }
  assert.ok((await stageCall(render(DEFAULT), { results: { research } }, 'review:r1:code')).prompt.includes(JSON.stringify(step)))
})

test('T24: the research input takes what research\'s own checks limit: a plan step over 600 characters, a requirement without the space', () => {
  const recorded = { requirements: ['R1:one'], facts: [], plan: ['x'.repeat(900)], test_harness: [], files: [] }
  assert.deepEqual(validate(REGISTRY.research, recorded), [])
})
