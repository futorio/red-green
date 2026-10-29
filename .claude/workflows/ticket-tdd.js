export const meta = {
  name: 'ticket-tdd',
  description: 'Implement one ticket: research, TDD with coverage-checked test cases, review/fix loop',
  whenToUse: 'Implement per a ticket or spec path; project specifics come in args.profile. See .claude/workflows/ticket-tdd/README.md',
  phases: [
    { title: 'Research' },
    { title: 'Plan' },
    { title: 'Implement' },
    { title: 'Gates' },
    { title: 'Review' },
    { title: 'Fix' },
  ],
}

const A = args || {}
const REPO = A.repo
const BRANCH = A.branch
const TOOLS = A.tools
const RUN = A.run
const BASE = A.base
const TARGET = A.target
const IMPLEMENT_SKILL = `${TOOLS}/.claude/workflows/ticket-tdd/skills/implement.md`
const MUTATE = `${TOOLS}/.claude/workflows/ticket-tdd/skills/mutate.mjs`
const P = A.profile || {}
// Each block's default instructions, from template/defaults/<block>.md: {<block>: {<part>: text}} (README § Blocks).
const DEFAULTS = {"fix-review":{"fix-review":"STAGE: fix review, HEAD {{HEAD}}. A fix moved HEAD from {{from_head}}; no full review round follows it. Review its diff, `git diff {{from_head}}..HEAD`, and only that: (1) each `fixed` finding is fixed by the diff; each `rejected` one: its `argument` holds against the code; (2) the diff breaks nothing it touches — a sibling caller, another writer of the same state{{duty.test_case_review_fix}}. The gates step checks this HEAD after you.\nGIVEN:\n{{given}}\n\nRESEARCH:\n{{research}}\n\nStart from the change-site facts above: read only the lines the change touches or you verify, and search only for what they do not cover.","duty.test_case_review_fix":"; (3) no test was weakened, deleted or left asserting nothing it promises"},"fix":{"fix":"STAGE: fix, round {{round}}. Read {{IMPLEMENT_SKILL}} and follow it, code rules included.{{code_rules}}\nVerify each finding first. A fix that does not fit the implementation is NOT applied: reject it with an argument that cites code, the ticket or the spec — it goes back to the reviewers. Never delete the thing a finding is about to silence it. Group the findings by root cause first and fix each cause once, not one finding at a time; for each cause, check whether the same failure can arrive by another path — a sibling caller, another writer of the same state — and close that path too. Re-run the gates.\n\nFINDINGS:\n{{findings}}\n{{earlier_fixes}}\nRESEARCH:\n{{research}}\n\nStart from the change-site facts above: read only the lines the change touches or you verify, and search only for what they do not cover.","silence":"delete the thing a finding is about to silence it","earlier_fixes":"\nEARLIER FIXES:\n{{fixed}}\n"},"gates":{"discover":"STAGE: gates discovery.\nWhere: the repo's agent instructions, then CI config, then the task runner; the first source that names gates wins. A gate: a command CI or those instructions require before a commit; runs with no human, network or secrets; pass/fail by exit code; writes nothing to the tree.\nRun each gate exactly as its `command` reads, once, to completion; one that cannot run that way here is a question, not a gate.\n- Commands over ~2 min: `run_in_background`, wait for its completion notice; no sleep/poll, no second start.","run":"STAGE: gates, HEAD {{HEAD}}.\nRun each gate below from {{REPO}} to completion and compare it with its baseline.\nGATES:\n{{gate_list}}\n- Commands over ~2 min: `run_in_background`, wait for its completion notice; no sleep/poll, no second start."},"implement":{"implement":"STAGE: implementation.{{retry_note}} Read {{IMPLEMENT_SKILL}} and follow it, with the tdd/ directory beside it.{{code_rules}}\nBuild on the research facts and plan: what they settle is settled, unless it contradicts the ticket: then follow the ticket and file a `plan` question.\n\nBefore reporting, go through the ticket's sentences for each boundary it states — a limit, an empty input, a missing key, an error path, an exit code — and give each a phrase row with a test at the seam its requirement's test_harness names; a phrase row is unverified only when this environment cannot run its test (no tool, no data, no binary). Then call what you built the way its consumer will — its real entry point, not the steps that built it — and feed it every input, mode and data file the ticket names. Anything you did not run that way, and every claim you did not test, goes in `unverified`, one line each with its cause (no tool, no data, no time, out of scope); an empty list claims you ran all of it.\n\nRun the gates once, at the end, before you commit; say in notes which gate is worse than its baseline.\n\nCASES:\n{{cases}}\n\nRESEARCH:\n{{research}}\n\nStart from the change-site facts above: read only the lines the change touches or you verify, and search only for what they do not cover.","retry_note":" A previous attempt at this stage made NO commit (HEAD still {{BASE}}); its notes: {{previous_notes}}. Implement the ticket now."},"minor-fix":{"minor-fix":"STAGE: minor fixes. Read {{IMPLEMENT_SKILL}} and follow it, code rules included.{{code_rules}}\nApply each finding below whose fix is cheap: a few lines in files this run already changed, no new test file, no change of design. Reject every other one with a one-line reason; it stays advisory. Verify before you agree; never delete the thing a finding is about to silence it. Re-run the gates; if any gate is worse than before your edit, revert your edits and reject them all.\n\nFINDINGS:\n{{findings}}"},"mutation":{"generated":"STAGE: mutation, HEAD {{HEAD}}. Read `git diff {{BASE}}..HEAD` and {{TARGET}}. For each check below write one mutant that breaks the behaviour its test claims to pin (`target` its ref), then at most {{config.edges}} on edges the ticket does not state (`target` `edge: <short phrase>`). Each `patch` is a unified diff against HEAD that changes production source only, in one place, never a test. Write them as a JSON list of {target, patch} to {{RUN}}/mutants.json, then run once `{{mutate_command}}` and report its output list as `mutants`; exit 2 means it did not run: ran false, not_run its stderr.\n- Commands over ~2 min: `run_in_background`, wait for its completion notice; no sleep/poll, no second start.\nCHECKS:\n{{tested_checks}}","tool":"STAGE: mutation, HEAD {{HEAD}}. The project's mutation tool: {{config.tool}} Run it once on this HEAD and report every mutant it ran: `target` `operator`, or a check ref only when the tool names one; `patch` a unified diff against HEAD; `status`."},"plan":{"plan":"STAGE: test-case planning.\n\ncases: one case for each behaviour that {{test_ids}} name, their boundaries and rejections included. Each case goes through the seam its requirement's test_harness `how` names; every case is one test, and `requirement` is the id of the one requirement it checks. Each check lives in one case: a behaviour two requirements share is checked once, under the requirement that names it most directly. A case tests behaviour, not implementation: what a caller of the seam sees (inputs, outputs, effects, errors) and the stubs Arrange allows. How the test is written and run, and the code's inner structure (helpers, private names, call order), are the implementer's.\nAAA — Arrange: every input and object the case uses, written out in this case; the case runs the real code, and a stub stands in only for what a test cannot run (another program, the network, hardware, the clock), each stub with what it is given and what it returns or writes; Act: ONE call through the seam; asserts: atomic, one expected value or one property each, on what the Act leaves visible to a caller.\nThe ticket and the spec are the oracle: each expected value is a single literal taken from them, never recomputed the way the code would, and a default or precedence they leave open takes the reading their words support, stated in the case.\n\nRESEARCH:\n{{research}}\n\nStart from the change-site facts above: read only the lines the change touches or you verify, and search only for what they do not cover.","replan":"STAGE: test-case planning, the one replan.{{uncovered_note}}{{duplicates_note}} Keep every other case as it is, same id.\n\ncases: one case for each behaviour that {{test_ids}} name, their boundaries and rejections included. Each case goes through the seam its requirement's test_harness `how` names; every case is one test, and `requirement` is the id of the one requirement it checks. Each check lives in one case: a behaviour two requirements share is checked once, under the requirement that names it most directly. A case tests behaviour, not implementation: what a caller of the seam sees (inputs, outputs, effects, errors) and the stubs Arrange allows. How the test is written and run, and the code's inner structure (helpers, private names, call order), are the implementer's.\nAAA — Arrange: every input and object the case uses, written out in this case; the case runs the real code, and a stub stands in only for what a test cannot run (another program, the network, hardware, the clock), each stub with what it is given and what it returns or writes; Act: ONE call through the seam; asserts: atomic, one expected value or one property each, on what the Act leaves visible to a caller.\nThe ticket and the spec are the oracle: each expected value is a single literal taken from them, never recomputed the way the code would, and a default or precedence they leave open takes the reading their words support, stated in the case.\n\nYOUR PREVIOUS CASES:\n{{plan.cases}}\n\nRESEARCH:\n{{research}}\n\nStart from the change-site facts above: read only the lines the change touches or you verify, and search only for what they do not cover.","uncovered_note":" Your cases below leave {{uncovered}} uncovered: add cases for each.","duplicates_note":" These checks (check = arrange | act | assert) sit in several cases after the same Arrange and Act; keep each in one case: {{duplicates}}.","rules":"cases: one case for each behaviour that {{test_ids}} name, their boundaries and rejections included. Each case goes through the seam its requirement's test_harness `how` names; every case is one test, and `requirement` is the id of the one requirement it checks. Each check lives in one case: a behaviour two requirements share is checked once, under the requirement that names it most directly. A case tests behaviour, not implementation: what a caller of the seam sees (inputs, outputs, effects, errors) and the stubs Arrange allows. How the test is written and run, and the code's inner structure (helpers, private names, call order), are the implementer's.\nAAA — Arrange: every input and object the case uses, written out in this case; the case runs the real code, and a stub stands in only for what a test cannot run (another program, the network, hardware, the clock), each stub with what it is given and what it returns or writes; Act: ONE call through the seam; asserts: atomic, one expected value or one property each, on what the Act leaves visible to a caller.\nThe ticket and the spec are the oracle: each expected value is a single literal taken from them, never recomputed the way the code would, and a default or precedence they leave open takes the reading their words support, stated in the case."},"research":{"research":"STAGE: research.{{retry_note}} Read {{TARGET}}, its parent spec and the sections it names, sibling tickets, the documents they cite, and the code and tests the ticket touches. Collect the knowledge of the code that must be known BEFORE writing it: helpers and seams to reuse, every call site and reader affected, and the traps that apply. Every fact is shown by lines of code, a repository document or a read-only search of the repository. The baseline and the gates step own the environment and the checks' results: report neither in facts nor in plan.","retry_note":" A previous answer at this stage failed the core's checks: {{previous_notes}}. Answer again in full with each of them fixed; a plan step over its limit keeps its action and moves the details to the facts.","section":"RESEARCH:\n{{research}}\n\nStart from the change-site facts above: read only the lines the change touches or you verify, and search only for what they do not cover."},"review":{"checklist":"STAGE: review, round {{round}} of at most {{rounds}}. Lens: checklist. Review the change against its statement. For each requirement id — {{check_ids}} — the promise is the sentence of the statement it rests on, whatever the code, its docs or its tests say. Then find a counterexample: the input or path most likely to make the promise false on the diff `git diff {{BASE}}..HEAD` — a boundary, an empty or malformed input, an error path, an exit code, a second caller.{{verify_review_note}} Scope: a change the statement does not call for is a finding.{{unverified_note}}\nThe gates step already ran every gate and long check at this HEAD; review the diff and its rows below.\nGATES:\n{{gate_rows}}\nCompare against the statement ({{TARGET}} and every document it points to, as written before the code) and the research plan below.\n{{earlier_findings}}\nRESEARCH:\n{{research}}\n\nStart from the change-site facts above: read only the lines the change touches or you verify, and search only for what they do not cover.","code":"STAGE: review, round {{round}} of at most {{rounds}}. Lens: code. Read the code as code: would every new branch execute as intended{{runtime_note}}, is every new assertion falsifiable. For each check, guard, clamp or documented promise the diff adds, name one input on which it passes while the property it promises is false. Also the rules of {{IMPLEMENT_SKILL}} § Code rules. Over-built code is a finding.{{duty.order}}{{code_rules}}\n{{duty.test_case_review}}If the diff holds no production source (only tests, docs, data or config), check one row saying so, review only the tests, and stop.\nThe gates step already ran every gate and long check at this HEAD; review the diff and its rows below.\nGATES:\n{{gate_rows}}\nCompare against the statement ({{TARGET}} and every document it points to, as written before the code) and the research plan below.\n{{earlier_findings}}\nRESEARCH:\n{{research}}\n\nStart from the change-site facts above: read only the lines the change touches or you verify, and search only for what they do not cover.","head":"STAGE: review, round {{round}} of at most {{rounds}}. Lens:","frame":"The gates step already ran every gate and long check at this HEAD; review the diff and its rows below.\nGATES:\n{{gate_rows}}\nCompare against the statement ({{TARGET}} and every document it points to, as written before the code) and the research plan below.\n{{earlier_findings}}\nRESEARCH:\n{{research}}\n\nStart from the change-site facts above: read only the lines the change touches or you verify, and search only for what they do not cover.","verify_review_note":" These have no test and are checked only by you: {{verify_review}}.","unverified_note":" Implementation said it did not test: {{unverified}}; weigh each against the requirement it touches.","earlier_findings":"\nEARLIER FINDINGS (a fixed one stays closed, also as a broader future risk; re-raise a rejected one only as a finding whose `problem` answers its `argument`):\n{{history}}\n","duty.order":" ORDER RULE (experiment draft): for each piece of state the diff adds or writes, list every path that changes it (handlers, callbacks, requests, retries, timers). For any two that can land in one unit of processing (tick, frame, event-loop turn, request, transaction, the span between two awaits), check the result in both orders and with one of them repeated; a result that depends on order or repetition is a finding whose trigger names both events.","runtime_note":" in {{config.runtime}}","duty.test_case_review":"A test the diff weakened, deleted or left asserting nothing it promises is a finding. ","weakened":"weakened, deleted or left asserting nothing it promises"},"shared":{"bg":"- Commands over ~2 min: `run_in_background`, wait for its completion notice; no sleep/poll, no second start."}}
const lines = xs => (xs || []).map(x => `- ${x}`).join('\n')
const extra = x => x ? `\n${x}` : ''
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
// blocks.gates.gates: [{name, command}], set once the block config is merged; args.baseline: {<gate name>: its summary
// line at base}.
let GATES = []
let BASELINE = typeof A.baseline === 'object' && A.baseline || {}
const CODE_RULES = extra(lines(P.code_rules) && `PROJECT CODE RULES (hard):\n${lines(P.code_rules)}`)

