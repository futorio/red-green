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
const implementCall = (retry, label) => call('implement', PRE, 'implement', {
  retry_note: !!retry, BASE, previous_notes: retry || undefined,
  IMPLEMENT_SKILL, code_rules: CODE_RULES, cases, research,
}, contract(writer('Commit your work as it stands, even with a gate worse than its baseline: the gates step hands what is red to the fix.'),
  'Report: head (`git rev-parse HEAD`); checks: a row per case (ref: its id) and per boundary phrase (ref: the ticket\'s words, quoted); unverified; questions (requirement: its id; reading: the one you took; settles: plan when the plan contradicts the ticket and you followed the ticket, owner when the ticket leaves it open); notes.',
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
