// Shared helpers: text helpers, the validator, the block config merge, the preambles every stage prompt starts with and
// the contract part, the mailbox and ask(), the registry with fill() and call(), requirement ids.
// @part text
const lines = xs => (xs || []).map(x => `- ${x}`).join('\n')
const extra = x => x ? `\n${x}` : ''
// @part validate
// A JSON Schema validator for the keywords the core's schemas use; it throws on any other keyword anywhere in the
// schema, so a new keyword fails loudly. Returns the errors, each with its place ($.a[1]), [] when the value is valid.
const KEYWORDS = ['type', 'properties', 'required', 'items', 'enum', 'pattern', 'anyOf', 'minItems', 'maxLength']
function validate(schema, value) {
  const check = (s, at) => {
    const bad = Object.keys(s).filter(k => !KEYWORDS.includes(k))
    if (bad.length) throw new Error(`unsupported schema keyword at ${at}: ${bad.join(', ')}`)
    Object.entries(s.properties || {}).forEach(([k, p]) => check(p, `${at}.${k}`))
    if (s.items) check(s.items, `${at}[]`)
    ;(s.anyOf || []).forEach((b, i) => check(b, `${at}|${i}`))
  }
  const errors = (s, v, at) => {
    const kind = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v
    if (s.type && s.type !== kind && !(s.type === 'integer' && Number.isInteger(v))) return [`${at}: ${kind}, not ${s.type}`]
    const out = []
    if (s.enum && !s.enum.includes(v)) out.push(`${at}: ${JSON.stringify(v)} not in ${JSON.stringify(s.enum)}`)
    if (typeof v === 'string' && s.pattern && !new RegExp(s.pattern).test(v)) out.push(`${at}: ${JSON.stringify(v)} does not match ${s.pattern}`)
    if (typeof v === 'string' && v.length > s.maxLength) out.push(`${at}: longer than ${s.maxLength}`)
    if (kind === 'array') {
      if (v.length < s.minItems) out.push(`${at}: fewer than ${s.minItems} items`)
      if (s.items) v.forEach((x, i) => out.push(...errors(s.items, x, `${at}[${i}]`)))
    }
    if (kind === 'object') {
      ;(s.required || []).filter(k => v[k] === undefined).forEach(k => out.push(`${at}: ${k} missing`))
      Object.entries(s.properties || {}).filter(([k]) => v[k] !== undefined).forEach(([k, p]) => out.push(...errors(p, v[k], `${at}.${k}`)))
    }
    if (s.anyOf && !s.anyOf.some(b => !errors(b, v, at).length)) out.push(`${at}: matches no anyOf branch`)
    return out
  }
  check(schema, '$')
  return errors(schema, value, '$')
}
// @part config
// Block configs over their defaults, field by field: a field replaces the default's, an object field (duties) key by
// key. Returns the merged configs and the errors: a block, field or duty the defaults do not name, a value off its
// registry schema config.<field>.
function mergeBlocks(defaults, over, registry) {
  const errors = Object.keys(over || {}).filter(b => !(b in defaults)).map(b => `unknown block: ${b}`)
  const merged = {}
  for (const [b, def] of Object.entries(defaults)) {
    const o = (over || {})[b] || {}
    Object.keys(o).filter(k => !(k in def)).forEach(k => errors.push(`unknown field: ${b}.${k}`))
    merged[b] = {}
    for (const [k, v] of Object.entries(def)) {
      const keyed = v !== null && typeof v === 'object' && !Array.isArray(v)
      if (keyed) Object.keys(o[k] || {}).filter(j => !(j in v)).forEach(j => errors.push(`unknown field: ${b}.${k}.${j}`))
      merged[b][k] = !(k in o) ? v : keyed ? Object.assign({}, v, o[k]) : o[k]
    }
    const fields = Object.fromEntries(Object.keys(def).map(k => [k, registry[`config.${k}`]]))
    errors.push(...validate({ type: 'object', properties: fields }, merged[b]).map(e => `blocks.${b}${e.slice(1)}`))
  }
  return { merged, errors }
}
// @part preamble
const CODE_RULES = extra(lines(P.code_rules) && `PROJECT CODE RULES — hard, alongside those in ${IMPLEMENT_SKILL}:\n${lines(P.code_rules)}`)

