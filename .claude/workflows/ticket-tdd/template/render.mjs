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
// A defaults directory holds one <block>.md per block: a header, then parts, each opened by a `<!-- @part <name> -->`
// line. A part is its lines verbatim, its last newline dropped; `{{> <block> <part>}}` in it is replaced by that part.
export function defaults(dir) {
  const raw = {}
  for (const f of readdirSync(dir).filter(f => f.endsWith('.md'))) {
    const [, ...namesAndTexts] = readFileSync(join(dir, f), 'utf8').split(/^<!-- @part (\S+) -->\n/m)
    const parts = raw[f.slice(0, -3)] = {}
    for (let i = 0; i < namesAndTexts.length; i += 2) parts[namesAndTexts[i]] = namesAndTexts[i + 1].replace(/\n$/, '')
  }
  const expand = (text, seen) => text.replace(/\{\{> (\S+) (\S+)\}\}/g, (_, b, p) => {
    const part = `${b} ${p}`
    if (!(b in raw && p in raw[b])) throw new Error(`no default part ${part}`)
    if (seen.includes(part)) throw new Error(`default part ${part} includes itself`)
    return expand(raw[b][p], seen.concat(part))
  })
  return Object.fromEntries(Object.entries(raw).map(([b, parts]) =>
    [b, Object.fromEntries(Object.entries(parts).map(([p, text]) => [p, expand(text, [`${b} ${p}`])]))]))
}
const CORE_DIR = fileURLToPath(here('core/'))
const TEMPLATE = template(CORE_DIR)
const DEFAULT_TEXTS = defaults(fileURLToPath(here('defaults/')))
// Code of the core's own, the code the script runs: its validator, for the tests and the conformance check, and its
// block config merge with the registry it checks values against (and the schemas the registry is built from).
const PARTS = Object.assign({}, ...readdirSync(CORE_DIR).map(f => partsOf(CORE_DIR, f.slice(0, -3))))
const fromCore = (parts, name) => new Function(`${parts.map(p => PARTS[p]).join('\n')}\nreturn ${name}`)()
export const validate = fromCore(['shared validate'], 'validate')
const mergeBlocks = fromCore(['shared validate', 'shared config'], 'mergeBlocks')
export const REGISTRY = fromCore(['shared validate', 'research schema', 'plan schema', 'implement schema', 'review schema', 'registry types',
  ...Object.keys(PARTS).filter(p => p.endsWith(' inputs')), 'registry registry'], 'REGISTRY')
export const DEFAULT = JSON.parse(readFileSync(here('default.json'), 'utf8'))

// A config names only what it changes: its blocks merge over the default's, as profile.blocks merges at run time.
// The render-time slots are {{blocks}} and {{defaults}}, the inlined default instructions; every other {{path}} is a
// run-time template variable.
export function render(config) {
  for (const k of Object.keys(config)) if (!(k in DEFAULT)) throw new Error(`unknown config key: ${k}`)
  const { merged, errors } = mergeBlocks(DEFAULT.blocks, config.blocks, REGISTRY)
  if (errors.length) throw new Error(errors.join('; '))
  const slots = { blocks: merged, defaults: DEFAULT_TEXTS }
  return TEMPLATE.replace(/\{\{(blocks|defaults)\}\}/g, (_, slot) => JSON.stringify(slots[slot]))
}

// A case: { args, gate_lines, results }. args override the stub args below; gate_lines become the lines of the
// declared gates, in order, in every gates step; results[label] is the recorded result of an earlier stage (null: the agent died).
const STUB_ARGS = { repo: '/repo', branch: 'branch', tools: '/tools', run: '/run', base: 'BASE', target: '/ticket.md', baseline: { gates: 'BASELINE' }, profile: { blocks: { gates: { gates: [{ name: 'gates', command: 'GATES' }] } } } }
const STUB_RESULTS = {
  research: { requirements: ['R1: the ticket'], facts: [], plan: [], test_harness: [{ requirement: 'R1', by: 'test', how: 'h' }] },
  plan: { cases: [{ id: 'C1', requirement: 'R1', title: 't', arrange: 'a', act: 'a', asserts: ['x'] }] },
  'gates:discover': { gates: [{ name: 'gates', command: 'GATES', source: 'STUB', line: 'BASELINE' }], questions: [] },
  implement: { head: 'HEAD', checks: [{ kind: 'case', ref: 'C1', requirement: 'R1', test: { file: 'f', name: 't' } }], unverified: [], questions: [] },
}

