// Block review lenses (checklist, code): the review schemas and the lenses, the severity and checked rules, the duties and the lens call.
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
    rules: () => [`${READ_ONLY} The one exception is a proof: you may prove a major about behaviour with a test, written as a new, uncommitted file in the repository's test directory; \`proof\` is its path, the exact command and the output line that showed it red on HEAD.`, TARGETED] },
]
// @part rules

// The output rules every review stage gets in its contract part; the minors cap is the review block's config.
const SEVERITY = `SEVERITY. major: a concrete defect in this diff, with a \`trigger\` (a reachable input or path that shows it) and a \`consequence\` (what breaks). A passing test or a ruling in the research does not cancel a trigger you can name. minor: everything else — wording, style, a future risk, "one more test would be nice"; report at most ${CONFIG.review.minors} minors, one sentence each. A missing test is major only when you name the behaviour this diff adds, why the existing tests miss it, and the input that shows it. One root cause is one finding. After your first finding, make one more pass on a different concern before you stop. An empty list is a valid answer.`
// what: the rows' subject; none when the job already says what a row is. Its last sentence is what counts as died.
const CHECKED = what => `In \`checked\`, ${what ? `one row per ${what}; ` : ''}\`evidence\` is one sentence naming the file, test or command output that settled it. A bare "ok" is not evidence. ${died('Return at least one checked row and verdict `clean` exactly when findings is empty')}`
// @part call
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