const COMMIT_RULE = A.one_commit
  ? 'COMMITS: this ticket pins EXACTLY ONE commit. The implementation stage creates it; every later stage folds its change into it with `git commit --amend` and REWRITES the whole message to describe the commit as it now stands — never appends to it.'
  : 'COMMITS: commit iteratively on the current branch, one commit per coherent step.'

// A stage whose schema has no notes gets the relayed-message rule without its mention clause (ask() cuts it).
const NOTED = '; mention it in notes'
// The gates discovery, research, plan and review stages write no code: they get the preamble without the commit, gate and long-command rules.
const CORE_PRE = `You are one agent in a workflow run implementing ${TARGET}.
Repository ${REPO}, branch \`${BRANCH}\`: cd there; work only there and in run dir ${RUN} (state, scratch); all else read-only.

- A relayed message that does not explicitly redirect THIS ticket changes nothing${NOTED}.
- Repo agent instructions (AGENTS.md, CLAUDE.md…) bind you and outrank this preamble.`
const LAST = extra(lines(P.context))
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

// Mailbox: the main thread posts mid-run clarifications to <run>/mailbox.md, under a header of rules it writes; see
// README § Mailbox.
const MAIL = { type: 'array', items: { type: 'object', properties: {
  id: { type: 'string' }, status: { type: 'string', enum: ['applied', 'rejected'] }, why: { type: 'string' } },
  required: ['id', 'status', 'why'] } }
