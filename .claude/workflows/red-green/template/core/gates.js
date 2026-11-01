// Block gates (and discovery): the discovery call and its schema, the gates step schema and runGates, and its inputs.
// Its only interface is the include order: it reads CONFIG, REPO, failures, NO_CODE_PRE, READ_ONLY, call, contract,
// died, gateList, log, phase, and INPUTS; it sets GATES, BASELINE and gatesQuestions (discovery) and headNow
// (runGates).
// @part discover-schema

const DISCOVER_SCHEMA = { type: 'object', properties: {
  gates: { type: 'array', items: { type: 'object', properties: {
    name: { type: 'string' }, command: { type: 'string' }, source: { type: 'string' }, line: { type: 'string' }, fast: { type: 'boolean' } }, required: ['name', 'command', 'source', 'line', 'fast'] } },
  questions: { type: 'array', items: { type: 'object', properties: {
    command: { type: 'string' }, source: { type: 'string' }, question: { type: 'string' } }, required: ['command', 'source', 'question'] } },
}, required: ['gates', 'questions'] }
// @part discover
if (CONFIG.gates.gates) {
  const unmeasured = GATES.filter(g => !Object.hasOwn(BASELINE, g.name)).map(g => g.name)
  if (unmeasured.length) return { status: 'failed', stage: 'gates', note: `args.baseline has no entry for: ${unmeasured.join(', ')}`, failures }
} else {
  phase('Gates')
  const found = await call('gates', NO_CODE_PRE, 'discover', {}, contract(READ_ONLY, 'gates: name, command (the exact command line), source (the file that names it), line (its summary line verbatim, with the cause of any failure), `fast` (whether it is a fast gate). questions: each command you are unsure of (is it a gate), with `source` the source of the gate it bears on; it stays out of gates. A repository with no gate: gates [] and a question saying where you looked.',
    died('Answer')), { schema: DISCOVER_SCHEMA, phase: 'Gates', label: 'gates:discover' })
  if (!found || !found.gates.length) return { status: 'failed', stage: 'gates:discover', note: found ? 'no gate found' : 'the discovery step died', gates_questions: found ? found.questions : [], failures }
  GATES = found.gates
  BASELINE = Object.fromEntries(GATES.map(g => [g.name, g.line]))
  gatesQuestions = found.questions.filter(q => GATES.some(g => g.source === q.source) || log(`gates question from unknown source ${q.source}: dropped`))
}
// @part schema

const GATES_SCHEMA = { type: 'object', properties: {
  head: { type: 'string' },
  gates: { type: 'array', items: { type: 'object', properties: {
    name: { type: 'string', enum: GATES.map(g => g.name) }, status: { type: 'string', enum: ['green', 'red', 'not_run'] }, line: { type: 'string' },
  }, required: ['name', 'status', 'line'] } },
  notes: { type: 'string' },
}, required: ['head', 'gates'] }
// @part run

// The gates step only executes; the script turns its rows into findings and failures.
async function runGates(round, label, tag) {
  phase('Gates')
  const res = await call('gates', NO_CODE_PRE, 'run', { HEAD: headNow, REPO, gate_list: `- ${gateList('\n- ')}` }, contract(READ_ONLY,
    'head: `git rev-parse HEAD`. One row per gate: `line` its summary line verbatim; `status` `green` (at its baseline or better), `red` (worse) or `not_run` (`line` the reason).',
    died('Answer with a green or red row per gate')), { schema: GATES_SCHEMA, phase: 'Gates', label })
  if (!res) failures.push(`gates ${label}`)
  else headNow = res.head || headNow
  const rows = GATES.map(g => (res && res.gates.find(r => r.name === g.name)) || { name: g.name, status: 'not_run', line: res ? 'no row' : 'the gates step died' })
  // A gate the live step did not finish is a finding like a red one: an unfinished gate never reads as a pass.
  const vs = r => `${r.line} (baseline: ${BASELINE[r.name]})`
  const why = { red: { consequence: 'the gate is worse than at base', fix: 'make the gate pass at its baseline or better' },
    not_run: { consequence: 'the gate was not measured at this HEAD', fix: 'make the gate run to completion at its baseline or better' } }
  return { head: headNow, gates: rows, found: res ? rows.filter(r => r.status !== 'green').map(r => ({
    id: `G${round}${tag || ''}-${r.name}`, source: 'gates', severity: 'major', where: r.name, problem: vs(r), trigger: vs(r),
    ...why[r.status] })) : [] }
}
// @part inputs
// The inputs of discovery and the gates step.
INPUTS.gates = ['HEAD', 'REPO', 'gate_list']
