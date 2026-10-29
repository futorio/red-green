// Renders the ticket-tdd core from core/*.js and a config, or one stage prompt of that render for a case.
// README § Template.
//
//     node render.mjs [config.json]                                     the workflow script, on stdout
//     node render.mjs [config.json] --case case.json --prompt <label>   the prompt the agent labelled <label> receives
//     ... --prompt <label> --json                                       that prompt with its agent's schema, model and effort, as JSON
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = name => new URL(name, import.meta.url)

// A core directory holds one <block>.js per block: a header, then parts, each opened by a `// @part <name>` line.
// orchestrator.js's `main` part is the script; each of its `// @include <block> <part>` lines is replaced by that
// part. Every part of every other block is included exactly once.
const partsOf = (dir, block) => {
  const [, ...namesAndTexts] = readFileSync(join(dir, `${block}.js`), 'utf8').split(/^\/\/ @part (\S+)\n/m)
  const parts = {}
  for (let i = 0; i < namesAndTexts.length; i += 2) parts[`${block} ${namesAndTexts[i]}`] = namesAndTexts[i + 1]
  return parts
}
export function template(dir) {
  const blocks = readdirSync(dir).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).filter(b => b !== 'orchestrator')
  const unused = Object.assign({}, ...blocks.map(b => partsOf(dir, b)))
  const included = new Set()
  const script = partsOf(dir, 'orchestrator')['orchestrator main'].replace(/^\/\/ @include (\S+ \S+)\n/gm, (_, part) => {
    if (included.has(part)) throw new Error(`part ${part} included twice`)
    if (!(part in unused)) throw new Error(`no part ${part}`)
    const text = unused[part]
    delete unused[part]
    included.add(part)
    return text
  })
  if (Object.keys(unused).length) throw new Error(`parts never included: ${Object.keys(unused).join(', ')}`)
  return script
}
const CORE_DIR = fileURLToPath(here('core/'))
const TEMPLATE = template(CORE_DIR)
// Code of the core's own, the code the script runs: its validator, for the tests and the conformance check, and its
// block config merge with the registry it checks values against (and the schemas the registry is built from).
const PARTS = Object.assign({}, ...readdirSync(CORE_DIR).map(f => partsOf(CORE_DIR, f.slice(0, -3))))
const fromCore = (parts, name) => new Function(`${parts.map(p => PARTS[p]).join('\n')}\nreturn ${name}`)()
export const validate = fromCore(['shared validate'], 'validate')
const mergeBlocks = fromCore(['shared validate', 'shared config'], 'mergeBlocks')
const REGISTRY = fromCore(['shared validate', 'research schema', 'plan schema', 'implement schema', 'review schema', 'shared registry'], 'REGISTRY')
export const DEFAULT = JSON.parse(readFileSync(here('default.json'), 'utf8'))

// A config names only what it changes: its blocks merge over the default's, as profile.blocks merges at run time.
// The one render-time slot is {{blocks}}; every other {{path}} is a run-time template variable.
export function render(config) {
  for (const k of Object.keys(config)) if (!(k in DEFAULT)) throw new Error(`unknown config key: ${k}`)
  const { merged, errors } = mergeBlocks(DEFAULT.blocks, config.blocks, REGISTRY)
  if (errors.length) throw new Error(errors.join('; '))
  return TEMPLATE.replace('{{blocks}}', JSON.stringify(merged))
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