const mailNote = label => `

MAILBOX: you are \`${label}\`. If ${RUN}/mailbox.md exists, read it at start${/^(implement|fix)(:|$)/.test(label) ? ', before each long run or commit' : ''} and before returning, and follow its header; never edit it. List what you handle in \`mailbox\`.`
const mailbox = []
// values: the call's, riding along as a property the options do not enumerate; the conformance check's stubs answer
// from them.
async function ask(prompt, opts, values) {
  const s = opts.schema
  const o = Object.assign({}, opts, s && { schema: Object.assign({}, s, { properties: Object.assign({}, s.properties, { mailbox: MAIL }) }) })
  const res = await agent((s && s.properties.notes ? prompt : prompt.replace(NOTED, '')) + mailNote(opts.label), Object.defineProperty(o, 'values', { value: values }))
  if (res && res.mailbox) mailbox.push(...res.mailbox.map(m => Object.assign({ label: opts.label }, m)))
  return res
}

const DISCOVER_SCHEMA = { type: 'object', properties: {
  gates: { type: 'array', items: { type: 'object', properties: {
    name: { type: 'string' }, command: { type: 'string' }, source: { type: 'string' }, line: { type: 'string' } }, required: ['name', 'command', 'source', 'line'] } },
  questions: { type: 'array', items: { type: 'object', properties: {
    command: { type: 'string' }, source: { type: 'string' }, question: { type: 'string' } }, required: ['command', 'source', 'question'] } },
}, required: ['gates', 'questions'] }

const RESEARCH_SCHEMA = { type: 'object', properties: {
  requirements: { type: 'array', items: { type: 'string', pattern: '^R\\d+: ' } },
  facts: { type: 'array', items: { type: 'object', properties: {
    kind: { type: 'string', enum: ['code', 'change-site', 'note'] }, fact: { type: 'string' },
    where: { anyOf: [{ type: 'array', items: { type: 'string' }, minItems: 1 }, { type: 'string' }] },
    requirements: { type: 'array', items: { type: 'string' }, minItems: 1 },
  }, required: ['kind', 'fact', 'where', 'requirements'] } },
  plan: { type: 'array', items: { type: 'string', maxLength: 600 } },
  test_harness: { type: 'array', items: { type: 'object', properties: {
    requirement: { type: 'string' }, by: { type: 'string', enum: ['test', 'review', 'launch', 'none'] }, how: { type: 'string' },
  }, required: ['requirement', 'by', 'how'] } },
  questions: { type: 'array', items: { type: 'object', properties: {
    requirement: { type: 'string' }, question: { type: 'string' }, settles: { type: 'string', enum: ['owner', 'outside'] },
  }, required: ['requirement', 'question', 'settles'] } },
}, required: ['requirements', 'facts', 'plan', 'test_harness', 'questions'] }

const CASE = { type: 'object', properties: {
  id: { type: 'string' }, requirement: { type: 'string' }, title: { type: 'string' },
  arrange: { type: 'string' }, act: { type: 'string' }, asserts: { type: 'array', items: { type: 'string' } },
}, required: ['id', 'requirement', 'title', 'arrange', 'act', 'asserts'] }
// A case names its requirement by id, one of the ids the planner is given.
const casesSchema = ids => ({ type: 'object', properties: {
  cases: { type: 'array', items: Object.assign({}, CASE, { properties: Object.assign({}, CASE.properties, { requirement: { type: 'string', enum: ids } }) }) },
  questions: { type: 'array', items: { type: 'object', properties: {
    requirement: { type: 'string' }, question: { type: 'string' }, reading: { type: 'string' },
    cases: { type: 'array', items: { type: 'string' } }, settles: { type: 'string', enum: ['research', 'owner'] },
  }, required: ['requirement', 'question', 'reading', 'cases', 'settles'] } } }, required: ['cases', 'questions'] })

// A check row proves a case (ref: its id) or a boundary phrase of the ticket (ref: its words, quoted) by a test, or says why not.
const IMPL_SCHEMA = { type: 'object', properties: {
  head: { type: 'string' },
  checks: { type: 'array', items: { type: 'object', properties: {
    kind: { type: 'string', enum: ['case', 'phrase'] }, ref: { type: 'string' }, requirement: { type: 'string' },
    test: { type: 'object', properties: { file: { type: 'string' }, name: { type: 'string' } }, required: ['file', 'name'] },
    unverified: { type: 'string' },
  }, required: ['kind', 'ref', 'requirement'], anyOf: [{ required: ['test'] }, { required: ['unverified'] }] } },
  unverified: { type: 'array', items: { type: 'string' } },
  questions: { type: 'array', items: { type: 'object', properties: {
    requirement: { type: 'string' }, question: { type: 'string' }, reading: { type: 'string' }, settles: { type: 'string', enum: ['owner', 'plan'] },
  }, required: ['requirement', 'question', 'reading', 'settles'] } },
  notes: { type: 'string' },
}, required: ['head', 'checks', 'unverified', 'questions'] }

const FINDING = { type: 'object', properties: {
  severity: { type: 'string', enum: ['major', 'minor'] },
  where: { type: 'string' }, problem: { type: 'string' },
  trigger: { type: 'string' }, consequence: { type: 'string' }, fix: { type: 'string' },
  proof: { type: 'object', properties: { path: { type: 'string' }, command: { type: 'string' }, red: { type: 'string' } }, required: ['path', 'command', 'red'] },
}, required: ['severity', 'where', 'problem', 'trigger', 'consequence', 'fix'] }
const reviewSchema = row => ({ type: 'object', properties: {
  verdict: { type: 'string', enum: ['clean', 'findings'] },
  findings: { type: 'array', items: FINDING },
  checked: { type: 'array', items: { type: 'object', properties: Object.assign({ item: { type: 'string' }, evidence: { type: 'string' } }, row), required: ['item', 'evidence'].concat(Object.keys(row)) } },
  notes: { type: 'string' },
}, required: ['verdict', 'findings', 'checked'] })
const STATUS = { status: { type: 'string', enum: ['met', 'unmet', 'unverified'] } }
const REVIEW_SCHEMA = reviewSchema({})

// Each lens: the rules its contract part adds and the subject of its checked rows. Its key is the name
// blocks.review.lenses takes (the registry's config.lenses) and the part of defaults/review.md that holds its job.
const LENSES = [
  { key: 'checklist', schema: reviewSchema(Object.assign({ promise: { type: 'string' }, counterexample: { type: 'string' } }, STATUS)), checked: null,
    rules: () => [READ_ONLY, TARGETED, 'One `checked` row per id: item = the id, promise = the quoted sentence with its file and section, counterexample = the input you tried, status `met` (the counterexample was tried and the promise held), `unmet` (it breaks the promise: name it) or `unverified` (you could not try it). An id without a row counts as unverified. An `unmet` row becomes a finding by itself; `findings` are for defects outside the requirements.'] },
  { key: 'code', schema: REVIEW_SCHEMA, checked: 'new or changed function or branch (item = where it is), then one per other thing you verified',
    rules: () => [`${READ_ONLY} The one exception is a proof: you may prove a major about behaviour with a test, written as a new, uncommitted file in the repository's test directory; \`proof\` is its path, the exact command and the output line that showed it red on HEAD.`, TARGETED] },
]
// One record per mutant, from the runner or a project's own tool; the script derives ids, places and counts.
const MUTANT_STATUS = ['killed', 'survived', 'invalid', 'not_run']
const MUTATION_SCHEMA = { type: 'object', properties: {
  applies: { type: 'boolean' }, ran: { type: 'boolean' }, not_run: { type: 'string' },
  mutants: { type: 'array', items: { type: 'object', properties: {
    target: { type: 'string' }, patch: { type: 'string' }, status: { type: 'string', enum: MUTANT_STATUS } }, required: ['target', 'patch', 'status'] } },
}, required: ['applies', 'ran', 'mutants'] }

