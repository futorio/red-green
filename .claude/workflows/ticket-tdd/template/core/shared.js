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
// key. Returns the merged configs and the errors: a block, field or duty the defaults do not name, an unknown lens.
const LENS_NAMES = ['checklist', 'code']
function mergeBlocks(defaults, over) {
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
  }
  if (merged.review) merged.review.lenses.filter(l => !LENS_NAMES.includes(l)).forEach(l => errors.push(`unknown lens: ${l}`))
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
const BG = '- A command that runs longer than a couple of minutes goes in the background (`run_in_background`) and is waited on by its completion notice: never a sleep or polling loop, never a second start of a check that is still running.'
const READ_ONLY = `Read-only: change and commit nothing in ${REPO}.`
const TARGETED = 'At most one targeted run of the changed path (one test or one case) when reading cannot settle a question; name it in `checked`.'
// The contract part: the core appends it after a block's instructions, whatever they say. It holds the block's
// invariants (read-only or writer, its commits), its output rules and what counts as died; falsy rules are skipped.
const contract = (...rules) => `\n\nCONTRACT (binding, whatever the text above says):\n${rules.filter(Boolean).join('\n')}`
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
async function ask(prompt, opts) {
  const s = opts.schema
  const res = await agent(prompt + mailNote(opts.label), Object.assign({}, opts, s && { schema: Object.assign({}, s, { properties: Object.assign({}, s.properties, { mailbox: MAIL }) }) }))
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
const S = { type: 'string' }
const INT = { type: 'integer' }
const researchKept = Object.fromEntries(Object.entries(RESEARCH_SCHEMA.properties).filter(([k]) => k !== 'questions'))
const FOUND = Object.assign({}, FINDING, { properties: Object.assign({ id: S, source: S }, FINDING.properties), required: ['id', 'source'].concat(FINDING.required) })
const REGISTRY = {
  // Run args.
  REPO: S, BASE: S, TARGET: S, RUN: S,
  // Computed values: the HEAD a step runs on and the one a fix started from, a skill's path, the round and the
  // planned rounds, and the text the core builds from the run (a list, a command, a sentence or section that is ''
  // when it does not apply, the profile's text for a block).
  HEAD: S, from_head: S, IMPLEMENT_SKILL: S, round: INT, rounds: INT,
  gate_list: S, gate_rows: S, mutate_command: S, test_ids: S, check_ids: S,
  retry_note: S, replan_note: S, verify_review_note: S, unverified_note: S, earlier_findings: S, earlier_fixes: S,
  code_rules: S, 'profile.research': S, 'profile.runtime': S, 'profile.mutation.tool': S,
  'duty.order': S, 'duty.test_case_review': S, 'duty.test_case_review_fix': S,
  // Earlier stages' typed outputs, as the core passes them on.
  research: { type: 'object', properties: Object.assign({}, researchKept, { files: { type: 'array', items: S } }), required: ['requirements', 'facts', 'plan', 'test_harness', 'files'] },
  cases: { type: 'array', items: CASE },
  'plan.cases': { type: 'array', items: CASE },
  tested_checks: { type: 'array', items: IMPL_SCHEMA.properties.checks.items },
  findings: { type: 'array', items: FOUND },
  given: { type: 'array', items: { type: 'object', properties: { id: S, where: S, problem: S }, required: ['id', 'problem'] } },
  // The block's config.
  'config.edges': INT,
  // The block's default instructions, for a project prompt that wraps them.
  default: S,
}
const INPUTS = {
  research: ['TARGET', 'profile.research'],
  plan: ['test_ids', 'replan_note', 'plan.cases', 'research'],
  implement: ['retry_note', 'IMPLEMENT_SKILL', 'code_rules', 'cases', 'research'],
  gates: ['HEAD', 'REPO', 'gate_list'],
  review: ['round', 'rounds', 'TARGET', 'BASE', 'check_ids', 'verify_review_note', 'unverified_note', 'profile.runtime', 'IMPLEMENT_SKILL', 'duty.order', 'code_rules', 'duty.test_case_review', 'gate_rows', 'earlier_findings', 'research'],
  'fix-review': ['HEAD', 'from_head', 'duty.test_case_review_fix', 'given', 'research'],
  mutation: ['HEAD', 'BASE', 'TARGET', 'RUN', 'config.edges', 'mutate_command', 'tested_checks', 'profile.mutation.tool'],
  fix: ['round', 'IMPLEMENT_SKILL', 'code_rules', 'findings', 'earlier_fixes', 'research'],
  'minor-fix': ['IMPLEMENT_SKILL', 'code_rules', 'findings'],
}
// Fills a block's instructions from values: every {{path}} is one of the block's inputs and has a value valid against
// its registry schema. Strings render as text, other values as JSON. Throws with everything that is wrong.
const PATH = /\{\{([\w.-]+)\}\}/g
function fill(block, text, values) {
  const inputs = INPUTS[block]
  const used = [...new Set([...text.matchAll(PATH)].map(m => m[1]))]
  const wrong = inputs.filter(p => !(p in REGISTRY)).map(p => `${p} is not in the registry`)
    .concat(used.filter(p => !inputs.includes(p)).map(p => `unknown {{${p}}}`),
      Object.keys(values).filter(p => !inputs.includes(p)).map(p => `${p} is not an input of ${block}`))
  if (wrong.length) throw new Error(wrong.join('; '))
  const errors = validate({ type: 'object', properties: Object.fromEntries(inputs.map(p => [p, REGISTRY[p]])), required: used }, values)
  if (errors.length) throw new Error(errors.join('; '))
  return text.replace(PATH, (_, p) => typeof values[p] === 'string' ? values[p] : JSON.stringify(values[p], null, 1))
}
// A block's call: the preamble, its instructions filled from values, then its contract part, on the block's model and
// effort. Instructions that do not fill fail the block before the call: the caller gets a dead step, and failures says why.
async function call(block, pre, text, values, terms, opts) {
  let filled
  try { filled = fill(block, text, values) } catch (e) { failures.push(`${opts.label} input: ${e.message}`); return null }
  return ask(`${pre}\n\n${filled}${terms}`, Object.assign({ model: C[block].model, effort: C[block].effort }, opts))
}
// @part id
const idOf = s => s.split(':')[0].trim()
