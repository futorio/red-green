// Shared helpers: text helpers, the preambles every stage prompt starts with, the mailbox and ask(), requirement ids.
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
// Implement commits its work as it stands; a gate it left worse reaches the fix as a gates finding. Fixes keep the bar.
const preWith = bar => `${CORE_PRE}
- ${COMMIT_RULE} Stage explicit paths only — never \`git add -A\` or \`git add .\`. Commit messages describe the change, not the run (no "round", no stage names)${P.commit ? `; ${P.commit}` : ''}. ${bar}
- Gates: ${gateList('; ')}. Each baseline was measured before the run (re-measure, never quote). "Green" means no gate worse than its baseline.
- You do not edit ${TARGET} or the other ticket files.
${BG}
- Over-built output is a finding, not a bonus.${LAST}`
const PRE = preWith('Commit only with the gate at its baseline or better.')
// @part id
const idOf = s => s.split(':')[0].trim()