const FIX_SCHEMA = { type: 'object', properties: {
  applied: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, what: { type: 'string' } }, required: ['id', 'what'] } },
  rejected: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, argument: { type: 'string' } }, required: ['id', 'argument'] } },
  proofs: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, path: { type: 'string' }, outcome: { type: 'string', enum: ['rewritten', 'deleted'] } }, required: ['id', 'path', 'outcome'] } },
  head: { type: 'string' },
}, required: ['applied', 'rejected', 'proofs', 'head'] }

// The registry: every variable a block's instructions may name as {{path}}, with its JSON Schema. Each block's inputs,
// the paths its instructions may use, are a subset of it. README § Blocks.
const STRING = { type: 'string' }
const INTEGER = { type: 'integer' }
const OPTIONAL = { anyOf: [STRING, { type: 'null' }] }
const LIST = { type: 'array', items: STRING }
// The research input requires nothing extra: the limits research's own checks hold (the `R<n>: ` prefix, a plan step's
// 600 characters) are left out, so a result recorded before a limit still fills a later block.
const researchKept = Object.assign(Object.fromEntries(Object.entries(RESEARCH_SCHEMA.properties).filter(([k]) => k !== 'questions')), { requirements: LIST, plan: LIST })
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
  given: { type: 'array', items: { type: 'object', properties: { id: STRING, where: STRING, problem: STRING,
    outcome: { type: 'string', enum: ['fixed', 'rejected'] }, argument: STRING }, required: ['id', 'problem', 'outcome'] } },
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
  research: ['TARGET', 'previous_notes', 'retry_note'],
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
// Each block's config: the render config's defaults, profile.blocks.<name> over them (README § Blocks).
const { merged: CONFIG, errors: configErrors } = mergeBlocks({"research":{"model":"opus","effort":"high","prompt":null,"skill":null},"plan":{"model":null,"effort":"high","prompt":null,"skill":null},"implement":{"model":"sonnet","effort":"high","prompt":null,"skill":null},"gates":{"model":"sonnet","effort":"medium","gates":null,"prompt":null,"skill":null},"review":{"model":"opus","effort":"high","rounds":2,"extra":0,"min":2,"lenses":["checklist","code"],"duties":{"test_case_review":true,"order":false},"minors":2,"runtime":null,"prompt":null,"skill":null},"fix-review":{"model":null,"effort":"high","prompt":null,"skill":null},"mutation":{"model":"haiku","effort":"medium","edges":5,"timeout":300,"build":null,"test":null,"tool":null,"prompt":null,"skill":null},"fix":{"model":null,"effort":"high","prompt":null,"skill":null},"minor-fix":{"model":null,"effort":"medium","prompt":null,"skill":null}}, P.blocks, REGISTRY)
// A block with no model runs on the model of the block it follows.
const FOLLOWS = { plan: 'research', fix: 'implement', 'fix-review': 'review', 'minor-fix': 'fix' }
Object.entries(FOLLOWS).forEach(([b, leader]) => { CONFIG[b].model = CONFIG[b].model || CONFIG[leader].model })
// These args and profile fields moved into the block config; one still given fails the run instead of being ignored.
const MOVED = [[A, 'args', { models: 'profile.blocks.<name>.model', rounds: 'profile.blocks.review.rounds', extra_rounds: 'profile.blocks.review.extra', min_rounds: 'profile.blocks.review.min' }],
  [P, 'profile', { research: 'profile.blocks.research.prompt as "{{default}}\\n<text>"', runtime: 'profile.blocks.review.runtime', gates: 'profile.blocks.gates.gates', mutation: 'profile.blocks.mutation' }]]
MOVED.forEach(([from, name, to]) => Object.keys(to).filter(k => k in from).forEach(k => configErrors.push(`${name}.${k} moved to ${to[k]}`)))
Object.entries(CONFIG).filter(([, c]) => c.prompt && c.skill).forEach(([b]) => configErrors.push(`blocks.${b}: prompt or skill, not both`))
// Mutation runs on a test or a tool; with no blocks.mutation given the step is skipped.
if ((P.blocks || {}).mutation && !CONFIG.mutation.tool && !CONFIG.mutation.test) configErrors.push('blocks.mutation: neither test nor tool')
if (CONFIG.mutation.build && !CONFIG.mutation.test) configErrors.push('blocks.mutation: build without test')
if (CONFIG.mutation.tool && (CONFIG.mutation.test || CONFIG.mutation.build)) configErrors.push('blocks.mutation: tool, or build and test, not both')
if (configErrors.length) return { status: 'failed', stage: 'config', note: configErrors.join('; '), failures: [] }
GATES = CONFIG.gates.gates || []
// Full rounds added when the last planned round has majors to fix; by default the fix-diff review sees the fix instead.
let EXTRA = CONFIG.review.extra
const failures = []
// Declared gates need a baseline each; with none declared, the discovery step finds them and measures the baseline.
// Its questions go to the result alone.
let gatesQuestions = []
if (CONFIG.gates.gates) {
  const unmeasured = GATES.filter(g => !Object.hasOwn(BASELINE, g.name)).map(g => g.name)
  if (unmeasured.length) return { status: 'failed', stage: 'gates', note: `args.baseline has no entry for: ${unmeasured.join(', ')}`, failures }
} else {
  phase('Gates')
  const found = await call('gates', NO_CODE_PRE, 'discover', {}, contract(READ_ONLY, 'gates: name, command (the exact command line), source (the file that names it), line (its summary line verbatim, with the cause of any failure). questions: each command you are unsure of (is it a gate), with `source` the source of the gate it bears on; it stays out of gates. A repository with no gate: gates [] and a question saying where you looked.',
    died('Answer')), { schema: DISCOVER_SCHEMA, phase: 'Gates', label: 'gates:discover' })
  if (!found || !found.gates.length) return { status: 'failed', stage: 'gates:discover', note: found ? 'no gate found' : 'the discovery step died', gates_questions: found ? found.questions : [], failures }
  GATES = found.gates
  BASELINE = Object.fromEntries(GATES.map(g => [g.name, g.line]))
  gatesQuestions = found.questions.filter(q => GATES.some(g => g.source === q.source) || log(`gates question from unknown source ${q.source}: dropped`))
}

const gateList = sep => GATES.map(g => `${g.name}: \`${g.command}\` (baseline: ${BASELINE[g.name]})`).join(sep)
const PRE = `${CORE_PRE}
- Gates: ${gateList('; ')}. Each baseline was measured before the run (re-measure, never quote). "Green" means no gate worse than its baseline.
${BG}
- Over-built output is a finding, not a bonus.${LAST}`

const GATES_SCHEMA = { type: 'object', properties: {
  head: { type: 'string' },
  gates: { type: 'array', items: { type: 'object', properties: {
    name: { type: 'string', enum: GATES.map(g => g.name) }, status: { type: 'string', enum: ['green', 'red', 'not_run'] }, line: { type: 'string' },
  }, required: ['name', 'status', 'line'] } },
  notes: { type: 'string' },
}, required: ['head', 'gates'] }

