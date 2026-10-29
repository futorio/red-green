// Block implement: its schema, the prompt builder and the call with its one retry.
// @part schema

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
// @part call

phase('Implement')
const implementPrompt = retry => `${preWith('Commit your work as it stands, even with a gate worse than its baseline: the gates step hands what is red to the fix.')}

STAGE: implementation.${retry ? ` A previous attempt at this stage made NO commit (HEAD still ${BASE}); its notes: ${JSON.stringify(retry)}. Implement the ticket now.` : ''} Read ${IMPLEMENT_SKILL} and follow it, with the tdd/ directory beside it.${CODE_RULES}
Build on the research facts and plan: what they settle is settled.

Before reporting, go through the ticket's sentences for each boundary it states — a limit, an empty input, a missing key, an error path, an exit code — and give each a phrase row with a test at the seam its requirement's test_harness names; a phrase row is unverified only when this environment cannot run its test (no tool, no data, no binary). Then call what you built the way its consumer will — its real entry point, not the steps that built it — and feed it every input, mode and data file the ticket names. Anything you did not run that way, and every claim you did not test, goes in \`unverified\`, one line each with its cause (no tool, no data, no time, out of scope); an empty list claims you ran all of it.

Run the gates once, at the end, before you commit; say in notes which gate is worse than its baseline.

Report: head (\`git rev-parse HEAD\`); checks: a row per case (ref: its id) and per boundary phrase (ref: the ticket's words, quoted); unverified; questions (requirement: its id; reading: the one you took; settles: plan when the plan contradicts the ticket and you followed the ticket, owner when the ticket leaves it open); notes.

CASES:
${CASES}

RESEARCH:
${RESEARCH}`
let impl = await ask(implementPrompt(null), { model: M.implement, effort: 'high', schema: IMPL_SCHEMA, phase: 'Implement', label: 'implement' })
const same = (a, b) => !!a && !!b && (a.startsWith(b) || b.startsWith(a))
// Made nothing: no commit. Implement commits even with a red gate, so work left uncommitted gets the retry, which
// commits it; review never reads an empty diff.
const madeNothing = r => !r || same(r.head, BASE)
if (madeNothing(impl)) {
  log('implement made no commit; retrying once')
  impl = await ask(implementPrompt(impl ? impl.notes || 'none' : 'agent died'), { model: M.implement, effort: 'high', schema: IMPL_SCHEMA, phase: 'Implement', label: 'implement:retry' })
  if (madeNothing(impl)) return { status: 'failed', stage: 'implement', note: 'two attempts made no commit; nothing was reviewed', research, cases, failures }
}
// A case with no case row, and every row that says why it has no test, join the free-text unverified list.
const rowless = cases.filter(c => !impl.checks.some(r => r.kind === 'case' && r.ref === c.id)).map(c => `case ${c.id}: no check reported`)
impl.unverified = impl.unverified.concat(rowless, impl.checks.filter(r => r.unverified).map(r => `${r.ref}: ${r.unverified}`))
log(`implement: ${impl.checks.length} checks, ${rowless.length} cases without one`)
// Implement questions go to the result alone, like research's.
const implementQuestions = impl.questions.filter(q => reqIds.includes(idOf(q.requirement)) || log(`implement question for unknown requirement ${q.requirement}: dropped`))