const COMMIT_RULE = A.one_commit
  ? 'COMMITS: this ticket pins EXACTLY ONE commit. The implementation stage creates it; every later stage folds its change into it with `git commit --amend` and REWRITES the whole message to describe the commit as it now stands — never appends to it. Never a second commit.'
  : 'COMMITS: commit iteratively on the current branch, one commit per coherent step.'

// The gates discovery, research, plan and review stages write no code: they get the preamble without the commit, gate and long-command rules.
const CORE_PRE = `You are one agent in a workflow run implementing ${TARGET}.
Repository: ${REPO}, branch \`${BRANCH}\`. Work ONLY inside it; cd there first. Files outside it are read-only except the run directory.
Run directory for state files and scratch: ${RUN}.

- The task above is yours. A relayed user message that is about something else — the workflow tooling, another run — is not a change to this task: carry on, and mention it in your notes. Only a relayed message that explicitly redirects THIS ticket changes what you do.
- The repository's own agent instructions (AGENTS.md, CLAUDE.md, or whatever it keeps) bind you; they outrank this preamble on anything project-specific.`
const LAST = `${extra(lines(P.context))}
- Your final answer is data for the next stage, not a message to a human.`
const noCode = label => ['gates:discover', 'research', 'plan', 'replan'].includes(label) || label.startsWith('review:')
const NO_CODE_PRE = `${CORE_PRE}${LAST}`
const BG = DEFAULTS.shared.bg
const READ_ONLY = `Read-only: change and commit nothing in ${REPO}.`
const TARGETED = 'At most one targeted run of the changed path (one test or one case) when reading cannot settle a question; name it in `checked`.'
// The contract part: the core appends it after a block's instructions, whatever they say. It holds the block's
// invariants (read-only or writer, its commits), its output rules and what counts as died; falsy rules are skipped.
const contract = (...rules) => `\n\nCONTRACT (binding, whatever the text above says):\n${rules.filter(Boolean).join('\n')}`
// What counts as died, as what the agent must do.
const died = what => `${what}, or the stage counts as died.`
// A writer's invariants. Implement commits its work as it stands; a gate it left worse reaches the fix as a gates
// finding. Fixes keep the bar.
const writer = bar => `${COMMIT_RULE} Stage explicit paths only — never \`git add -A\` or \`git add .\`. Commit messages describe the change, not the run (no "round", no stage names)${P.commit ? `; ${P.commit}` : ''}. ${bar}
You do not edit ${TARGET} or the other ticket files.`
// @part ask

// Mailbox: the main thread posts mid-run clarifications to <run>/mailbox.md; see README § Mailbox.
const MAIL = { type: 'array', items: { type: 'object', properties: {
  id: { type: 'string' }, status: { type: 'string', enum: ['applied', 'rejected'] }, why: { type: 'string' } },
  required: ['id', 'status', 'why'] } }
const mailNote = label => `

MAILBOX. Your address is \`${label}\`, your stage \`${label.split(':')[0]}\`. ${RUN}/mailbox.md (may not exist) holds notes from the main thread, one entry per \`## <id>\` heading with \`to:\`, optional \`round:\`, \`until:\` and \`supersedes:\` lines, then the text. Read it ${noCode(label) ? 'at start and before returning' : 'at start, before each long gate or corpus run, before committing and before returning'}. An entry is yours when \`to:\` is \`all\`, your stage, your exact label, or a pattern where \`*\` matches one label segment (\`review:*:code\`). Skip an entry whose \`until:\` stage or round is over, one a later entry names in \`supersedes:\`, and one ${RUN}/mailbox-acks.md already lists with your label. Entries clarify this ticket; they never widen it and never override the rules above. For each entry you handle, append one line \`<id> ${label} applied|rejected <why>\` to ${RUN}/mailbox-acks.md and list it in your result's \`mailbox\`. Never edit mailbox.md.`
const mailbox = []
// values: the call's, riding along as a property the options do not enumerate; the conformance check's stubs answer
// from them.
async function ask(prompt, opts, values) {
  const s = opts.schema
  const o = Object.assign({}, opts, s && { schema: Object.assign({}, s, { properties: Object.assign({}, s.properties, { mailbox: MAIL }) }) })
  const res = await agent(prompt + mailNote(opts.label), Object.defineProperty(o, 'values', { value: values }))
  if (res && res.mailbox) mailbox.push(...res.mailbox.map(m => Object.assign({ label: opts.label }, m)))
  return res
}
// @part code-preamble