// The output rules every review stage gets in its contract part; the minors cap is the review block's config.
const SEVERITY = `SEVERITY. major: a concrete defect in this diff, with a \`trigger\` (a reachable input or path that shows it) and a \`consequence\` (what breaks). A passing test or a ruling in the research does not cancel a trigger you can name. minor: everything else — wording, style, a future risk, "one more test would be nice"; report at most ${CONFIG.review.minors} minors, one sentence each. A missing test is major only when you name the behaviour this diff adds, why the existing tests miss it, and the input that shows it. One root cause is one finding. After your first finding, make one more pass on a different concern before you stop.`
// what: the rows' subject; none when the job already says what a row is. Its last sentence is what counts as died.
const CHECKED = what => `In \`checked\`, ${what ? `one row per ${what}; ` : ''}\`evidence\` is one sentence naming the file, test or command output that settled it. ${died('Return at least one checked row and verdict `clean` exactly when findings is empty and no row is `unmet`')}`
const idOf = s => s.split(':')[0].trim()
function silence(res, ids) {
  if (!res.checked.length) return 'no checked rows'
  // An unmet checklist row is a finding by itself.
  const unmet = res.checked.some(c => c.status === 'unmet')
  if ((res.verdict === 'clean') !== !(res.findings.length || unmet)) return `verdict ${res.verdict} with ${res.findings.length} findings${unmet ? ' and an unmet row' : ''}`
  const seen = new Set(res.checked.map(c => idOf(c.item)))
  const missing = (ids || []).filter(i => !seen.has(i))
  return missing.length ? `not checked: ${missing.join(', ')}` : null
}
// A major with no trigger is a minor; a lens keeps at most review.minors minors.
function tidy(findings) {
  let minors = 0
  const out = findings.map(f => f.severity !== 'minor' && !(f.trigger || '').trim() ? Object.assign({}, f, { severity: 'minor', downgraded: true }) : f)
  const kept = out.filter(f => f.severity !== 'minor' || ++minors <= CONFIG.review.minors)
  const down = out.filter(f => f.downgraded).length
  if (down || kept.length < out.length) log(`findings tidied: ${down} downgraded for no trigger, ${out.length - kept.length} minors dropped`)
  return kept
}
// Only the code lens proves a finding. Each proof is a fix's to rewrite or delete; one no fix accounts for is a stray.
const proofs = []
const settled = new Set()
const strayProofs = []
const stray = f => { settled.add(f.id); strayProofs.push({ id: f.id, path: f.proof.path }) }
// A proof from another source is not sent to a fix, but its file may exist: it is a stray, never dropped silently.
function proven(f) {
  if (f.proof && f.source !== 'code') { stray(f); delete f.proof }
  if (f.proof) proofs.push(f)
  return f
}
// A finding a fix was sent, with what the fix did to it: fixed, or rejected with its argument (none given: rejected).
const outcomeOf = (f, res) => {
  const r = res.rejected.find(x => x.id === f.id)
  return Object.assign({ id: f.id, where: f.where, problem: f.problem, outcome: res.applied.some(a => a.id === f.id) ? 'fixed' : 'rejected' }, r && { argument: r.argument })
}
const reconcile = (sent, res) => sent.filter(f => f.proof && !settled.has(f.id))
  .forEach(f => res.proofs.some(p => p.id === f.id || p.path === f.proof.path) ? settled.add(f.id) : stray(f))


phase('Research')
// The core checks what the agent's schema does not force (a plan step's 600 characters); an answer that fails gets one
// retry with the errors, and a retry that fails too is a dead research. A replay (args.replay, set by render.mjs alone)
// takes a recorded research as given, so results recorded before the limit still reach later stages.
const researchCall = (errors, label) => call('research', NO_CODE_PRE, 'research', { TARGET, retry_note: !!errors, previous_notes: errors || undefined }, contract(READ_ONLY, `- requirements: every checkable requirement, one line each, prefixed with its id R1, R2, … in order and naming the checklist box or phrase it comes from, e.g. "R7: grammar/effects.json holds 8 entries (Checklist › Whitelist)". Cover every checklist box.
- facts: one list, complete: every place the diff will touch, and every caller or reader of a symbol it changes. Each fact is one sentence with a kind, where, and requirements: the ids (e.g. "R7") it serves, at least one; a fact that serves the whole ticket and no requirement in particular (a shared convention, helper or harness) takes "general" instead. The kind follows one rule: lines of code show the fact → change-site when the change touches those lines, code otherwise; no lines of code show it → note.
  - code and change-site: where = a list of locations, each \`file\` or \`file:a-b\` (repository-relative, one range per entry; a fact spanning several files or ranges lists each one). A change-site fact says what is there now; a new file is named in the fact and located by an existing place it relates to.
  - note: where = one string, \`path § section\` (a repository document; the ticket's own spec only for a decision the requirement lines do not carry) or \`$ command\` (a read-only rg, grep, git, find or ls of the repository). A tool's behaviour is shown from the tree (its source, config or lock file).
- plan: the fewest actions that meet the requirements, built from the facts, in dependency order: reuse what the facts name before adding anything new, and add nothing the requirements do not ask for. Every step changes code, config or docs; running checks, committing and recording results belong to the implementer and the gates. Each step is two or three sentences: a part of the code (a module, config, script, doc set) and what is done to it, naming every tool, symbol and file it acts on; line ranges, flags, commands and lists stay in the facts.
- test_harness: exactly one entry per requirement: requirement (its id), by, how (test: the seam and where its tests live; review or launch: what is checked; none: why). The run commands stay in the gates.
- questions: every point a requirement depends on that the repository does not settle, one entry each: requirement (its id), question, settles (owner: the ticket and the spec leave it to their author; outside: the answer lies outside the repository, in running the program, outside documentation or data). An empty list says nothing was left open.`, died('Answer')),
  { schema: RESEARCH_SCHEMA, phase: 'Research', label })
const researchErrors = r => r ? validate({ type: 'object', properties: { plan: RESEARCH_SCHEMA.properties.plan } }, r).join('; ') : ''
let research = await researchCall(null, 'research')
if (!A.replay && researchErrors(research)) {
  log(`research failed its checks; retrying once: ${researchErrors(research)}`)
  research = await researchCall(researchErrors(research), 'research:retry')
  if (researchErrors(research)) { failures.push(`research:retry output: ${researchErrors(research)}`); research = null }
}
if (!research) return { status: 'failed', stage: 'research', failures }
// The research checks: ids renumbered R1..Rn when one is missing or repeated, facts that serve no listed id dropped,
// one test_harness entry per requirement, files derived from the located facts. What they repair or cannot repair is
// reported in research_issues, not failures: the run goes on as before.
const researchIssues = []
if (research.requirements.some((r, i, all) => !/^R\d+:/.test(r) || all.findIndex(x => idOf(x) === idOf(r)) !== i)) {
  research.requirements = research.requirements.map((r, i) => `R${i + 1}: ${r.replace(/^R\d+:\s*/, '')}`)
  researchIssues.push('a requirement id was missing or repeated: renumbered R1..Rn')
}
const reqIds = research.requirements.map(idOf)
const serves = f => f.requirements.some(i => idOf(i) === 'general' || reqIds.includes(idOf(i)))
const droppedFacts = research.facts.filter(f => !serves(f))
research.facts = research.facts.filter(serves)
const cited = new Set(research.facts.flatMap(f => f.requirements.map(idOf)))
const unresearched = research.requirements.filter(r => !cited.has(idOf(r)))
research.test_harness.filter(h => !reqIds.includes(idOf(h.requirement))).forEach(h => researchIssues.push(`test_harness entry for unknown requirement ${h.requirement}: dropped`))
reqIds.forEach(id => {
  const n = research.test_harness.filter(h => idOf(h.requirement) === id).length
  if (n !== 1) researchIssues.push(n ? `${n} test_harness entries for ${id}: kept the first` : `no test_harness entry for ${id}`)
})
research.test_harness = reqIds.map(id => research.test_harness.find(h => idOf(h.requirement) === id)).filter(Boolean)
// Research questions go to the result alone: what research could not settle is not passed on as knowledge.
const researchQuestions = (research.questions || []).filter(q => reqIds.includes(idOf(q.requirement)) || !researchIssues.push(`question for unknown requirement ${q.requirement}: dropped`))
delete research.questions
research.files = [...new Set(research.facts.filter(f => f.kind !== 'note').flatMap(f => [].concat(f.where).map(w => w.split(':')[0].trim())))]
let N = CONFIG.review.rounds
// A run reviews review.min rounds in full even when the first is clean: round 2 catches majors round 1 missed.
const MIN_ROUNDS = Math.min(N, CONFIG.review.min)
const LENS_KEYS = CONFIG.review.lenses
log(`research: ${research.requirements.length} requirements, ${droppedFacts.length} facts dropped, ${unresearched.length} unresearched -> ${N} review rounds, lenses ${LENS_KEYS.join(' + ')}`)

