// Block gates (and discovery): the discovery call and its schema, the gates step schema and runGates.
// @part discover-schema

const DISCOVER_SCHEMA = { type: 'object', properties: {
  gates: { type: 'array', items: { type: 'object', properties: {
    name: { type: 'string' }, command: { type: 'string' }, source: { type: 'string' }, line: { type: 'string' } }, required: ['name', 'command', 'source', 'line'] } },
  questions: { type: 'array', items: { type: 'object', properties: {
    command: { type: 'string' }, source: { type: 'string' }, question: { type: 'string' } }, required: ['command', 'source', 'question'] } },
}, required: ['gates', 'questions'] }
// @part discover
if (P.gates) {
  const unmeasured = GATES.filter(g => !Object.hasOwn(BASELINE, g.name)).map(g => g.name)
  if (unmeasured.length) return { status: 'failed', stage: 'gates', note: `args.baseline has no entry for: ${unmeasured.join(', ')}`, failures }
} else {
  phase('Gates')
  const found = await call('gates', NO_CODE_PRE, `STAGE: gates discovery.
Where: the repo's agent instructions, then CI config, then the task runner; the first source that names gates wins. A gate: a command CI or those instructions require before a commit; runs with no human, network or secrets; pass/fail by exit code; writes nothing to the tree.
Run each gate exactly as its \`command\` reads, once, to completion; one that cannot run that way here is a question, not a gate.
${BG}`, {}, contract(READ_ONLY, 'gates: name, command (the exact command line), source (the file that names it), line (its summary line verbatim, with the cause of any failure). questions: each command you are unsure of (is it a gate, do two sources disagree), with `source` the source of the gate it bears on; it stays out of gates.',
    'No answer, or no gate, counts as died: the run fails.'), { schema: DISCOVER_SCHEMA, phase: 'Gates', label: 'gates:discover' })
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
  const res = await call('gates', NO_CODE_PRE, `STAGE: gates, HEAD {{HEAD}}.
Run each gate below from {{REPO}} to completion and compare it with its baseline.
GATES:
{{gate_list}}
${BG}`, { HEAD: headNow, REPO, gate_list: `- ${gateList('\n- ')}` }, contract(READ_ONLY,
    'One row per gate: `line` its summary line verbatim; `status` `green` (at its baseline or better), `red` (worse) or `not_run` (`line` the reason).',
    'No answer, a gate without a row, or a not_run row is a failure of the run.'), { schema: GATES_SCHEMA, phase: 'Gates', label })
  if (!res) failures.push(`gates ${label}`)
  else headNow = res.head || headNow
  const rows = GATES.map(g => (res && res.gates.find(r => r.name === g.name)) || { name: g.name, status: 'not_run', line: res ? 'no row' : 'the gates step died' })
  if (res) rows.filter(r => r.status === 'not_run').forEach(r => failures.push(`gates ${label}: ${r.name} not run: ${r.line}`))
  const vs = r => `${r.line} (baseline: ${BASELINE[r.name]})`
  return { head: headNow, gates: rows, found: rows.filter(r => r.status === 'red').map(r => ({
    id: `G${round}${tag || ''}-${r.name}`, source: 'gates', severity: 'major', where: r.name, problem: vs(r), trigger: vs(r),
    consequence: 'the gate is worse than at base', fix: 'make the gate pass at its baseline or better' })) }
}
