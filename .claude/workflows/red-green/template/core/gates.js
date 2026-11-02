// Block gates: the declared gates' checks, the gates step schema and runGates, and its inputs.
// Its only interface is the include order: it reads CONFIG, REPO, RUN, RUN_GATES, failures, NO_CODE_PRE, READ_ONLY, call,
// contract, died, sq, validate, STAGE_GATES, GATES, BASELINE, phase, and INPUTS; it sets headNow (runGates).
// @part config
// A run has declared gates, each with a tier: the start skill finds them when a profile has none.
const declaredGates = Array.isArray(CONFIG.gates.gates) ? CONFIG.gates.gates.filter(g => g && typeof g === 'object') : []
declaredGates.filter(g => 'fast' in g).forEach(g => configErrors.push(`blocks.gates.gates: ${g.name}: fast moved to tier (fast, round or acceptance)`))
declaredGates.filter(g => 'tier' in g && !['fast', 'round', 'acceptance'].includes(g.tier)).forEach(g => configErrors.push(`blocks.gates.gates: ${g.name}: tier ${g.tier} is not fast, round or acceptance`))
if (!declaredGates.some(g => g.tier !== 'acceptance')) configErrors.push('blocks.gates.gates: no fast or round gate declared')
if (CONFIG.gates.fix_attempts < 0) configErrors.push(`blocks.gates.fix_attempts: ${CONFIG.gates.fix_attempts} is below 0`)
// @part baseline
const measured = g => Object.hasOwn(BASELINE, g.name) && !validate({ type: 'object', properties: { status: { type: 'string' }, line: { type: 'string' } }, required: ['status', 'line'] }, BASELINE[g.name]).length
const unmeasured = STAGE_GATES.filter(g => !measured(g)).map(g => g.name)
if (unmeasured.length) return { status: 'failed', stage: 'gates', note: `args.baseline has no status and line for: ${unmeasured.join(', ')}`, failures }
// @part schema

const GATES_SCHEMA = { type: 'object', properties: {
  head: { type: 'string' },
  gates: { type: 'array', items: { type: 'object', properties: {
    name: { type: 'string', enum: STAGE_GATES.map(g => g.name) }, status: { type: 'string', enum: ['green', 'red', 'known_red', 'not_run'] }, line: { type: 'string' },
    log: { type: 'string' }, seconds: { type: 'number' }, cached: { type: 'boolean' },
  }, required: ['name', 'status', 'line'] } },
  notes: { type: 'string' },
}, required: ['head', 'gates'] }
// @part run

// The gates step only runs the runner, whose rows hold the status; the script turns them into findings and failures. A
// gate with no result gets one retry of the step, which picks up finished gates from the runner's cache.
async function runGates(label, at) {
  phase('Gates')
  const step = stage => call('gates', NO_CODE_PRE, 'run', { HEAD: headNow, REPO, gate_command: `node ${RUN_GATES} --gates ${sq(JSON.stringify(GATES))} --dir ${RUN} --tier round --baseline ${sq(JSON.stringify(BASELINE))}` }, contract(READ_ONLY,
    'head: `git rev-parse HEAD`. One row per gate; a row the script printed stays as printed.',
    died('Answer')), { schema: GATES_SCHEMA, phase: 'Gates', label: stage })
  const rowIn = (res, g) => res && res.gates.find(r => r.name === g.name)
  const hasResult = r => r && r.status !== 'not_run'
  const first = await step(label)
  const retried = STAGE_GATES.every(g => hasResult(rowIn(first, g))) ? null : await step(`${label}:retry`)
  headNow = (retried && retried.head) || (first && first.head) || headNow
  const rows = STAGE_GATES.map(g => {
    const answers = [rowIn(retried, g), rowIn(first, g)]
    return answers.find(hasResult) || answers.find(Boolean) || { name: g.name, status: 'not_run', line: first || retried ? 'no row' : 'the gates step died' }
  })
  const none = rows.filter(r => !hasResult(r))
  if (none.length) failures.push(`gates ${label}: no result for ${none.map(r => `${r.name}: ${r.line}`).join('; ')}`)
  const vs = r => `${r.line} (baseline: ${BASELINE[r.name].line})`
  return { head: headNow, gates: rows, found: rows.filter(r => r.status === 'red').map(r => ({
    id: `G${at}-${r.name}`, source: 'gates', severity: 'major', where: r.name, problem: `${vs(r)}${r.log ? `; full output: ${r.log}` : ''}`, trigger: vs(r),
    consequence: 'the gate fails', fix: 'make the gate pass' })) }
}
// @part inputs
// The inputs of the gates step.
INPUTS.gates = ['HEAD', 'REPO', 'gate_command']