phase('Plan')
// Research's test_harness routes each requirement: test gets cases; review, none and no entry go to the checklist lens
// alone; launch leaves the run, listed in the result with research's how.
const harnessOf = id => research.test_harness.find(h => idOf(h.requirement) === id) || { by: 'review' }
const lineOf = id => research.requirements.find(r => idOf(r) === id)
const testIds = reqIds.filter(id => harnessOf(id).by === 'test')
const checkIds = reqIds.filter(id => harnessOf(id).by !== 'launch')
const PLAN_CONTRACT = contract(READ_ONLY, 'questions: every point the ticket and the research leave open that a case still depends on, one entry each; reading: the one the cases take; settles: research (the repository holds the answer and the research does not give it) or owner (the ticket and the spec leave it to their author). An empty list says nothing was left open.', died('Answer'))

// With no test requirement there is nothing to plan: no planner call, no cases.
let plan = !testIds.length ? { cases: [] } : await call('plan', NO_CODE_PRE, 'plan', { test_ids: testIds.join(', '), research }, PLAN_CONTRACT,
  { schema: casesSchema(testIds), phase: 'Plan', label: 'plan' })
if (!plan) return { status: 'failed', stage: 'plan', failures }

// Coverage: every test requirement is cited by at least one case.
const coverage = p => testIds.filter(id => !p.cases.some(c => idOf(c.requirement) === id))
// Duplicates: the same check after the same Arrange and Act in two cases (case and whitespace folded).
const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim()
function duplicates(p) {
  const seen = {}
  p.cases.forEach(c => c.asserts.forEach(a => { const k = `${norm(c.arrange)} | ${norm(c.act)} | ${norm(a)}`; (seen[k] = seen[k] || new Set()).add(c.id) }))
  return Object.entries(seen).filter(([, ids]) => ids.size > 1).map(([check, ids]) => ({ check, cases: [...ids] }))
}
let cov = coverage(plan)
let dup = duplicates(plan)
if (cov.length || dup.length) {
  plan = await call('plan', NO_CODE_PRE, 'replan', {
    test_ids: testIds.join(', '), 'plan.cases': plan.cases, research,
    uncovered: cov, uncovered_note: cov.length > 0, duplicates: dup, duplicates_note: dup.length > 0,
  }, PLAN_CONTRACT, { schema: casesSchema(testIds), phase: 'Plan', label: 'replan' }) || plan
  cov = coverage(plan)
  dup = duplicates(plan)
}
plan.verify_review = checkIds.filter(id => !testIds.includes(id)).map(lineOf)
plan.verify_launch = reqIds.filter(id => !checkIds.includes(id)).map(id => ({ requirement: lineOf(id), how: harnessOf(id).how }))
// A question is kept only when a case takes its reading.
const questions = (plan.questions || []).filter(q => q.cases.some(id => plan.cases.some(c => c.id === id)))
const cases = plan.cases.map(c => Object.assign({}, c, { requirement: lineOf(idOf(c.requirement)) }))
log(`plan: ${cases.length} cases, ${cov.length} uncovered, ${dup.length} duplicate checks, ${questions.length} questions (${(plan.questions || []).length - questions.length} tied to no case), ${plan.verify_review.length} verify-by-review, ${plan.verify_launch.length} verify-by-launch`)

phase('Implement')
const implementCall = (retry, label) => call('implement', PRE, 'implement', {
  retry_note: !!retry, BASE, previous_notes: retry || undefined,
  IMPLEMENT_SKILL, code_rules: CODE_RULES, cases, research,
}, contract(writer('Commit your work as it stands, even with a gate worse than its baseline.'),
  'Report: head (`git rev-parse HEAD`); checks: a row per case (ref: its id; requirement: its id, e.g. R1) and per boundary phrase (ref: the ticket\'s words, quoted); questions (requirement: its id; reading: the one you took; settles: plan when the plan contradicts the ticket and you followed the ticket, owner when the ticket leaves it open).',
  died(`Answer with a head past ${BASE}`)), { schema: IMPL_SCHEMA, phase: 'Implement', label })
let impl = await implementCall(null, 'implement')
const same = (a, b) => !!a && !!b && (a.startsWith(b) || b.startsWith(a))
// Made nothing: no commit. Implement commits even with a red gate, so work left uncommitted gets the retry, which
// commits it; review never reads an empty diff.
const madeNothing = r => !r || same(r.head, BASE)
if (madeNothing(impl)) {
  log('implement made no commit; retrying once')
  impl = await implementCall(impl ? impl.notes || 'none' : 'agent died', 'implement:retry')
  if (madeNothing(impl)) return { status: 'failed', stage: 'implement', note: 'two attempts made no commit; nothing was reviewed', research, cases, failures }
}
// A case with no case row, and every row that says why it has no test, join the free-text unverified list.
const rowless = cases.filter(c => !impl.checks.some(r => r.kind === 'case' && r.ref === c.id)).map(c => `case ${c.id}: no check reported`)
impl.unverified = impl.unverified.concat(rowless, impl.checks.filter(r => r.unverified).map(r => `${r.ref}: ${r.unverified}`))
log(`implement: ${impl.checks.length} checks, ${rowless.length} cases without one`)
// Implement questions go to the result alone, like research's.
const implementQuestions = impl.questions.filter(q => reqIds.includes(idOf(q.requirement)) || log(`implement question for unknown requirement ${q.requirement}: dropped`))

let mutation = null

// The gates step runs once per HEAD, before the lenses, which get its lines. HEAD moves only when implement or a fix commits.
let headNow = impl.head
let gated = null

// The gates step only executes; the script turns its rows into findings and failures.
async function runGates(round, label, tag) {
  phase('Gates')
  const res = await call('gates', NO_CODE_PRE, 'run', { HEAD: headNow, REPO, gate_list: `- ${gateList('\n- ')}` }, contract(READ_ONLY,
    'head: `git rev-parse HEAD`. One row per gate: `line` its summary line verbatim; `status` `green` (at its baseline or better), `red` (worse) or `not_run` (`line` the reason).',
    died('Answer with a green or red row per gate')), { schema: GATES_SCHEMA, phase: 'Gates', label })
  if (!res) failures.push(`gates ${label}`)
  else headNow = res.head || headNow
  const rows = GATES.map(g => (res && res.gates.find(r => r.name === g.name)) || { name: g.name, status: 'not_run', line: res ? 'no row' : 'the gates step died' })
  if (res) rows.filter(r => r.status === 'not_run').forEach(r => failures.push(`gates ${label}: ${r.name} not run: ${r.line}`))
  const vs = r => `${r.line} (baseline: ${BASELINE[r.name]})`
  return { head: headNow, gates: rows, found: rows.filter(r => r.status === 'red').map(r => ({
    id: `G${round}${tag || ''}-${r.name}`, source: 'gates', severity: 'major', where: r.name, problem: vs(r), trigger: vs(r),
    consequence: 'the gate is worse than at base', fix: 'make the gate pass at its baseline or better' })) }
}