// Runs the core on a case: agents answer from the case's results, except `stop`, which never answers; a label with no
// result gets answer's (given the label and the call's values), a gates step green rows, any other none.
function drive(source, kase, stop, answer) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const core = new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', source.replace('export const meta', 'const meta'))
  const results = Object.assign({}, STUB_RESULTS, kase.results)
  const gates = names => ({ head: 'HEAD', gates: names.map((name, i) => ({ name, status: 'green', line: (kase.gate_lines || [])[i] || 'GATES' })) })
  const agent = async (prompt, opts) => {
    if (stop(prompt, opts)) return new Promise(() => {})
    const r = opts.label in results ? results[opts.label] : answer && answer(opts.label, opts.values) || (opts.label.startsWith('gates:') ? gates(opts.schema.properties.gates.items.properties.name.enum) : null)
    return r && JSON.parse(JSON.stringify(r))
  }
  const parallel = thunks => Promise.all(thunks.map(t => t().catch(() => null)))
  // replay: recorded results stand as given; the core skips research's own-output check.
  return core(Object.assign({}, STUB_ARGS, kase.args, { replay: true }), agent, parallel, () => {}, () => {})
}

// The call the agent labelled <label> receives: { prompt, schema, model, effort }.
export function stageCall(source, kase, label) {
  return new Promise((resolve, reject) => {
    const stop = (prompt, opts) => opts.label === label && (resolve({ prompt, schema: opts.schema, model: opts.model, effort: opts.effort }), true)
    // A run that failed before the label names its failure; one that ended without it needs the earlier stages' results.
    drive(source, kase, stop)
      .then(r => reject(new Error(r && r.status === 'failed' ? `stage ${label} not reached: run failed at ${r.stage}: ${[r.note].concat(r.failures).filter(Boolean).join('; ') || 'its agent died'}`
        : `stage ${label} not reached; give the case results for the stages before it`)), reject)
  })
}

// The conformance check: a block's real output, given as the result of the agent labelled <label>, through a run whose
// other blocks answer clean from their calls' values: review lenses with a met row per requirement id and no finding,
// the mutation step not applying, each fix rejecting every finding it is sent and deleting its proofs. Reports the
// output's schema errors (against the schema that agent gets), every finding the script sent to a fix (`sent_to`: its
// label), and the run's result: its status, failures, verdicts, leftover and advisory findings, mutation, research
// issues and unverified list; a run the output breaks reports the error as crash. It passes when there is no schema
// error, failure or crash.
export async function conform(source, kase, label, output) {
  const { schema } = await stageCall(source, kase, label)
  const sent = []
  const answer = (l, values) => {
    if (/^review:r\d+:checklist$/.test(l)) {
      const ids = values.check_ids.split(', ').filter(Boolean)
      return { verdict: 'clean', findings: [], checked: ids.map(item => ({ item, evidence: 'stub', status: 'met', promise: 'stub', counterexample: 'stub' })) }
    }
    if (l.startsWith('review:')) return { verdict: 'clean', findings: [], checked: [{ item: 'stub', evidence: 'stub' }] }
    if (l === 'mutation') return { applies: false, ran: false, mutants: [] }
    if (!l.startsWith('fix:')) return null
    const given = values.findings
    sent.push(...given.map(f => Object.assign({ sent_to: l }, f)))
    return { applied: [], rejected: given.map(f => ({ id: f.id, argument: 'conformance stub' })), proofs: given.filter(f => f.proof).map(f => ({ id: f.id, path: f.proof.path, outcome: 'deleted' })), head: 'HEAD' }
  }
  const report = { label, schema_errors: validate(schema, output) }
  try {
    const r = await drive(source, Object.assign({}, kase, { results: Object.assign({}, kase.results, { [label]: output }) }), () => false, answer)
    Object.assign(report, { findings: sent, status: r.status, failures: r.failures }, ...['note', 'verdicts', 'leftover_findings', 'advisory', 'mutation', 'research_issues', 'unverified'].filter(k => k in r).map(k => ({ [k]: r[k] })))
  } catch (e) {
    // The script runs as an AsyncFunction body, two lines below the header the constructor adds.
    const at = /<anonymous>:(\d+):\d+/.exec(e.stack)
    report.crash = at ? `${e.message}, at line ${at[1] - 2} of the script: ${source.split('\n')[at[1] - 3].trim()}` : e.message
  }
  report.passed = !report.schema_errors.length && !report.crash && !report.failures.length
  return report
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const flag = name => { const i = argv.indexOf(name); return i < 0 ? null : argv.splice(i, 2)[1] }
  const casePath = flag('--case')
  const label = flag('--prompt')
  const at = argv.indexOf('--conform')
  const [, checked, outputPath] = at < 0 ? [] : argv.splice(at, 3)
  const json = argv.indexOf('--json') >= 0 && argv.splice(argv.indexOf('--json'), 1)
  const source = render(argv[0] ? JSON.parse(readFileSync(argv[0], 'utf8')) : DEFAULT)
  const kase = casePath ? JSON.parse(readFileSync(casePath, 'utf8')) : {}
  const fail = e => { console.error(e.message); process.exit(1) }
  if (checked) conform(source, kase, checked, JSON.parse(readFileSync(outputPath, 'utf8')))
    .then(r => { process.stdout.write(`${JSON.stringify(r, null, 1)}\n`); process.exitCode = r.passed ? 0 : 1 }, fail)
  else if (!label) process.stdout.write(source)
  else stageCall(source, kase, label).then(c => process.stdout.write(json ? JSON.stringify(c) : c.prompt), fail)
}
