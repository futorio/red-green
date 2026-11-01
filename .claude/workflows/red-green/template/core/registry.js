// The registry (every path a block's instructions may name, with its schema), assembled from the paths several blocks
// share and the blocks' inputs parts, fill() and call(). docs/red-green/blocks.md. It reads RESEARCH_SCHEMA, FINDING, LENSES,
// CONFIG, DEFAULTS, failures, validate and ask.
// @part types

// The registry: every variable a block's instructions may name as {{path}}, with its JSON Schema. Each block's inputs,
// the paths its instructions may use, are a subset of it. docs/red-green/blocks.md. A block's inputs part sets INPUTS.<block>
// and adds to BLOCK_PATHS the paths only that block reads; the registry part adds the paths several blocks share.
const STRING = { type: 'string' }
const INTEGER = { type: 'integer' }
const OPTIONAL = { anyOf: [STRING, { type: 'null' }] }
const LIST = { type: 'array', items: STRING }
const INPUTS = {}
const BLOCK_PATHS = {}
// @part registry
// The research input requires nothing extra: the limits research's own checks hold (the `R<n>: ` prefix, a plan step's
// 600 characters) are left out, so a result recorded before a limit still fills a later block.
const researchKept = Object.assign(Object.fromEntries(Object.entries(RESEARCH_SCHEMA.properties).filter(([k]) => k !== 'questions')), { requirements: LIST, plan: LIST })
const SENT_FINDING = Object.assign({}, FINDING, { properties: Object.assign({ id: STRING, source: STRING }, FINDING.properties), required: ['id', 'source'].concat(FINDING.required) })
const REGISTRY = Object.assign({
  // Run args.
  REPO: STRING, BASE: STRING, TARGET: STRING, RUN: STRING,
  // Computed values: the HEAD a step runs on and the one a fix started from, a skill's path, the round and the
  // planned rounds, and text the core builds from the run (a list, a command).
  HEAD: STRING, from_head: STRING, IMPLEMENT_SKILL: STRING, round: INTEGER, rounds: INTEGER,
  gate_command: STRING, gate_rows: STRING, mutate_command: STRING, test_ids: STRING, check_ids: STRING, code_rules: STRING,
  // The notes' data (FORM says how each fills in) research and implement share: the attempt before a retry.
  previous_notes: STRING,
  // Notes: a part of the block's defaults (docs/red-green/blocks.md), filled from the same values when it applies, else ''.
  retry_note: STRING, uncovered_note: STRING, duplicates_note: STRING, verify_review_note: STRING, unverified_note: STRING,
  earlier_findings: STRING, earlier_fixes: STRING, runtime_note: STRING,
  'duty.order': STRING, 'duty.test_case_review': STRING, 'duty.test_case_review_fix': STRING,
  // Earlier stages' typed outputs several blocks take, as the core passes them on.
  research: { type: 'object', properties: Object.assign({}, researchKept, { files: { type: 'array', items: STRING } }), required: ['requirements', 'facts', 'plan', 'test_harness', 'files'] },
  findings: { type: 'array', items: SENT_FINDING },
  // The block's config, every field of blocks.<name>; mergeBlocks checks each block's merged config against these.
  'config.model': OPTIONAL, 'config.effort': STRING,
  'config.rounds': INTEGER, 'config.extra': INTEGER, 'config.min': INTEGER, 'config.minors': INTEGER,
  'config.lenses': { type: 'array', items: { type: 'string', enum: LENSES.map(l => l.key) } },
  'config.duties': { type: 'object', properties: { test_case_review: { type: 'boolean' }, order: { type: 'boolean' } } },
  'config.edges': INTEGER, 'config.timeout': INTEGER, 'config.runtime': OPTIONAL,
  // The approach fields (gates declared; mutants generated and run under build and test, or a tool) and
  // the plug-in fields every block takes.
  'config.gates': { anyOf: [{ type: 'array', items: { type: 'object', properties: { name: STRING, command: STRING, tier: { type: 'string', enum: ['fast', 'round', 'acceptance'] } }, required: ['name', 'command'] } }, { type: 'null' }] },
  'config.build': OPTIONAL, 'config.test': OPTIONAL, 'config.tool': OPTIONAL, 'config.prompt': OPTIONAL, 'config.skill': OPTIONAL,
  // The default instructions of the call, for a project prompt that wraps them; every block takes it.
  default: STRING,
}, BLOCK_PATHS)
// @part call
// Fills a block's instructions from values: every {{path}} is one of the block's inputs (or default) and has a value
// valid against its registry schema. Throws with everything that is wrong.
const PATH = /\{\{([\w.-]+)\}\}/g
// How a value fills in: a string as text (previous_notes as JSON), uncovered's ids comma-separated, any other value as
// compact JSON.
const FORM = { previous_notes: JSON.stringify, uncovered: ids => ids.join(', ') }
const show = (p, v) => FORM[p] ? FORM[p](v) : typeof v === 'string' ? v : JSON.stringify(v)
function fill(block, text, values) {
  const inputs = INPUTS[block].concat('default')
  const used = [...new Set([...text.matchAll(PATH)].map(m => m[1]))]
  const wrong = inputs.filter(p => !(p in REGISTRY)).map(p => `${p} is not in the registry`)
    .concat(used.filter(p => !inputs.includes(p)).map(p => `unknown {{${p}}}`),
      Object.keys(values).filter(p => !inputs.includes(p)).map(p => `${p} is not an input of ${block}`))
  if (wrong.length) throw new Error(wrong.join('; '))
  const errors = validate({ type: 'object', properties: Object.fromEntries(inputs.map(p => [p, REGISTRY[p]])), required: used }, values)
  if (errors.length) throw new Error(errors.join('; '))
  return text.replace(PATH, (_, p) => show(p, values[p]))
}
// A retry's values, research's and implement's: the retry note, on with the attempt before it when there is one.
const retryValues = notes => ({ retry_note: !!notes, previous_notes: notes || undefined })
// A skill call's data: each value of the call but the notes, in its block's inputs order, as a `<PATH>:` section.
const sections = (block, data) => INPUTS[block].filter(p => ![undefined, null, ''].includes(data[p]))
  .map(p => `\n\n${p.toUpperCase()}:\n${show(p, data[p])}`).join('')