// The mutation step runs once per run, on the HEAD the review rounds settled on, not in every round's gates step.
// Returns every survivor as a major for fix, which may reject it with an argument like any finding.
let mutated = false
// A mutant's place: its file from the +++ side (the --- side for a deleted file), less any timestamp; its line from
// the HEAD side of its first hunk header.
const placeOf = patch => {
  const to = (/^\+\+\+ (?:b\/)?([^\t\n]*)/m.exec(patch) || [, ''])[1].trim()
  const from = (/^--- (?:a\/)?([^\t\n]*)/m.exec(patch) || [, ''])[1].trim()
  return { file: to && to !== '/dev/null' ? to : from, line: +(/^@@ -(\d+)/m.exec(patch) || [, 0])[1] }
}
const sq = s => `'${String(s).replace(/'/g, `'\\''`)}'`
async function runMutation() {
  mutated = true
  const { tool, test, build, edges, timeout } = CONFIG.mutation
  if (!tool && !test) { log('mutation: no blocks.mutation, step skipped'); return [] }
  phase('Gates')
  // The approach: the project's tool, or mutants generated against the checks and run by the runner.
  const [covers, part, values] = tool ? ['files the tool covers', 'tool', { 'config.tool': tool }]
    : ['production source', 'generated', {
      BASE, TARGET, RUN, 'config.edges': edges, tested_checks: impl.checks.filter(r => r.test && !r.unverified),
      mutate_command: `node ${MUTATE} --mutants ${RUN}/mutants.json --repo ${REPO} --head ${headNow} --dir ${RUN} --test ${sq(test)}${build ? ` --build ${sq(build)}` : ''} --timeout ${timeout}`,
    }]
  const res = await call('mutation', NO_CODE_PRE, part, Object.assign({ HEAD: headNow }, values),
    contract(READ_ONLY, `applies: whether \`git diff --name-only ${BASE}..HEAD\` lists ${covers}; when it does not, ran is false and mutants []. If it applies and did not run, ran is false and not_run the reason — never a pass.`,
      died('Answer')), { schema: MUTATION_SCHEMA, phase: 'Gates', label: 'mutation' })
  if (!res) { failures.push('mutation'); return [] }
  if (!res.applies) { log('mutation: no file it covers in the diff, step skipped'); return [] }
  if (!res.ran) failures.push(`mutation not run: ${res.not_run || 'no reason given'}`)
  const mutants = res.mutants.map((m, i) => Object.assign({ id: `M-${i + 1}`, target: m.target }, placeOf(m.patch), { patch: m.patch, status: m.status }))
  mutants.filter(m => m.status === 'not_run').forEach(m => failures.push(`mutation ${m.id} not run: ${m.target}`))
  mutation = { mutants, counts: Object.fromEntries(MUTANT_STATUS.map(s => [s, mutants.filter(m => m.status === s).length])) }
  log(`mutation: ${JSON.stringify(mutation.counts)}`)
  return mutants.filter(m => m.status === 'survived').map(m => ({
    id: m.id, key: m.patch, source: 'mutation', severity: 'major', where: `${m.file}:${m.line}`,
    problem: `a mutant aimed at ${m.target} survives: no test fails on it`, trigger: m.patch,
    consequence: 'no test fails, so a defect of that shape ships unnoticed',
    fix: `make the test of ${m.target} fail on this mutant, or reject it with an argument that no test could tell it apart or that the code cannot run` }))
}
async function runFix(round, toFix, label) {
  phase('Fix')
  return call('fix', PRE, 'fix', { round, IMPLEMENT_SKILL, code_rules: CODE_RULES, findings: toFix, research, fixed, earlier_fixes: fixed.length > 0 }, fixContract(
    'Commit only with every gate at its baseline or better. If a gate stays worse than its baseline, revert your edits, report `head` unchanged and reject every finding, naming each such gate in its `argument`.',
    toFix.some(f => f.proof) && 'For a finding with a `proof`, run its `command` first: green on HEAD is a valid rejection ("proof green"); a red proof is rejected only with an argument against the test. Never leave a proof as written: rewrite it into the suite in its style and commit it, or delete it; report each in `proofs`.',
    fixed.length && 'A finding whose root cause appears in EARLIER FIXES twice already is not patched a third time: reject it with the argument "recurs after two fixes: needs a split or the user".'),
  { schema: FIX_SCHEMA, phase: 'Fix', label })
}
// The contract part of fix and minor fix: a writer that keeps its bar (COMMIT_RULE folds into the one commit), the
// block's rules, the head and proofs it reports.
const fixContract = (bar, ...rules) => contract(writer(bar), ...rules,
  'Report head: `git rev-parse HEAD` after your last change; proofs: [] when no finding has a proof.', died('Answer'))

// The last round's fix, which no full round follows, is reviewed on its own diff: did it fix what it was given, did it break
// anything near it, did it weaken a test. given: each finding the fix was sent, with its outcome (outcomeOf). Returns
// its findings, or null when the reviewer died.
let fixReviews = 0
async function fixReview(fromHead, given, label) {
  fixReviews += 1
  phase('Review')
  const res = await call('fix-review', NO_CODE_PRE, 'fix-review', {
    HEAD: headNow, from_head: fromHead, research, 'duty.test_case_review_fix': CONFIG.review.duties.test_case_review,
    given,
  }, contract(READ_ONLY, TARGETED, SEVERITY, CHECKED('finding it was given (item = its id), then one per other thing you verified')),
  { schema: REVIEW_SCHEMA, phase: 'Review', label })
  if (!res) { failures.push(`fix review ${label}`); return null }
  const quiet = silence(res)
  if (quiet) failures.push(`fix review ${label} silent: ${quiet}`)
  verdicts.push({ round: label, lens: 'fix review', verdict: quiet ? 'SILENT' : res.verdict, count: res.findings.length })
  return tidy(res.findings).map((f, k) => proven(Object.assign({ id: `F${fixReviews}-${k + 1}`, source: 'fix review' }, f)))
}

