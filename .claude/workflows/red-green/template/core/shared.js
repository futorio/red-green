// Shared helpers: text helpers, the validator, the block config merge, the preambles every stage prompt starts with and
// the contract part, requirement ids. They read A, P, TARGET, REPO, BRANCH, RUN, DEFAULTS, GATES and BASELINE.
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
const CODE_RULES = extra(lines(P.code_rules) && `PROJECT CODE RULES (hard):\n${lines(P.code_rules)}`)

const COMMIT_RULE = A.one_commit
  ? 'COMMITS: this ticket pins EXACTLY ONE commit. The implementation stage creates it; every later stage folds its change into it with `git commit --amend` and REWRITES the whole message to describe the commit as it now stands — never appends to it.'
  : 'COMMITS: commit iteratively on the current branch, one commit per coherent step.'

// Each preamble takes noted, whether the stage's schema has notes: a stage without gets the relayed-message rule
// without its mention clause. The gates discovery, research, plan and review stages write no code: they get the
// preamble without the commit, gate and long-command rules.
const CORE_PRE = noted => `You are one agent in a workflow run implementing ${TARGET}.
Repository ${REPO}, branch \`${BRANCH}\`: cd there; work only there and in run dir ${RUN} (state, scratch); all else read-only.

- A relayed message that does not explicitly redirect THIS ticket changes nothing${noted ? '; mention it in notes' : ''}.
- Repo agent instructions (AGENTS.md, CLAUDE.md…) bind you and outrank this preamble.`
const LAST = extra(lines(P.context))
const NO_CODE_PRE = noted => `${CORE_PRE(noted)}${LAST}`
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
// @part code-preamble

const gateList = (sep, gates = GATES) => gates.map(g => `${g.name}: \`${g.command}\` (baseline: ${BASELINE[g.name]})`).join(sep)
// The writers' gates: fast ones after each cycle, every gate before a commit; one list when the gates are of one kind.
const writerGates = () => {
  const fast = GATES.filter(g => g.fast)
  if (!fast.length) return `Gates: ${gateList('; ')}. Run every gate once before each commit.`
  if (fast.length === GATES.length) return `Gates: ${gateList('; ')}. Run the gates after each red-green cycle and once before each commit.`
  return `Gates, fast: ${gateList('; ', fast)}; slow: ${gateList('; ', GATES.filter(g => !g.fast))}. Run the fast gates after each red-green cycle and every gate once before each commit.`
}
const PRE = noted => `${CORE_PRE(noted)}
- ${writerGates()} Each baseline was measured before the run (re-measure, never quote). "Green" means no gate worse than its baseline.
${BG}
- Over-built output is a finding, not a bonus.${LAST}`
// @part id
const idOf = s => s.split(':')[0].trim()