const gateList = sep => GATES.map(g => `${g.name}: \`${g.command}\` (baseline: ${BASELINE[g.name]})`).join(sep)
const PRE = `${CORE_PRE}
- Gates: ${gateList('; ')}. Each baseline was measured before the run (re-measure, never quote). "Green" means no gate worse than its baseline.
${BG}
- Over-built output is a finding, not a bonus.${LAST}`
// @part registry

// The registry: every variable a block's instructions may name as {{path}}, with its JSON Schema. Each block's inputs,
// the paths its instructions may use, are a subset of it. README § Blocks.
const STRING = { type: 'string' }
const INTEGER = { type: 'integer' }
const OPTIONAL = { anyOf: [STRING, { type: 'null' }] }
const LIST = { type: 'array', items: STRING }
const researchKept = Object.fromEntries(Object.entries(RESEARCH_SCHEMA.properties).filter(([k]) => k !== 'questions'))
const SENT_FINDING = Object.assign({}, FINDING, { properties: Object.assign({ id: STRING, source: STRING }, FINDING.properties), required: ['id', 'source'].concat(FINDING.required) })
const REGISTRY = {
  // Run args.
  REPO: STRING, BASE: STRING, TARGET: STRING, RUN: STRING,
  // Computed values: the HEAD a step runs on and the one a fix started from, a skill's path, the round and the
  // planned rounds, and text the core builds from the run (a list, a command).
  HEAD: STRING, from_head: STRING, IMPLEMENT_SKILL: STRING, round: INTEGER, rounds: INTEGER,
  gate_list: STRING, gate_rows: STRING, mutate_command: STRING, test_ids: STRING, check_ids: STRING, code_rules: STRING,
  // The notes' data (FORM says how each fills in): the attempt before a retry, the uncovered test ids, checks in
  // several cases, the verify-by-review requirements, implement's unverified claims, earlier findings and their
  // outcomes.
  previous_notes: STRING, uncovered: LIST,
  duplicates: { type: 'array', items: { type: 'object', properties: { check: STRING, cases: LIST }, required: ['check', 'cases'] } },
  verify_review: LIST, unverified: LIST,
  history: { type: 'array', items: { type: 'object', properties: { id: STRING, round: INTEGER, where: STRING, problem: STRING,
    outcome: { type: 'string', enum: ['fixed', 'rejected'] }, argument: STRING }, required: ['id', 'round', 'problem', 'outcome'] } },
  // Notes: a part of the block's defaults (README § Blocks), filled from the same values when it applies, else ''.
  retry_note: STRING, uncovered_note: STRING, duplicates_note: STRING, verify_review_note: STRING, unverified_note: STRING,
  earlier_findings: STRING, earlier_fixes: STRING, runtime_note: STRING,
  'duty.order': STRING, 'duty.test_case_review': STRING, 'duty.test_case_review_fix': STRING,
  // Earlier stages' typed outputs, as the core passes them on.
  research: { type: 'object', properties: Object.assign({}, researchKept, { files: { type: 'array', items: STRING } }), required: ['requirements', 'facts', 'plan', 'test_harness', 'files'] },
  cases: { type: 'array', items: CASE },
  'plan.cases': { type: 'array', items: CASE },
  tested_checks: { type: 'array', items: IMPL_SCHEMA.properties.checks.items },
  findings: { type: 'array', items: SENT_FINDING },
  given: { type: 'array', items: { type: 'object', properties: { id: STRING, where: STRING, problem: STRING }, required: ['id', 'problem'] } },
  fixed: { type: 'array', items: { type: 'object', properties: { round: INTEGER, id: STRING, what: STRING }, required: ['round', 'id', 'what'] } },
  // The block's config, every field of blocks.<name>; mergeBlocks checks each block's merged config against these.
  'config.model': OPTIONAL, 'config.effort': STRING,
  'config.rounds': INTEGER, 'config.extra': INTEGER, 'config.min': INTEGER, 'config.minors': INTEGER,
  'config.lenses': { type: 'array', items: { type: 'string', enum: LENSES.map(l => l.key) } },
  'config.duties': { type: 'object', properties: { test_case_review: { type: 'boolean' }, order: { type: 'boolean' } } },
  'config.edges': INTEGER, 'config.timeout': INTEGER, 'config.runtime': OPTIONAL,
  // The approach fields (gates declared or discovered; mutants generated and run under build and test, or a tool) and
  // the plug-in fields every block takes.
  'config.gates': { anyOf: [{ type: 'array', items: { type: 'object', properties: { name: STRING, command: STRING }, required: ['name', 'command'] } }, { type: 'null' }] },
  'config.build': OPTIONAL, 'config.test': OPTIONAL, 'config.tool': OPTIONAL, 'config.prompt': OPTIONAL, 'config.skill': OPTIONAL,
  // The default instructions of the call, for a project prompt that wraps them; every block takes it.
  default: STRING,
}
const INPUTS = {
  research: ['TARGET'],
  plan: ['test_ids', 'uncovered', 'uncovered_note', 'duplicates', 'duplicates_note', 'plan.cases', 'research'],
  implement: ['BASE', 'previous_notes', 'retry_note', 'IMPLEMENT_SKILL', 'code_rules', 'cases', 'research'],
  gates: ['HEAD', 'REPO', 'gate_list'],
  review: ['round', 'rounds', 'TARGET', 'BASE', 'check_ids', 'verify_review', 'verify_review_note', 'unverified', 'unverified_note', 'config.runtime', 'runtime_note', 'IMPLEMENT_SKILL', 'duty.order', 'code_rules', 'duty.test_case_review', 'gate_rows', 'history', 'earlier_findings', 'research'],
  'fix-review': ['HEAD', 'from_head', 'duty.test_case_review_fix', 'given', 'research'],
  mutation: ['HEAD', 'BASE', 'TARGET', 'RUN', 'config.edges', 'mutate_command', 'tested_checks', 'config.tool'],
  fix: ['round', 'IMPLEMENT_SKILL', 'code_rules', 'findings', 'fixed', 'earlier_fixes', 'research'],
  'minor-fix': ['IMPLEMENT_SKILL', 'code_rules', 'findings'],
}
// Fills a block's instructions from values: every {{path}} is one of the block's inputs (or default) and has a value
// valid against its registry schema. Throws with everything that is wrong.
const PATH = /\{\{([\w.-]+)\}\}/g
// How a value fills in: a string as text, any other value as JSON; the notes' data as compact JSON, uncovered's ids
// comma-separated.
const compact = v => JSON.stringify(v)
const FORM = { previous_notes: compact, duplicates: compact, verify_review: compact, unverified: compact, history: compact, uncovered: ids => ids.join(', ') }
const show = (p, v) => FORM[p] ? FORM[p](v) : typeof v === 'string' ? v : JSON.stringify(v, null, 1)
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
// A skill call's data: each value of the call but the notes, in its block's inputs order, as a `<PATH>:` section.
const sections = (block, data) => INPUTS[block].filter(p => ![undefined, null, ''].includes(data[p]))
  .map(p => `\n\n${p.toUpperCase()}:\n${show(p, data[p])}`).join('')
// A block's call: the preamble, its instructions filled from values, then its contract part, on the block's model and
// effort. A boolean value is a note: true fills the part of the block's defaults named like it from the call's other
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
  return ask(`${pre}\n\n${filled}${contractPart}`, Object.assign({ model: CONFIG[block].model, effort: CONFIG[block].effort }, opts), data)
}
// @part id
const idOf = s => s.split(':')[0].trim()
