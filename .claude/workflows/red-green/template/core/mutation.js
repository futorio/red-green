// Block mutation: its schema and runMutation, generated mutants or the project's tool, and its inputs. Its only
// interface is the include order: it reads CONFIG, REPO, BASE, TARGET, RUN, MUTATE, headNow, impl, failures,
// NO_CODE_PRE, READ_ONLY, call, contract, died, log, phase, and INPUTS, BLOCK_PATHS, IMPL_SCHEMA; it sets mutation and
// declares mutated and runMutation for later parts.
// @part schema
// One record per mutant, from the runner or a project's own tool; the script derives ids, places and counts.
const MUTANT_STATUS = ['killed', 'survived', 'invalid', 'not_run']
const MUTATION_SCHEMA = { type: 'object', properties: {
  applies: { type: 'boolean' }, ran: { type: 'boolean' }, not_run: { type: 'string' },
  mutants: { type: 'array', items: { type: 'object', properties: {
    target: { type: 'string' }, patch: { type: 'string' }, status: { type: 'string', enum: MUTANT_STATUS } }, required: ['target', 'patch', 'status'] } },
}, required: ['applies', 'ran', 'mutants'] }
// @part run

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
// @part inputs
// Mutation's inputs, and the path only it reads: implement's check rows with a test.
INPUTS.mutation = ['HEAD', 'BASE', 'TARGET', 'RUN', 'config.edges', 'mutate_command', 'tested_checks', 'config.tool']
Object.assign(BLOCK_PATHS, { tested_checks: { type: 'array', items: IMPL_SCHEMA.properties.checks.items } })
