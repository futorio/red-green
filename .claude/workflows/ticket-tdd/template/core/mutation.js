// Block mutation: its schema and runMutation, generated mutants or the project's tool.
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
const sq = s => `'${String(s).replace(/'/g, `'\\''`)}'`
async function runMutation() {
  mutated = true
  if (!P.mutation) { log('mutation: no profile.mutation, step skipped'); return [] }
  phase('Gates')
  const X = P.mutation
  if (!X.tool && !X.test) { failures.push('mutation: profile.mutation has neither test nor tool'); return [] }
  // The approach: the project's tool, or mutants generated against the checks and run by the runner.
  const [covers, how, values] = X.tool ? ['files the tool covers', 'The project\'s mutation tool: {{profile.mutation.tool}} Run it once on this HEAD and report every mutant it ran: `target` `operator`, or a check ref only when the tool names one; `patch` a unified diff against HEAD; `status`.', { 'profile.mutation.tool': X.tool }]
    : ['production source', `Read \`git diff {{BASE}}..HEAD\` and {{TARGET}}. For each check below write one mutant that breaks the behaviour its test claims to pin (\`target\` its ref), then at most {{config.edges}} on edges the ticket does not state (\`target\` \`edge: <short phrase>\`). Each \`patch\` is a unified diff against HEAD that changes production source only, in one place, never a test. Write them as a JSON list of {target, patch} to {{RUN}}/mutants.json, then run once \`{{mutate_command}}\` and report its output list as \`mutants\`; exit 2 means it did not run.
${BG}
CHECKS:
{{tested_checks}}`, {
      BASE, TARGET, RUN, 'config.edges': CONFIG.mutation.edges, tested_checks: impl.checks.filter(r => r.test && !r.unverified),
      mutate_command: `node ${MUTATE} --mutants ${RUN}/mutants.json --repo ${REPO} --head ${headNow} --dir ${RUN} --test ${sq(X.test)}${X.build ? ` --build ${sq(X.build)}` : ''} --timeout ${X.timeout || CONFIG.mutation.timeout}`,
    }]
  const res = await call('mutation', NO_CODE_PRE, `STAGE: mutation, HEAD {{HEAD}}. ${how}`, Object.assign({ HEAD: headNow }, values),
    contract(READ_ONLY, `applies: whether \`git diff --name-only ${BASE}..HEAD\` lists ${covers}. If it applies and did not run, ran is false and not_run the reason — never a pass.`,
      died('Where it applies, run every mutant')), { schema: MUTATION_SCHEMA, phase: 'Gates', label: 'mutation' })
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
