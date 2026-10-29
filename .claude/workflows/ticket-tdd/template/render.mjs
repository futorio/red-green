// Renders the ticket-tdd core from core/*.js and a config, or one stage prompt of that render for a case.
// README § Template.
//
//     node render.mjs [config.json]                                     the workflow script, on stdout
//     node render.mjs [config.json] --case case.json --prompt <label>   the prompt the agent labelled <label> receives
//     ... --prompt <label> --json                                       that prompt with its agent's schema, model and effort, as JSON
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = name => new URL(name, import.meta.url)
// core/<file>.js: a header, then parts, each opened by a `// @part <name>` line. The orchestrator's `main` part is the
// script; each of its `// @include <file> <part>` lines is replaced by that part. Every part is included exactly once.
const BLOCKS = ['shared', 'gates', 'research', 'plan', 'implement', 'review', 'mutation', 'fix', 'fix-review', 'minor-fix']
const partsOf = file => {
  const [, ...xs] = readFileSync(here(`core/${file}.js`), 'utf8').split(/^\/\/ @part (\S+)\n/m)
  return Object.fromEntries(xs.flatMap((x, i) => i % 2 ? [] : [[`${file} ${x}`, xs[i + 1]]]))
}
const PARTS = Object.assign({}, ...BLOCKS.map(partsOf))
const TEMPLATE = partsOf('orchestrator')['orchestrator main'].replace(/^\/\/ @include (\S+ \S+)\n/gm, (_, k) => {
  if (!(k in PARTS)) throw new Error(`no part ${k}, or included twice`)
  const text = PARTS[k]
  delete PARTS[k]
  return text
})
if (Object.keys(PARTS).length) throw new Error(`parts never included: ${Object.keys(PARTS).join(', ')}`)
export const DEFAULT = JSON.parse(readFileSync(here('default.json'), 'utf8'))
const LENSES = ['checklist', 'code']

// Duty texts, inserted into a JS template literal. Order is a draft for the ablation experiments to settle.
const TEST_CASE_REVIEW_CODE = 'A test the diff weakened, deleted or left asserting nothing it promises is a finding. '
const TEST_CASE_REVIEW_FIX = '; (3) no test was weakened, deleted or left asserting nothing it promises'
const ORDER = ' ORDER RULE (experiment draft): for each piece of state the diff adds or writes, list every path that changes it (handlers, callbacks, requests, retries, timers). For any two that can land in one unit of processing (tick, frame, event-loop turn, request, transaction, the span between two awaits), check the result in both orders and with one of them repeated; a result that depends on order or repetition is a finding whose trigger names both events.'

const literal = s => s.replace(/[`\\]/g, '\\$&').replace(/\$\{/g, '\\${')
const js = v => v === null ? 'null' : Array.isArray(v) ? `[${v.map(js).join(', ')}]` : `'${v}'`

export function render(config) {
  for (const k of Object.keys(config)) if (!(k in DEFAULT)) throw new Error(`unknown config key: ${k}`)
  for (const k of ['models', 'duties']) for (const j of Object.keys(config[k] || {})) if (!(j in DEFAULT[k])) throw new Error(`unknown config key: ${k}.${j}`)
  // A config names only what it changes; each object key merges over the default's, a lens list replaces it.
  const { models, duties } = Object.fromEntries(['models', 'duties'].map(k => [k, Object.assign({}, DEFAULT[k], config[k])]))
  const lenses = config.lenses || DEFAULT.lenses
  for (const l of lenses) if (!LENSES.includes(l)) throw new Error(`unknown lens: ${l}`)
  const slots = {
    models: `{ ${Object.entries(models).map(([k, v]) => `${k}: ${js(v)}`).join(', ')} }`,
    lenses: js(lenses),
    order: duties.order ? literal(ORDER) : '',
    'test_case_review.code': duties.test_case_review ? TEST_CASE_REVIEW_CODE : '',
    'test_case_review.fix': duties.test_case_review ? TEST_CASE_REVIEW_FIX : '',
  }
  return TEMPLATE.replace(/\{\{([\w.]+)\}\}/g, (_, k) => slots[k])
}

// A case: { args, gate_lines, results }. args override the stub args below; gate_lines become the lines of the
// declared gates, in order, in every gates step; results[label] is the recorded result of an earlier stage (null: the agent died).
const STUB_ARGS = { repo: '/repo', branch: 'branch', tools: '/tools', run: '/run', base: 'BASE', target: '/ticket.md', baseline: { gates: 'BASELINE' }, profile: { gates: [{ name: 'gates', command: 'GATES' }] } }
const STUB_RESULTS = {
  research: { requirements: ['R1: the ticket'], facts: [], plan: [], test_harness: [{ requirement: 'R1', by: 'test', how: 'h' }] },
  plan: { cases: [{ id: 'C1', requirement: 'R1', title: 't', arrange: 'a', act: 'a', asserts: ['x'] }] },
  'gates:discover': { gates: [{ name: 'gates', command: 'GATES', source: 'STUB', line: 'BASELINE' }], questions: [] },
  implement: { head: 'HEAD', checks: [{ kind: 'case', ref: 'C1', requirement: 'R1', test: { file: 'f', name: 't' } }], unverified: [], questions: [] },
}

// Runs the core on a case: agents answer from the case's results, except `stop`, which never answers.
function drive(source, kase, stop) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const core = new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', source.replace('export const meta', 'const meta'))
  const results = Object.assign({}, STUB_RESULTS, kase.results)
  const gates = names => ({ head: 'HEAD', gates: names.map((name, i) => ({ name, status: 'green', line: (kase.gate_lines || [])[i] || 'GATES' })) })
  const agent = async (prompt, opts) => {
    if (stop(prompt, opts)) return new Promise(() => {})
    const r = opts.label in results ? results[opts.label] : opts.label.startsWith('gates:') ? gates(opts.schema.properties.gates.items.properties.name.enum) : null
    return r && JSON.parse(JSON.stringify(r))
  }
  const parallel = thunks => Promise.all(thunks.map(t => t().catch(() => null)))
  return core(Object.assign({}, STUB_ARGS, kase.args), agent, parallel, () => {}, () => {})
}

// The call the agent labelled <label> receives: { prompt, schema, model, effort }.
export function stageCall(source, kase, label) {
  return new Promise((resolve, reject) => {
    const stop = (prompt, opts) => opts.label === label && (resolve({ prompt, schema: opts.schema, model: opts.model, effort: opts.effort }), true)
    drive(source, kase, stop)
      .then(() => reject(new Error(`stage ${label} not reached; give the case results for the stages before it`)), reject)
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const flag = name => { const i = argv.indexOf(name); return i < 0 ? null : argv.splice(i, 2)[1] }
  const casePath = flag('--case')
  const label = flag('--prompt')
  const json = argv.indexOf('--json') >= 0 && argv.splice(argv.indexOf('--json'), 1)
  const source = render(argv[0] ? JSON.parse(readFileSync(argv[0], 'utf8')) : DEFAULT)
  if (!label) process.stdout.write(source)
  else stageCall(source, casePath ? JSON.parse(readFileSync(casePath, 'utf8')) : {}, label)
    .then(c => process.stdout.write(json ? JSON.stringify(c) : c.prompt), e => { console.error(e.message); process.exit(1) })
}
