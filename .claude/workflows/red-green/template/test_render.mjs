// Renders the template and checks it against the hand-written core, and prints stage prompts through the CLI.
//
//     node --test .claude/workflows/red-green/template/test_render.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { render, DEFAULT, template, defaults, stageCall, validate, REGISTRY } from './render.mjs'

const CORE = readFileSync(new URL('../../red-green.js', import.meta.url), 'utf8')
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

test('T03b: fix_attempts changes only the block defaults line', () => {
  const out = render(blocks({ gates: { fix_attempts: 5 } }))
  onlyBlocksLine(out)
  assert.match(out, /"fix_attempts":5/)
})

test('T04: a block model changes only the block defaults line', () => {
  const out = render(blocks({ review: { model: 'sonnet' } }))
  onlyBlocksLine(out)
  assert.match(out, /"review":\{"model":"sonnet","effort":"high"/)
})

test('T05: a config naming the removed probe or same_frame duty, an unknown block or field is an error naming it', () => {
  for (const k of ['probe', 'same_frame']) assert.throws(() => render(blocks({ review: { duties: { [k]: true } } })), new RegExp(`unknown field: review.duties.${k}`))
  assert.throws(() => render(blocks({ planner: {} })), /unknown block: planner/)
  assert.throws(() => render(blocks({ gates: { edge: 3 } })), /unknown field: gates.edge/)
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

test('T12: a case whose profile declares no gates fails on config, and --check lets it through', () => {
  assert.throws(() => execFileSync('node', [CLI, '--case', file('case5.json', { args: { profile: {} } }), '--prompt', 'review:r1:code'], { stdio: 'pipe' }), /run failed at config: .*no fast or round gate/)
  execFileSync('node', [CLI, '--check', file('none.json', {})], { stdio: 'pipe' })
  execFileSync('node', [CLI, '--check', file('empty.json', { blocks: { gates: { gates: [] } } })], { stdio: 'pipe' })
  const heavy = file('heavy.json', { blocks: { gates: { gates: [{ name: 'H', command: 'h', tier: 'acceptance' }] } } })
  assert.throws(() => execFileSync('node', [CLI, '--check', heavy], { stdio: 'pipe' }), /no fast or round gate/)
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
    ['fix:r1', 'R1-code-2', 'minor', 'scripts/coop/build-arch.sh:12']])
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
  assert.deepEqual(report.findings.map(f => [f.sent_to, f.id]), [['fix:r1', 'R1-code-1'], ['fix:r1', 'R1-code-2']])
})

// The default render's prompts, byte for byte: per case and label, the first 16 hex digits of the prompt's sha256. A
// change to a prompt re-records them on purpose, and its commit states each prompt's byte delta. The cases reach every
// call with every note on: a fix with proofs and earlier fixes under one_commit, the iteration after it with the last
// fix's outcomes, a replan with uncovered and duplicate checks, a retry, a checklist with verify-by-review ids and
// unverified claims, the order duty, a property case through the runner after a replan on its source and one through a
// framework. Moved fields sit at their new places: blocks.gates, .review.runtime and .research
// (a prompt wrapping {{default}}).
const G = [{ name: 'gates', command: 'GATES' }]
const met = id => ({ verdict: 'clean', findings: [], checked: [{ item: id, evidence: 'e', status: 'met', promise: 'p', counterexample: 'c' }] })
const said = (severity, where, proof) => Object.assign({ severity, where, problem: `P-${where}`, trigger: 't', consequence: 'c', fix: 'f' }, proof && { proof: { path: `t/${where}.test`, command: 'npm t', red: 'red' } })
const findings = (...fs) => ({ verdict: 'findings', findings: fs, checked: [{ item: 'x', evidence: 'e' }] })
const fixedAt = (id, what, head, proof) => ({ applied: [{ id, what }], rejected: [], proofs: proof ? [{ id, path: proof, outcome: 'deleted' }] : [], head })
const propertyCase = over => ({ id: 'C1', requirement: 'R1', title: 't', arrange: 'a', act: 'a', asserts: ['x'], property: Object.assign({ id: 'm.p', statement: 'S', source: 'R1', domain: '{"int":[0,9]}', mut: ['0'] }, over) })
const cleanRounds = { 'review:r1:checklist': met('R1'), 'review:r1:code': met('x'), 'review:r2:checklist': met('R1'), 'review:r2:code': met('x') }
const ACAE = {
  plain: [{ args: { profile: { blocks: { gates: { gates: G } } } }, results: cleanRounds },
    { research: '6911c78e1828d634', plan: '7276e746b3637821', implement: 'b70304504af9e0b3', 'gates:r1': 'ecdbdc5ce45d7d6c', 'review:r1:checklist': '3e3bf11d116926dd',
      'review:r1:code': '67fc9466f40aa44a', 'review:r2:checklist': 'b3b8c70f59dd4595', 'review:r2:code': '8c46768874fa9b3d' }],
  fixes: [{ args: { one_commit: true, profile: { code_rules: ['rule one'], commit: 'imperative mood', context: ['ctx line'], blocks: {
    gates: { gates: G }, research: { prompt: '{{default}}\n- Also read NOTES.md.' }, review: { runtime: 'Node 22' } } } },
  results: { 'review:r1:checklist': met('R1'), 'review:r1:code': findings(said('major', 'a.js:1', true), said('minor', 'b.js:2')),
    'fix:r1': fixedAt('R1-code-1', 'w', 'H2', 't/a.js:1.test'), 'review:r2:checklist': met('R1'), 'review:r2:code': findings(said('major', 'c.js:3', true)),
    'fix:r2': fixedAt('R2-code-1', 'w2', 'H3', 't/c.js:3.test'), 'review:r3:checklist': met('R1'), 'review:r3:code': met('x') } },
  { research: 'dfecb403802054b6', implement: '9fa45e6e544de090', 'review:r1:code': '449f317414f53ed9', 'fix:r1': '634c0a64f4b2b9c8', 'gates:r2': 'ec557ef7a7440410',
    'review:r2:checklist': 'c859c83537130992', 'review:r2:code': '0ec1a28b969e581e', 'fix:r2': '576fd3df0faaf430', 'gates:r3': '55ddb5b9561e34cc',
    'review:r3:checklist': '790e387cee27a7ba', 'review:r3:code': 'ea600bd08c7758c0' }],
  replan: [{ args: { profile: { blocks: { gates: { gates: G } } } }, results: {
    research: { requirements: ['R1: one', 'R2: two', 'R3: three'], facts: [], plan: ['step'], test_harness: [{ requirement: 'R1', by: 'test', how: 'h' }, { requirement: 'R2', by: 'test', how: 'h' }, { requirement: 'R3', by: 'review', how: 'h' }] },
    plan: { cases: [{ id: 'C1', requirement: 'R1', title: 't', arrange: 'a', act: 'a', asserts: ['x'] }, { id: 'C2', requirement: 'R1', title: 't2', arrange: 'a', act: 'a', asserts: ['x'] }], questions: [] },
    implement: { head: 'BASE', checks: [], unverified: [], questions: [], notes: 'stuck' },
    'implement:retry': { head: 'H1', checks: [], unverified: ['no tool for X'], questions: [] } } },
  { replan: '2935505f08e78115', 'implement:retry': '02123538d71a26a0', 'review:r1:checklist': '3cdbad0e09563efa', 'review:r1:code': '8ef453d1628e5c58' }],
  property: [{ args: { profile: { blocks: { gates: { gates: G } } } }, results: Object.assign({ plan: { cases: [propertyCase({ source: 'nowhere' })], questions: [] },
    replan: { cases: [propertyCase({})], questions: [] } }, cleanRounds) },
  { replan: '9e4fb753c4399907', implement: '4ee7aa01e488b30c', 'review:r1:code': '0ecbd15abf491805' }],
  framework: [{ args: { profile: { blocks: { gates: { gates: G }, implement: { property_framework: 'fast-check' } } } }, results: Object.assign({ plan: { cases: [propertyCase({})], questions: [] } }, cleanRounds) },
    { plan: '8c05e3f54ad3d441', implement: '96c71bddd5bfe627' }],
  order: [{ args: { profile: { blocks: { gates: { gates: G }, review: { duties: { order: true } } } } }, results: cleanRounds },
    { 'gates:r1': 'ecdbdc5ce45d7d6c', 'review:r1:code': 'aef39699277e3be5' }],
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

test('T26: --check exits 0 on a valid profile, and non-zero with the run\'s own config note on an invalid one', async () => {
  const run = (...a) => { try { execFileSync('node', [CLI, ...a], { stdio: 'pipe' }); return { code: 0 } } catch (e) { return { code: e.status, err: e.stderr.toString() } } }
  const valid = { code_rules: ['diff against {{base}}'], blocks: { gates: { gates: [{ name: 'lint', command: 'make -C {{repo}} lint', tier: 'fast' }, { name: 'test', command: 'make test' }] }, research: { prompt: '{{default}}\nMore.' } }, mutation: { include: ['src/**'] } }
  assert.deepEqual(run('--check', file('valid.json', valid)), { code: 0 })
  for (const [name, profile] of [['field', { blocks: { gates: { gates: G }, plan: { nope: 1 } } }], ['placeholder', { blocks: { gates: { gates: G } }, context: ['{{nope}}'] }],
    ['fast', { blocks: { gates: { gates: [{ name: 'lint', command: 'make lint', fast: true }] } } }], ['tier', { blocks: { gates: { gates: [{ name: 'lint', command: 'make lint', tier: 'x' }] } } }]]) {
    const note = await new Promise(resolve => stageCall(render(DEFAULT), { args: { profile } }, 'research').catch(e => resolve(e.message)))
    const { code, err } = run('--check', file(`${name}.json`, profile))
    assert.notEqual(code, 0, name)
    assert.equal(`stage research not reached: run failed at config: ${err.trim()}`, note, name)
  }
})

test('T27: the default config has rounds 3 and min 2 and no removed block; a config naming one is an error', () => {
  assert.deepEqual([DEFAULT.blocks.review.rounds, DEFAULT.blocks.review.min], [3, 2])
  assert.ok(!('extra' in DEFAULT.blocks.review))
  for (const b of ['minor-fix', 'fix-review']) {
    assert.ok(!(b in DEFAULT.blocks), b)
    assert.throws(() => render(blocks({ [b]: {} })), new RegExp(`unknown block: ${b}`))
  }
  assert.throws(() => render(blocks({ review: { extra: 1 } })), /unknown field: review\.extra/)
})

test('T24: the research input takes what research\'s own checks limit: a plan step over 600 characters, a requirement without the space', () => {
  const recorded = { requirements: ['R1:one'], facts: [], plan: ['x'.repeat(900)], test_harness: [], files: [] }
  assert.deepEqual(validate(REGISTRY.research, recorded), [])
})