let rejections = []
const advisory = []
const fixed = []
const history = []
const verdicts = []
const rounds = []
const status = {}
let unfixed = []
let round = 0
while (round < N) {
  round += 1
  const fresh = !gated || !same(gated.head, headNow)
  const gatesStep = async () => {
    if (!fresh) return gated
    return runGates(round, `gates:r${round}`)
  }
  phase('Review')
  let fromHead = headNow
  const active = LENSES.filter(l => LENS_KEYS.includes(l.key))
  gated = await gatesStep()
  const lensResults = await parallel(active.map(l => () => call('review', NO_CODE_PRE, l.key, {
    round, rounds: N, TARGET, BASE, IMPLEMENT_SKILL, research, code_rules: CODE_RULES, check_ids: checkIds.join(', '),
    gate_rows: gated.gates.map(r => `${r.name}: ${r.status} — ${r.line}`).join('\n'),
    history, earlier_findings: history.length > 0,
    verify_review: plan.verify_review, verify_review_note: plan.verify_review.length > 0,
    unverified: impl.unverified, unverified_note: impl.unverified.length > 0,
    'config.runtime': CONFIG.review.runtime, runtime_note: !!CONFIG.review.runtime,
    'duty.order': CONFIG.review.duties.order, 'duty.test_case_review': CONFIG.review.duties.test_case_review,
  }, contract(...l.rules(), `${SEVERITY}${round > 1 ? ' A major on code the last fix did not change says in `problem` why the earlier round could not see it.' : ''}`, CHECKED(l.checked)),
  { schema: l.schema, phase: 'Review', label: `review:r${round}:${l.key}` })))

  const found = fresh ? gated.found.slice() : []
  let reviewed = true
  lensResults.forEach((res, i) => {
    const l = active[i]
    if (!res) { failures.push(`review r${round} ${l.key}`); verdicts.push({ round, lens: l.key, verdict: 'DIED' }); reviewed = false; return }
    const quiet = silence(res)
    if (quiet) { failures.push(`review r${round} ${l.key} silent: ${quiet}`); reviewed = false }
    verdicts.push({ round, lens: l.key, verdict: quiet ? 'SILENT' : res.verdict, count: res.findings.length })
    if (l.key === 'checklist') {
      const rows = {}
      res.checked.forEach(c => { rows[idOf(c.item)] = c })
      checkIds.forEach(id => { status[id] = rows[id] ? { status: rows[id].status, promise: rows[id].promise, counterexample: rows[id].counterexample, evidence: rows[id].evidence } : { status: 'unverified', evidence: 'no checked row' } })
      // unmet is fixed like any major; unverified only goes to the leftover list at the end.
      checkIds.filter(id => status[id].status === 'unmet').forEach(id => found.push({ id: `R${round}-${id}`, source: 'checklist', severity: 'major',
        where: research.requirements.find(r => idOf(r) === id), problem: `${status[id].promise} — ${status[id].evidence}`, trigger: status[id].counterexample,
        consequence: 'the statement\'s promise is not met', fix: 'keep the promise' }))
    }
    found.push(...tidy(res.findings).map((f, k) => proven(Object.assign({ id: `R${round}-${l.key}-${k + 1}`, source: l.key }, f))))
  })
  let toFix = found.filter(f => f.severity !== 'minor')
  advisory.push(...found.filter(f => f.severity === 'minor'))
  if (lensResults.every(r => !r)) log(`round ${round}: every lens died — this round was NOT reviewed`)
  const bySeverity = s => found.filter(f => f.severity === s).length
  rounds.push({ round, major: bySeverity('major'), minor: bySeverity('minor'), gates: gated.gates })
  log(`round ${round}: ${toFix.length} to fix`)

  if (!reviewed) log(`round ${round}: a lens died or came back silent — not a clean round`)
  if (!toFix.length && reviewed && round >= MIN_ROUNDS) {
    if (mutated) break
    toFix = await runMutation()
    if (!toFix.length) break
    // Survivors get a fix and one more review round, without the step.
    log(`mutation: ${toFix.length} survivors to fix`)
    if (round === N) N += 1
  }
  if (toFix.length && round === N && EXTRA > 0) {
    EXTRA -= 1
    N += 1
    log(`round ${round}: ${toFix.length} to fix in the last round, one more round reviews the fix`)
  }
  let fix = null
  if (toFix.length) {
    fromHead = headNow
    fix = await runFix(round, toFix, `fix:r${round}`)
    if (!fix) { failures.push(`fix r${round}`); unfixed = toFix; break }
    fixed.push(...fix.applied.map(a => Object.assign({ round }, a)))
    rounds[rounds.length - 1].applied = fix.applied.length
    rounds[rounds.length - 1].rejected = fix.rejected.length
    rejections = fix.rejected.map(r => Object.assign({}, toFix.find(f => f.id === r.id) || { id: r.id }, { argument: r.argument }))
    toFix.forEach(f => history.push(Object.assign({ id: f.id, round }, outcomeOf(f, fix))))
    reconcile(toFix, fix)
    headNow = fix.head || headNow
  }
  if (round === N) {
    unfixed = rejections.slice()
    // The last round's fix gets a fix-diff review; its majors get one more fix and review, then are left over.
    if (toFix.length && !same(headNow, fromHead)) {
      let from = fromHead
      let given = toFix
      let by = fix
      for (let pass = 0; ; pass++) {
        const late = await fixReview(from, given.map(f => outcomeOf(f, by)), `review:fix:r${round}${pass ? `:${pass}` : ''}`)
        if (!late) {
          unfixed.push(...given.map(f => Object.assign({}, f, { status: 'unverified', problem: `fixed in the last round, its review died: ${f.problem}` })))
          break
        }
        advisory.push(...late.filter(f => f.severity === 'minor'))
        const majors = late.filter(f => f.severity !== 'minor')
        if (!majors.length) break
        if (pass >= 1) { unfixed.push(...majors.map(f => Object.assign({}, f, { status: 'unverified' }))); break }
        from = headNow
        const again = await runFix(round, majors, `fix:r${round}:review`)
        if (!again) { failures.push(`fix r${round} review`); unfixed.push(...majors); break }
        fixed.push(...again.applied.map(a => Object.assign({ round }, a)))
        headNow = again.head || headNow
        given = majors
        by = again
      }
    }
    if (!same(headNow, gated.head)) {
      // The last fix moved HEAD and no review follows: the gates step checks it.
      gated = await runGates(round, `gates:r${round}:recheck`, 'r')
      rounds[rounds.length - 1].recheck = gated.gates
      unfixed.push(...gated.found)
    }
  }
}
// A run that used up its rounds without a clean one still gets its one mutation run; its survivors are left over.
if (!mutated && !failures.some(f => f.startsWith('fix '))) unfixed.push(...await runMutation())
// A finding is the same finding by what it says, not by its positional id: a survivor by its patch,
// any other by source, place and problem (a rejection without a place by its id).
const sameKey = f => f.key || (f.where ? `${f.source}|${f.where}|${f.problem}` : f.id)
const uniq = xs => xs.filter((x, i) => xs.findIndex(y => sameKey(y) === sameKey(x)) === i)
const unmet = checkIds.filter(id => !status[id] || status[id].status !== 'met').map(id => ({
  id, source: 'checklist', where: research.requirements.find(r => idOf(r) === id), status: status[id] ? status[id].status : 'unverified',
  problem: status[id] ? status[id].evidence : 'the checklist lens never answered' }))

// Cheap minor findings get one pass of a cheaper fixer after the rounds; the ones it does not apply stay advisory.
const cheap = uniq(advisory)
let minorFix = null
if (cheap.length && !failures.length) {
  phase('Fix')
  minorFix = await call('minor-fix', PRE, 'minor-fix', { IMPLEMENT_SKILL, code_rules: CODE_RULES, findings: cheap }, fixContract('Commit only with no gate worse than before your edit.',
    cheap.some(f => f.proof) && 'Delete the file of every finding with a `proof`, applied or not, and report each in `proofs`.'), { schema: FIX_SCHEMA, phase: 'Fix', label: 'fix:minor' })
  if (!minorFix) failures.push('fix minor')
  else reconcile(cheap, minorFix)
}
// A proof no fix was sent (its fix died, the run stopped) is a stray too; strays count as failures only here, so
// one never skips the minor fix.
proofs.filter(f => !settled.has(f.id)).forEach(stray)
strayProofs.forEach(s => failures.push(`stray proof ${s.id}: ${s.path}`))
const minorApplied = f => !!minorFix && minorFix.applied.some(a => a.id === f.id)

// Freeing the run directory is the main thread's step after acceptance (README § Shape).
return {
  status: failures.length ? 'done_with_failures' : impl.unverified.length ? 'done_unverified' : 'done',
  rounds_planned: N,
  rounds_run: round,
  rounds,
  verdicts,
  mutation,
  uncovered_requirements: cov,
  dropped_facts: droppedFacts,
  unresearched_requirements: unresearched,
  plan_questions: questions,
  research_issues: researchIssues,
  research_questions: researchQuestions,
  implement_questions: implementQuestions,
  gates: GATES,
  gates_questions: gatesQuestions,
  verify_launch: plan.verify_launch,
  verify_review: plan.verify_review,
  leftover_findings: uniq(unfixed.concat(unmet)),
  advisory: uniq(advisory).filter(f => !minorApplied(f)),
  minor_fixes: minorFix && { applied: minorFix.applied, rejected: minorFix.rejected },
  stray_proofs: strayProofs,
  unverified: impl.unverified,
  implement: { checks: impl.checks, notes: impl.notes },
  mailbox,
  failures,
}