// A block's call: the preamble (pre, built for whether the call's schema has notes), its instructions filled from
// values, then its contract part, on the block's model and effort. A boolean value is a note: true fills the part of the block's defaults named like it from the call's other
// values, false makes it ''. The instructions are the block's default part (DEFAULTS[block][part]), or the project's:
// blocks.<block>.prompt, whose {{default}} is that default filled, or reading blocks.<block>.skill followed by the
// call's data. Instructions that do not fill fail the block before the call: the caller gets a dead step, and failures
// says why.
async function call(block, pre, part, values, contractPart, opts) {
  const { prompt, skill } = CONFIG[block]
  const data = Object.fromEntries(Object.entries(values).filter(([, v]) => typeof v !== 'boolean'))
  let filled
  try {
    const all = Object.assign({}, data, ...Object.entries(values).filter(([, v]) => typeof v === 'boolean')
      .map(([k, v]) => ({ [k]: v ? fill(block, DEFAULTS[block][k], data) : '' })))
    const text = DEFAULTS[block][part]
    filled = skill ? fill(block, `Read ${skill} and follow it.`, data) + sections(block, data)
      : !prompt ? fill(block, text, all) : fill(block, prompt, prompt.includes('{{default}}') ? Object.assign(all, { default: fill(block, text, all) }) : all)
  } catch (e) { failures.push(`${opts.label} input: ${e.message}`); return null }
  return ask(`${pre(!!(opts.schema && opts.schema.properties.notes))}\n\n${filled}${contractPart}`, Object.assign({ model: CONFIG[block].model, effort: CONFIG[block].effort }, opts), data)
}
