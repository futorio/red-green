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
import { render, DEFAULT, template } from './render.mjs'

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

test('T03: the lens list changes only the lens keys line', () => {
  const out = render(variant({ lenses: ['code'] }))
  assert.deepEqual(changedLines(render(DEFAULT), out), [lineOf(CORE, 'const LENS_KEYS = ')])
  assert.match(out, /const LENS_KEYS = \['code'\]/)
})

test('T04: a stage model changes only the models line', () => {
  const out = render(variant({ models: Object.assign({}, DEFAULT.models, { review: 'sonnet' }) }))
  assert.deepEqual(changedLines(render(DEFAULT), out), [lineOf(CORE, 'const M = Object.assign(')])
  assert.match(out, /review: 'sonnet'/)
})

test('T05: a config naming the removed probe or same_frame duty is an unknown-key error', () => {
  for (const k of ['probe', 'same_frame']) assert.throws(() => render(variant({ duties: { [k]: true } })), new RegExp(`unknown config key: duties.${k}`))
})

test('T05b: the order duty changes only the code lens line', () => {
  const out = render(variant({ duties: Object.assign({}, DEFAULT.duties, { order: true }) }))
  assert.deepEqual(changedLines(render(DEFAULT), out), [lineOf(CORE, "key: 'code'")])
  assert.match(out, /ORDER RULE/)
})

test('T06: test-case review off drops its sentence from the code lens and the fix review only', () => {
  const out = render(variant({ duties: Object.assign({}, DEFAULT.duties, { test_case_review: false }) }))
  assert.deepEqual(changedLines(render(DEFAULT), out), [lineOf(CORE, 'A test the diff weakened'), lineOf(CORE, 'STAGE: fix review')])
  assert.ok(!out.includes('weakened'))
})

test('T07: an unknown config key or lens is an error, not a silent default', () => {
  assert.throws(() => render(variant({ lens: {} })), /unknown config key: lens/)
  assert.throws(() => render(variant({ lenses: ['mechanics'] })), /unknown lens: mechanics/)
})

test('T08: --prompt prints the code lens prompt of a case, with its gate lines and mailbox note', () => {
  const caseFile = file('case.json', { args: { base: 'c0ffee1', target: '/case/ticket.md' }, gate_lines: ['CASE-GATE 3 of 3'] })
  const out = cli('--case', caseFile, '--prompt', 'review:r1:code')
  assert.ok(out.startsWith('You are one agent in a workflow run implementing /case/ticket.md.'))
  assert.ok(out.includes('Lens: code. Read-only: change and commit nothing in'))
  assert.ok(out.includes('gates: green — CASE-GATE 3 of 3'))
  assert.ok(out.includes('MAILBOX. Your address is `review:r1:code`'))
  assert.ok(!out.includes('Lens: checklist'))
})

test('T09: --prompt renders the config it is given', () => {
  const caseFile = file('case2.json', {})
  const cfg = file('order.json', variant({ duties: Object.assign({}, DEFAULT.duties, { order: true }) }))
  assert.ok(cli(cfg, '--case', caseFile, '--prompt', 'review:r1:code').includes('ORDER RULE'))
  assert.ok(!cli('--case', caseFile, '--prompt', 'review:r1:code').includes('ORDER RULE'))
})

test('T10: a stage the case does not reach is an error naming it', () => {
  const caseFile = file('case3.json', {})
  assert.throws(() => execFileSync('node', [CLI, '--case', caseFile, '--prompt', 'fix:r1'], { stdio: 'pipe' }), /stage fix:r1 not reached/)
})

test('T11: --json prints the stage prompt with the schema, model and effort its agent gets', () => {
  const caseFile = file('case4.json', {})
  const cfg = file('sonnet.json', variant({ models: Object.assign({}, DEFAULT.models, { review: 'sonnet' }) }))
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
