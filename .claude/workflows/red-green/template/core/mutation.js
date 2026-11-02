// Block mutation: its schema and runMutation, generated mutants or the project's tool, and its inputs. Its only
// interface is the include order: it reads CONFIG, REPO, BASE, TARGET, same, RUN, MUTATE, headNow, impl, failures,
// NO_CODE_PRE, READ_ONLY, call, contract, died, log, phase, and INPUTS, BLOCK_PATHS, IMPL_SCHEMA; it sets mutation,
// mutationSkipped and
// declares runMutation for later parts, which reads round and gated when called.
// @part schema
// One record per mutant, from the runner or a project's own tool; the script derives ids, places and counts.
const MUTANT_STATUS = ['killed', 'survived', 'invalid', 'not_run']
const MUTATION_SCHEMA = { type: 'object', properties: {
  applies: { type: 'boolean' }, ran: { type: 'boolean' }, not_run: { type: 'string' },
  mutants: { type: 'array', items: { type: 'object', properties: {
    target: { type: 'string' }, patch: { type: 'string' }, status: { type: 'string', enum: MUTANT_STATUS } }, required: ['target', 'patch', 'status'] } },
}, required: ['applies', 'ran', 'mutants'] }
// @part run

// The mutation step runs once per iteration, between the gates and the review. Returns every survivor as a major for
// fix, which may reject it with an argument like any finding.
// A mutant's place: its file from the +++ side (the --- side for a deleted file), less any timestamp; its line from
// the HEAD side of its first hunk header.
const placeOf = patch => {
  const to = (/^\+\+\+ (?:b\/)?([^\t\n]*)/m.exec(patch) || [, ''])[1].trim()
  const from = (/^--- (?:a\/)?([^\t\n]*)/m.exec(patch) || [, ''])[1].trim()
  return { file: to && to !== '/dev/null' ? to : from, line: +(/^@@ -(\d+)/m.exec(patch) || [, 0])[1] }
}
const HEADERS = /^--- .*\n\+\+\+ .*\n@@ -\d+/m
// The headers a patch lacks, by name.
const missingHeaders = patch => [[/^--- /m, '---'], [/^\+\+\+ /m, '+++'], [/^@@ -\d+/m, '@@']].filter(([re]) => !re.test(patch)).map(([, h]) => h).join(', ') || 'its headers in order'
// The HEAD of the last step that ran or found nothing to cover; the first step covers the diff from base.
let mutatedHead = BASE
// Why the code since mutatedHead went unmutated with no failure: a red control run while a gate is known red.
let mutationSkipped = null
async function runMutation() {
  const { tool, test, build, edges, timeout } = CONFIG.mutation
  if (!tool && !test) { log('mutation: no blocks.mutation, step skipped'); return [] }
  // A gate with no result counts as red; a known_red one as green. A skipped step leaves its code for the next one.
  const blocked = gated.gates.filter(r => r.status === 'red' || r.status === 'not_run')
  if (blocked.length) { log(`mutation: ${blocked.map(r => `${r.name} ${r.status}`).join(', ')}, step skipped`); return [] }
  if (same(headNow, mutatedHead)) { log('mutation: HEAD already mutated, step skipped'); return [] }
  const from = mutatedHead
  phase('Gates')
  // The approach: the project's tool, or mutants generated against the checks and run by the runner.
  const [covers, part, values] = tool ? ['files the tool covers', 'tool', { 'config.tool': tool.replaceAll('{{mutate_from}}', from) }]
    : ['production source', 'generated', {
      from_head: from, TARGET, RUN, 'config.edges': edges, tested_checks: impl.checks.filter(r => r.test && !r.unverified),
      mutate_command: `node ${MUTATE} --mutants ${RUN}/mutants.json --repo ${REPO} --head ${headNow} --dir ${RUN} --test ${sq(test)}${build ? ` --build ${sq(build)}` : ''} --timeout ${timeout}`,
    }]
  const res = await call('mutation', NO_CODE_PRE, part, Object.assign({ HEAD: headNow }, values),
    contract(READ_ONLY, `applies: whether \`git diff --name-only ${from}..HEAD\` lists ${covers}; when it does not, ran is false and mutants []. If it applies and did not run, ran is false and not_run the reason — never a pass.`,
      died('Answer')), { schema: MUTATION_SCHEMA, phase: 'Gates', label: `mutation:r${round}` })
  if (!res) { failures.push('mutation'); return [] }
  if (!res.applies) { mutatedHead = headNow; log('mutation: no file it covers in the diff, step skipped'); return [] }
  // The runner refuses a red baseline: expected while a gate is known red, so no failure.
  // A reason given with ran true still means not run: an agent's word that the step left a gap is never a pass.
  const reason = (res.not_run || '').trim()
  // A reason with mutants is the agent's note on a run; with none, it says the run covered nothing.
  const notRun = !res.ran || (reason && !res.mutants.length)
  if (notRun && /control run/.test(reason) && gated.gates.some(r => r.status === 'known_red')) { mutationSkipped = reason; log(`mutation: ${reason}, step skipped`); return [] }
  if (notRun) failures.push(`mutation not run: ${reason || 'no reason given'}`)
  else { mutatedHead = headNow; mutationSkipped = null }
  // A survivor must name a file and a line; one whose patch cannot counts as not run.
  const mutants = res.mutants.map((m, i) => Object.assign({ id: `M${round}-${i + 1}`, target: m.target }, placeOf(m.patch), { patch: m.patch,
    status: m.status === 'survived' && !HEADERS.test(m.patch) ? 'not_run' : m.status }))
  mutants.forEach((m, i) => { if (m.status === 'not_run') failures.push(`mutation ${m.id} not run: ${m.target}${res.mutants[i].status === 'survived' ? `: patch lacks ${missingHeaders(m.patch)}` : ''}`) })
  const all = (mutation ? mutation.mutants : []).concat(mutants)
  const countsOf = list => Object.fromEntries(MUTANT_STATUS.map(s => [s, list.filter(m => m.status === s).length]))
  mutation = { mutants: all, counts: countsOf(all) }
  log(`mutation: ${JSON.stringify(countsOf(mutants))}`)
  return mutants.filter(m => m.status === 'survived').map(m => ({
    id: m.id, key: m.patch, source: 'mutation', severity: 'major', where: `${m.file}:${m.line}`,
    problem: `a mutant aimed at ${m.target} survives: no test fails on it`, trigger: m.patch,
    consequence: 'no test fails, so a defect of that shape ships unnoticed',
    fix: `make the test of ${m.target} fail on this mutant, or reject it with an argument that no test could tell it apart or that the code cannot run` }))
}
// @part inputs
// Mutation's inputs, and the path only it reads: implement's check rows with a test.
INPUTS.mutation = ['HEAD', 'from_head', 'TARGET', 'RUN', 'config.edges', 'mutate_command', 'tested_checks', 'config.tool']
Object.assign(BLOCK_PATHS, { tested_checks: { type: 'array', items: IMPL_SCHEMA.properties.checks.items } })
