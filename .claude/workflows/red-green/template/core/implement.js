// Block implement: its schema, the call with its one retry, and its inputs. Its only interface is the include order: it
// reads BASE, IMPLEMENT_SKILL, CODE_RULES, CONFIG, research, reqIds, cases, frameworkValues, failures, PRE, call, contract,
// writer, died, retryValues, idOf, log, phase, CONTRACTS, FRAMEWORK, and INPUTS, BLOCK_PATHS, INTEGER, STRING, CASE; it
// declares IMPL_SCHEMA, impl, same and implementQuestions for later parts.
// @part schema

// A check row proves a case (ref: its id) or a boundary phrase of the ticket (ref: its words, quoted) by a test, or says why not.
const IMPL_SCHEMA = { type: 'object', properties: {
  head: { type: 'string' },
  checks: { type: 'array', items: { type: 'object', properties: {
    kind: { type: 'string', enum: ['case', 'phrase'] }, ref: { type: 'string' }, requirement: { type: 'string' },
    test: { type: 'object', properties: { file: { type: 'string' }, name: { type: 'string' } }, required: ['file', 'name'] },
    red: { type: 'string' },
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
const implementCall = (retry, label) => call('implement', PRE, 'implement',
  Object.assign({ BASE, IMPLEMENT_SKILL, code_rules: CODE_RULES, cases, research, property_examples: CONFIG.implement.property_examples,
    property_shapes: FRAMEWORK ? undefined : cases.filter(c => c.property).map(c => `\`${c.property.id}\` ${CONTRACTS.example(c.property.domain)}`).join(', ') },
    frameworkValues(cases.some(c => c.property)), retryValues(retry)), contract(writer('Commit your work as it stands.'),
  'Report: head (`git rev-parse HEAD`); checks: a row per case (ref: its id; requirement: its id, e.g. R1) and per boundary phrase (ref: the ticket\'s words, quoted), a row with a test also `red`: the failure line it showed before the code; questions (requirement: its id; reading: the one you took; settles: plan when the plan contradicts the ticket and you followed the ticket, owner when the ticket leaves it open).',
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
// A property case's row names its contract id.
impl.checks.forEach(r => { const c = r.kind === 'case' && cases.find(c => c.id === r.ref); if (c && c.property) r.contract = c.property.id })
// A case with no case row, every row that says why it has no test, and a test with no red line join the free-text unverified list.
const rowless = cases.filter(c => !impl.checks.some(r => r.kind === 'case' && r.ref === c.id)).map(c => `case ${c.id}: no check reported`)
impl.unverified = impl.unverified.concat(rowless, impl.checks.filter(r => r.unverified).map(r => `${r.ref}: ${r.unverified}`),
  impl.checks.filter(r => r.test && !r.unverified && !r.red).map(r => `${r.ref}: test ${r.test.name} reported no red line`))
log(`implement: ${impl.checks.length} checks, ${rowless.length} cases without one`)
// Implement questions go to the result alone, like research's.
const implementQuestions = impl.questions.filter(q => reqIds.includes(idOf(q.requirement)) || log(`implement question for unknown requirement ${q.requirement}: dropped`))
// @part inputs
// Implement's inputs, and the paths only it reads: the cases, requirement lines expanded, the examples a framework test runs
// and one runner example per property case.
INPUTS.implement = ['BASE', 'previous_notes', 'retry_note', 'IMPLEMENT_SKILL', 'code_rules', 'property_framework', 'property_examples', 'property_framework_note', 'property_runner_note', 'property_shapes', 'cases', 'research']
Object.assign(BLOCK_PATHS, { cases: { type: 'array', items: CASE }, property_examples: INTEGER, property_shapes: STRING })
