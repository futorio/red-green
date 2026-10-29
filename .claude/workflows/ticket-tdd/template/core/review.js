// Block review lenses (checklist, code): the review schemas, the severity and checked rules, the lenses and the lens call.
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
const PRODUCTION = 'production source (only tests, docs, data or config)'
// @part rules

const SEVERITY = `SEVERITY. major: a concrete defect in this diff, with a \`trigger\` (a reachable input or path that shows it) and a \`consequence\` (what breaks). A passing test or a ruling in the research does not cancel a trigger you can name. minor: everything else — wording, style, a future risk, "one more test would be nice"; report at most two minors, one sentence each. A missing test is major only when you name the behaviour this diff adds, why the existing tests miss it, and the input that shows it. One root cause is one finding. After your first finding, make one more pass on a different concern before you stop. An empty list is a valid answer.`
// what: the rows' subject; none when the job already says what a row is.
const CHECKED = what => `In \`checked\`, ${what ? `one row per ${what}; ` : ''}\`evidence\` is one sentence naming the file, test or command output that settled it. A bare "ok" is not evidence. verdict is \`clean\` exactly when findings is empty. A review with no checked rows is read as no review.`
// @part lenses

const GATES_APART = gated => `The gates step already ran every gate and long check at this HEAD; review the diff and its rows below.
GATES:
${gated.gates.map(r => `${r.name}: ${r.status} — ${r.line}`).join('\n')}`

const LENSES = [
  { key: 'checklist', schema: reviewSchema(Object.assign({ promise: { type: 'string' }, counterexample: { type: 'string' } }, STATUS)), job: () => `${READ_ONLY} Review the change against its statement. For each requirement id — ${checkIds.join(', ')} — the promise is the sentence of the statement it rests on, whatever the code, its docs or its tests say. Then find a counterexample: the input or path most likely to make the promise false on the diff \`git diff ${BASE}..HEAD\` — a boundary, an empty or malformed input, an error path, an exit code, a second caller.${plan.verify_review.length ? ` These have no test and are checked only by you: ${JSON.stringify(plan.verify_review)}.` : ''} ${TARGETED} One \`checked\` row per id: item = the id, promise = the quoted sentence with its file and section, counterexample = the input you tried, status \`met\` (the counterexample was tried and the promise held), \`unmet\` (it breaks the promise: name it) or \`unverified\` (you could not try it). An id without a row counts as unverified. An \`unmet\` row becomes a finding by itself; \`findings\` are for defects outside the requirements. Scope: a change the statement does not call for is a finding.${impl.unverified.length ? ` Implementation said it did not test: ${JSON.stringify(impl.unverified)}; weigh each against the requirement it touches.` : ''}` },
  { key: 'code', schema: REVIEW_SCHEMA, job: () => `${READ_ONLY} The one exception is a proof: you may prove a major about behaviour with a test, written as a new, uncommitted file in the repository's test directory; \`proof\` is its path, the exact command and the output line that showed it red on HEAD. ${TARGETED} Read the code as code: would every new branch execute as intended${P.runtime ? ` in ${P.runtime}` : ''}, is every new assertion falsifiable. For each check, guard, clamp or documented promise the diff adds, name one input on which it passes while the property it promises is false. Also the rules of ${IMPLEMENT_SKILL} § Code rules. Over-built code is a finding.{{order}}${CODE_RULES}
{{test_case_review.code}}If the diff holds no ${PRODUCTION}, check one row saying so and stop.` },
]
// @part call
  const lensResults = await parallel(active.map(l => () => ask(`${NO_CODE_PRE}

STAGE: review, round ${round} of at most ${N} — what you do not catch ships. Lens: ${l.key}. ${l.job()}
${GATES_APART(gated)}
Compare against the statement (${TARGET} and every document it points to, as written before the code) and the research plan below.
${SEVERITY}${round > 1 ? ' A major on code the last fix did not change says in `problem` why the earlier round could not see it.' : ''}
${CHECKED(l.key === 'checklist' ? null : 'new or changed function or branch (item = where it is), then one per other thing you verified')}
${past}
RESEARCH:
${RESEARCH}`, { model: M.review, effort: 'high', schema: l.schema, phase: 'Review', label: `review:r${round}:${l.key}` })))
