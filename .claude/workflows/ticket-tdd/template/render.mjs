// Renders the ticket-tdd core from ticket-tdd.js.tmpl and a config, or one stage prompt of that render for a case.
// README § Template.
//
//     node render.mjs [config.json]                                     the workflow script, on stdout
//     node render.mjs [config.json] --case case.json --prompt <label>   the prompt the agent labelled <label> receives
//     ... --prompt <label> --json                                       that prompt with its agent's schema, model and effort, as JSON
//     node render.mjs [config.json] --case case.json --level            the review level the core picks from the case's research result
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = name => new URL(name, import.meta.url)
const TEMPLATE = readFileSync(here('ticket-tdd.js.tmpl'), 'utf8')
export const DEFAULT = JSON.parse(readFileSync(here('default.json'), 'utf8'))
const LENSES = ['checklist', 'code']

// Duty texts, inserted into a JS template literal. Probe and same-frame are drafts for the ablation experiments to settle.
const TEST_CASE_REVIEW_CODE = 'A test the diff weakened, deleted or left asserting nothing it promises is a finding. '
const TEST_CASE_REVIEW_FIX = '; (3) no test was weakened, deleted or left asserting nothing it promises'
const PROBE = ' PROBE (experiment draft): make one targeted run of the changed path the way its consumer runs it — the built program on an input that takes a new branch — even when reading seems to settle it; name the command and what it showed in `checked`. A behaviour that differs from the ticket is a finding with that run as its trigger.'
const SAME_FRAME = ' SAME-FRAME RULE (experiment draft): for each piece of state the diff adds or writes, list the events that change it and check any two of them arriving in the same frame or tick, in both orders; a wrong result is a finding whose trigger names both events.'

const literal = s => s.replace(/[`\\]/g, '\\$&').replace(/\$\{/g, '\\${')
const js = v => v === null ? 'null' : Array.isArray(v) ? `[${v.map(js).join(', ')}]` : `'${v}'`

export function render(config) {
  for (const k of Object.keys(config)) if (!(k in DEFAULT)) throw new Error(`unknown config key: ${k}`)
  // A config names only what it changes; each key merges over the default's.
  const { models, lenses, duties } = Object.fromEntries(Object.keys(DEFAULT).map(k => [k, Object.assign({}, DEFAULT[k], config[k])]))
  for (const l of Object.values(lenses).flat()) if (!LENSES.includes(l)) throw new Error(`unknown lens: ${l}`)
  const slots = {
    models: `{ ${Object.entries(models).map(([k, v]) => `${k}: ${js(v)}`).join(', ')} }`,
    'lenses.light': js(lenses.light),
    'lenses.standard': js(lenses.standard),
    'lenses.heavy': js(lenses.heavy),
    probe: duties.probe ? literal(PROBE) : '',
    same_frame: duties.same_frame ? literal(SAME_FRAME) : '',
    'test_case_review.code': duties.test_case_review ? TEST_CASE_REVIEW_CODE : '',
    'test_case_review.fix': duties.test_case_review ? TEST_CASE_REVIEW_FIX : '',
  }
  return TEMPLATE.replace(/\{\{([\w.]+)\}\}/g, (_, k) => slots[k])
}

// A case: { args, gate_lines, results }. args override the stub args below; gate_lines become the lines of
// every gates step; results[label] is the recorded result of an earlier stage (null: the agent died).
const STUB_ARGS = { repo: '/repo', branch: 'branch', tools: '/tools', run: '/run', base: 'BASE', target: '/ticket.md', baseline: 'BASELINE', profile: {} }
const STUB_RESULTS = {
  research: { requirements: ['R1: the ticket'], facts: [], plan: [], files: [], test_harness: '', risks: [], signals: [], anchors: [] },
  plan: { cases: [{ id: 'C1', requirement: 'R1: the ticket', title: 't', arrange: 'a', act: 'a', asserts: ['x'] }], verify_launch: [], verify_review: [] },
  implement: { committed: true, head: 'HEAD', tests: [{ case_id: 'C1', file: 'f', test: 't' }], unverified: [], gate_output: 'g', commits: [] },
}

// Runs the core on a case: agents answer from the case's results, except `stop`, which never answers.
function drive(source, kase, stop, log) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const core = new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', source.replace('export const meta', 'const meta'))
  const results = Object.assign({}, STUB_RESULTS, kase.results)
  const gates = { head: 'HEAD', gate_lines: kase.gate_lines || ['GATES'], changed_files: [], counts: [], findings: [] }
  const agent = async (prompt, opts) => {
    if (stop(prompt, opts)) return new Promise(() => {})
    const r = opts.label in results ? results[opts.label] : opts.label.startsWith('gates:') ? gates : null
    return r && JSON.parse(JSON.stringify(r))
  }
  const parallel = thunks => Promise.all(thunks.map(t => t().catch(() => null)))
  return core(Object.assign({}, STUB_ARGS, kase.args), agent, parallel, () => {}, log)
}

// The call the agent labelled <label> receives: { prompt, schema, model, effort }.
export function stageCall(source, kase, label) {
  return new Promise((resolve, reject) => {
    const stop = (prompt, opts) => opts.label === label && (resolve({ prompt, schema: opts.schema, model: opts.model, effort: opts.effort }), true)
    drive(source, kase, stop, () => {})
      .then(() => reject(new Error(`stage ${label} not reached; give the case results for the stages before it`)), reject)
  })
}

// The review level the core picks from the case's research result: { level, why }, read from the core's own log line.
export function levelOf(source, kase) {
  return new Promise((resolve, reject) => {
    const log = msg => {
      // ponytail: why is split on '; ' as the core joins it; a reason holding '; ' splits in two.
      const m = /; level (\w+) \((.*)\) -> \d+ review rounds/.exec(msg)
      if (m) resolve({ level: m[1], why: m[2].split('; ') })
    }
    drive(source, kase, (_, opts) => opts.label !== 'research', log)
      .then(() => reject(new Error('the core logged no level')), reject)
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const flag = name => { const i = argv.indexOf(name); return i < 0 ? null : argv.splice(i, 2)[1] }
  const casePath = flag('--case')
  const label = flag('--prompt')
  const json = argv.indexOf('--json') >= 0 && argv.splice(argv.indexOf('--json'), 1)
  const level = argv.indexOf('--level') >= 0 && argv.splice(argv.indexOf('--level'), 1)
  const source = render(argv[0] ? JSON.parse(readFileSync(argv[0], 'utf8')) : DEFAULT)
  if (level) levelOf(source, JSON.parse(readFileSync(casePath, 'utf8')))
    .then(l => process.stdout.write(JSON.stringify(l)), e => { console.error(e.message); process.exit(1) })
  else if (!label) process.stdout.write(source)
  else stageCall(source, casePath ? JSON.parse(readFileSync(casePath, 'utf8')) : {}, label)
    .then(c => process.stdout.write(json ? JSON.stringify(c) : c.prompt), e => { console.error(e.message); process.exit(1) })
}
