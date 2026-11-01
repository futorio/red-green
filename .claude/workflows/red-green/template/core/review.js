// Block review lenses (checklist, code): the review schemas and the lenses, the severity and checked rules, the lens
// call, and its inputs. Its only interface is the include order: it reads CONFIG, TARGET, BASE, IMPLEMENT_SKILL,
// CODE_RULES, research, plan, impl, checkIds and, in the round loop, round, N, active, gated, attempts, history and lastFix; NO_CODE_PRE,
// READ_ONLY, TARGETED, call, contract, died, parallel, and INPUTS, BLOCK_PATHS, STRING, INTEGER, LIST. It declares
// FINDING, REVIEW_SCHEMA, LENSES, SEVERITY, CHECKED and lensResults for later parts.
// @part schema

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
    rules: last => [last ? `${READ_ONLY} Write no proof file: no fix follows this round.`
      : `${READ_ONLY} The one exception is a proof: you may prove a major about behaviour with a test, written as a new, uncommitted file in the repository's test directory; \`proof\` is its path, the exact command and the output line that showed it red on HEAD. Write no proof file for a minor.`, TARGETED] },
]
// @part rules

// The output rules every review stage gets in its contract part; the minors cap is the review block's config.
const SEVERITY = `SEVERITY. major: a concrete defect in this diff, with a \`trigger\` (a reachable input or path that shows it) and a \`consequence\` (what breaks). A passing test or a ruling in the research does not cancel a trigger you can name. minor: everything else — wording, style, a future risk, "one more test would be nice"; report at most ${CONFIG.review.minors} minors, one sentence each. A missing test is major only when you name the behaviour this diff adds, why the existing tests miss it, and the input that shows it. One root cause is one finding. After your first finding, make one more pass on a different concern before you stop.`
// what: the rows' subject; none when the job already says what a row is. Its last sentence is what counts as died.
const CHECKED = what => `In \`checked\`, ${what ? `one row per ${what}; ` : ''}\`evidence\` is one sentence naming the file, test or command output that settled it. ${died('Return at least one checked row and verdict `clean` exactly when findings is empty and no row is `unmet`')}`
// @part call
  const lensResults = await parallel(active.map(l => () => call('review', NO_CODE_PRE, l.key, {
    round, rounds: N, TARGET, BASE, IMPLEMENT_SKILL, research, code_rules: CODE_RULES, check_ids: checkIds.join(', '),
    gate_rows: gated.gates.map(r => `${r.name}: ${r.status} — ${r.line}`).join('\n'),
    red_gates: gated.found.map(f => f.where).join(', '), attempts_made: gated.found.length ? attempts : undefined, red_gates_note: gated.found.length > 0,
    history, earlier_findings: history.length > 0,
    from_head: lastFix ? lastFix.from : undefined, last_fix: lastFix ? lastFix.outcomes : undefined, last_fix_note: !!lastFix,
    'duty.test_case_review_fix': !!lastFix && CONFIG.review.duties.test_case_review,
    verify_review: plan.verify_review, verify_review_note: plan.verify_review.length > 0,
    unverified: impl.unverified, unverified_note: impl.unverified.length > 0,
    'config.runtime': CONFIG.review.runtime, runtime_note: !!CONFIG.review.runtime,
    'duty.order': CONFIG.review.duties.order, 'duty.test_case_review': CONFIG.review.duties.test_case_review,
  }, contract(...l.rules(round === N), `${SEVERITY}${round > 1 ? ' A major on code the last fix did not change says in `problem` why the earlier round could not see it.' : ''}`, CHECKED(l.checked)),
  { schema: l.schema, phase: 'Review', label: `review:r${round}:${l.key}` })))
// @part inputs
// The lenses' inputs, and the paths only they read: the verify-by-review requirements, implement's unverified claims,
// earlier findings and their outcomes, each finding the last fix was sent with its outcome.
INPUTS.review = ['round', 'rounds', 'TARGET', 'BASE', 'check_ids', 'verify_review', 'verify_review_note', 'unverified', 'unverified_note', 'config.runtime', 'runtime_note', 'IMPLEMENT_SKILL', 'duty.order', 'code_rules', 'duty.test_case_review', 'gate_rows', 'red_gates', 'attempts_made', 'red_gates_note', 'history', 'earlier_findings', 'from_head', 'last_fix', 'last_fix_note', 'duty.test_case_review_fix', 'research']
Object.assign(BLOCK_PATHS, {
  verify_review: LIST, unverified: LIST,
  history: { type: 'array', items: { type: 'object', properties: { id: STRING, round: INTEGER, where: STRING, problem: STRING,
    outcome: { type: 'string', enum: ['fixed', 'rejected'] }, argument: STRING }, required: ['id', 'round', 'problem', 'outcome'] } },
  last_fix: { type: 'array', items: { type: 'object', properties: { id: STRING, where: STRING, problem: STRING,
    outcome: { type: 'string', enum: ['fixed', 'rejected'] }, argument: STRING }, required: ['id', 'problem', 'outcome'] } },
})
