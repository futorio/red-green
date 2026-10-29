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
import { render, DEFAULT, template, defaults, stageCall } from './render.mjs'

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
  assert.ok(out.includes('MAILBOX. Your address is `review:r1:code`'))
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

// The default render's prompts, byte for byte as acae72a rendered them (before the defaults moved to Markdown): per
// case and label, the first 16 hex digits of the prompt's sha256. The cases reach every call with every note on: a
// fix with proofs and earlier fixes under one_commit, a replan with uncovered and duplicate checks, a retry, a
// checklist with verify-by-review ids and unverified claims, gates discovery, both mutation approaches. acae72a took
// the moved fields at their old places: profile.gates, .mutation, .runtime and .research (here a prompt wrapping
// {{default}}).
const G = [{ name: 'gates', command: 'GATES' }]
const met = id => ({ verdict: 'clean', findings: [], checked: [{ item: id, evidence: 'e', status: 'met', promise: 'p', counterexample: 'c' }] })
const said = (severity, where, proof) => Object.assign({ severity, where, problem: `P-${where}`, trigger: 't', consequence: 'c', fix: 'f' }, proof && { proof: { path: `t/${where}.test`, command: 'npm t', red: 'red' } })
const findings = (...fs) => ({ verdict: 'findings', findings: fs, checked: [{ item: 'x', evidence: 'e' }] })
const fixedAt = (id, what, head, proof) => ({ applied: [{ id, what }], rejected: [], proofs: proof ? [{ id, path: proof, outcome: 'deleted' }] : [], head })
const cleanRounds = { 'review:r1:checklist': met('R1'), 'review:r1:code': met('x'), 'review:r2:checklist': met('R1'), 'review:r2:code': met('x') }
const ACAE = {
  plain: [{ args: { profile: { blocks: { gates: { gates: G }, mutation: { test: 'TEST-CMD' } } } }, results: cleanRounds },
    { research: 'f1f81516fad30008', plan: '10dabcb0a2ad1849', implement: '6ff71f6cf72e68ad', 'gates:r1': 'dbd8102be491f327', 'review:r1:checklist': '717b3afce0abfac8',
      'review:r1:code': '992bb4ada05207ea', 'review:r2:checklist': '707c6250166200da', 'review:r2:code': '31acdce4c80162b6', mutation: 'f6c66eda07a8ed20' }],
  fixes: [{ args: { one_commit: true, profile: { code_rules: ['rule one'], commit: 'imperative mood', context: ['ctx line'], blocks: {
    gates: { gates: G }, mutation: { build: 'B-CMD', test: 'TEST-CMD', timeout: 9 }, research: { prompt: '{{default}}\n- Also read NOTES.md.' }, review: { runtime: 'Node 22' } } } },
  results: { 'review:r1:checklist': met('R1'), 'review:r1:code': findings(said('major', 'a.js:1', true), said('minor', 'b.js:2')),
    'fix:r1': fixedAt('R1-code-1', 'w', 'H2', 't/a.js:1.test'), 'review:r2:checklist': met('R1'), 'review:r2:code': findings(said('major', 'c.js:3', true)),
    'fix:r2': fixedAt('R2-code-1', 'w2', 'H3', 't/c.js:3.test'), 'review:fix:r2': findings(said('major', 'd.js:4')), 'fix:r2:review': fixedAt('F1-1', 'w3', 'H4'),
    'review:fix:r2:1': { verdict: 'clean', findings: [], checked: [{ item: 'x', evidence: 'e' }] }, mutation: { applies: false, ran: false, mutants: [] } } },
  { research: 'b260d6f66e11aa64', implement: 'caab9cd86e5a9d6b', 'review:r1:code': '6c304ed6c7d09d22', 'fix:r1': 'd31a85c592fb310b', 'gates:r2': 'ef8068ac5fc53b88',
    'review:r2:checklist': '7aa1147dee9cb39e', 'review:r2:code': '19cf0931c2b1d146', 'fix:r2': 'd83b4a37cd8fff98', 'review:fix:r2': '9ad9723af20c7c72',
    'fix:r2:review': 'e46a6a8775ecb70e', 'review:fix:r2:1': 'ebd1cd37adade2ee', 'gates:r2:recheck': '1d2ba6cf43d0c772', mutation: '930ea51d19005b03', 'fix:minor': '670b7e92babd49f4' }],
  replan: [{ args: { profile: { blocks: { gates: { gates: G } } } }, results: {
    research: { requirements: ['R1: one', 'R2: two', 'R3: three'], facts: [], plan: ['step'], test_harness: [{ requirement: 'R1', by: 'test', how: 'h' }, { requirement: 'R2', by: 'test', how: 'h' }, { requirement: 'R3', by: 'review', how: 'h' }] },
    plan: { cases: [{ id: 'C1', requirement: 'R1', title: 't', arrange: 'a', act: 'a', asserts: ['x'] }, { id: 'C2', requirement: 'R1', title: 't2', arrange: 'a', act: 'a', asserts: ['x'] }], questions: [] },
    implement: { head: 'BASE', checks: [], unverified: [], questions: [], notes: 'stuck' },
    'implement:retry': { head: 'H1', checks: [], unverified: ['no tool for X'], questions: [] } } },
  { replan: '20e6038ea250d70c', 'implement:retry': '823832a3d27e3726', 'review:r1:checklist': '36c192cef922e3a7', 'review:r1:code': '665c181a8f548cc0' }],
  discover: [{ args: { profile: { blocks: { mutation: { tool: 'TOOL-TEXT' }, review: { duties: { order: true } } } } }, results: cleanRounds },
    { 'gates:discover': '5cbc847c1946ab34', 'gates:r1': 'dbd8102be491f327', 'review:r1:code': '546981489d557523', mutation: 'ed5863ab552f2d44' }],
}

test('T22: the default render\'s prompts are byte for byte those of acae72a', async () => {
  const source = render(DEFAULT)
  for (const [name, [kase, want]] of Object.entries(ACAE))
    for (const [label, sha] of Object.entries(want))
      assert.equal(createHash('sha256').update((await stageCall(source, kase, label)).prompt).digest('hex').slice(0, 16), sha, `${name} ${label}`)
})
