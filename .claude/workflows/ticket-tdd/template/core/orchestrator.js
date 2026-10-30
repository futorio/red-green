// The orchestrator: args, the round loop, findings, failures and the result. render.mjs replaces each @include line
// with that part of a block file. docs/ticket-tdd/maintaining.md.
// @part main
export const meta = {
  name: 'ticket-tdd',
  description: 'Implement one ticket: research, TDD with coverage-checked test cases, review/fix loop',
  whenToUse: 'Implement per a ticket or spec path; project specifics come in args.profile. See docs/ticket-tdd/README.md',
  phases: [
    { title: 'Research' },
    { title: 'Plan' },
    { title: 'Implement' },
    { title: 'Gates' },
    { title: 'Review' },
    { title: 'Fix' },
  ],
}

const A = args || {}
const REPO = A.repo
const BRANCH = A.branch
const TOOLS = A.tools
const RUN = A.run
const BASE = A.base
const TARGET = A.target
const IMPLEMENT_SKILL = `${TOOLS}/.claude/workflows/ticket-tdd/skills/implement.md`
const MUTATE = `${TOOLS}/.claude/workflows/ticket-tdd/skills/mutate.mjs`
const P = A.profile || {}
// Each block's default instructions, from template/defaults/<block>.md: {<block>: {<part>: text}} (docs/ticket-tdd/blocks.md).
const DEFAULTS = {{defaults}}
// @include shared text
// @include shared validate
// blocks.gates.gates: [{name, command}], set once the block config is merged; args.baseline: {<gate name>: its summary
// line at base}.
let GATES = []
let BASELINE = typeof A.baseline === 'object' && A.baseline || {}
// @include shared preamble
// @include mailbox ask
// @include gates discover-schema
// @include research schema
// @include plan schema
// @include implement schema
// @include review schema
// @include mutation schema
// @include fix schema
// @include registry types
// @include research inputs
// @include plan inputs
// @include implement inputs
// @include gates inputs
// @include review inputs
// @include fix-review inputs
// @include mutation inputs
// @include fix inputs
// @include minor-fix inputs
// @include registry registry
// @include registry call
// @include shared config
// Each block's config: the render config's defaults, profile.blocks.<name> over them (docs/ticket-tdd/blocks.md).
const { merged: CONFIG, errors: configErrors } = mergeBlocks({{blocks}}, P.blocks, REGISTRY)
// A block with no model runs on the model of the block it follows.
const FOLLOWS = { plan: 'research', fix: 'implement', 'fix-review': 'review', 'minor-fix': 'fix' }
Object.entries(FOLLOWS).forEach(([b, leader]) => { CONFIG[b].model = CONFIG[b].model || CONFIG[leader].model })
// These args and profile fields moved into the block config; one still given fails the run instead of being ignored.
const MOVED = [[A, 'args', { models: 'profile.blocks.<name>.model', rounds: 'profile.blocks.review.rounds', extra_rounds: 'profile.blocks.review.extra', min_rounds: 'profile.blocks.review.min' }],
  [P, 'profile', { research: 'profile.blocks.research.prompt as "{{default}}\\n<text>"', runtime: 'profile.blocks.review.runtime', gates: 'profile.blocks.gates.gates', mutation: 'profile.blocks.mutation' }]]
MOVED.forEach(([from, name, to]) => Object.keys(to).filter(k => k in from).forEach(k => configErrors.push(`${name}.${k} moved to ${to[k]}`)))
Object.entries(CONFIG).filter(([, c]) => c.prompt && c.skill).forEach(([b]) => configErrors.push(`blocks.${b}: prompt or skill, not both`))
// Mutation runs on a test or a tool; with no blocks.mutation given the step is skipped.
if ((P.blocks || {}).mutation && !CONFIG.mutation.tool && !CONFIG.mutation.test) configErrors.push('blocks.mutation: neither test nor tool')
if (CONFIG.mutation.build && !CONFIG.mutation.test) configErrors.push('blocks.mutation: build without test')
if (CONFIG.mutation.tool && (CONFIG.mutation.test || CONFIG.mutation.build)) configErrors.push('blocks.mutation: tool, or build and test, not both')
if (configErrors.length) return { status: 'failed', stage: 'config', note: configErrors.join('; '), failures: [] }
GATES = CONFIG.gates.gates || []
// Full rounds added when the last planned round has majors to fix; by default the fix-diff review sees the fix instead.
let EXTRA = CONFIG.review.extra
const failures = []
// Declared gates need a baseline each; with none declared, the discovery step finds them and measures the baseline.
// Its questions go to the result alone.
let gatesQuestions = []
// @include gates discover
// @include shared code-preamble
// @include gates schema
// @include review rules
// @include shared id
function silence(res, ids) {
  if (!res.checked.length) return 'no checked rows'
  // An unmet checklist row is a finding by itself.
  const unmet = res.checked.some(c => c.status === 'unmet')
  if ((res.verdict === 'clean') !== !(res.findings.length || unmet)) return `verdict ${res.verdict} with ${res.findings.length} findings${unmet ? ' and an unmet row' : ''}`
  const seen = new Set(res.checked.map(c => idOf(c.item)))
  const missing = (ids || []).filter(i => !seen.has(i))
  return missing.length ? `not checked: ${missing.join(', ')}` : null
}
// A major with no trigger is a minor; a lens keeps at most review.minors minors.
function tidy(findings) {
  let minors = 0
  const out = findings.map(f => f.severity !== 'minor' && !(f.trigger || '').trim() ? Object.assign({}, f, { severity: 'minor', downgraded: true }) : f)
  const kept = out.filter(f => f.severity !== 'minor' || ++minors <= CONFIG.review.minors)
  const down = out.filter(f => f.downgraded).length
  if (down || kept.length < out.length) log(`findings tidied: ${down} downgraded for no trigger, ${out.length - kept.length} minors dropped`)
  return kept
}
// @include proofs track
// A finding a fix was sent, with what the fix did to it: fixed, or rejected with its argument (none given: rejected).
const outcomeOf = (f, res) => {
  const r = res.rejected.find(x => x.id === f.id)
  return Object.assign({ id: f.id, where: f.where, problem: f.problem, outcome: res.applied.some(a => a.id === f.id) ? 'fixed' : 'rejected' }, r && { argument: r.argument })
}


// @include research call
// @include research checks
let N = CONFIG.review.rounds
// A run reviews review.min rounds in full even when the first is clean: round 2 catches majors round 1 missed.
const MIN_ROUNDS = Math.min(N, CONFIG.review.min)
const LENS_KEYS = CONFIG.review.lenses
log(`research: ${research.requirements.length} requirements, ${droppedFacts.length} facts dropped, ${unresearched.length} unresearched -> ${N} review rounds, lenses ${LENS_KEYS.join(' + ')}`)
// @include plan call
// @include plan replan
// @include implement call

let mutation = null

// The gates step runs once per HEAD, before the lenses, which get its lines. HEAD moves only when implement or a fix commits.
let headNow = impl.head
let gated = null
// @include gates run
// @include mutation run
// @include fix run
// @include fix-review run

let rejections = []
const advisory = []
const fixed = []
const history = []
const verdicts = []
const rounds = []
const status = {}
let unfixed = []
let round = 0
while (round < N) {
  round += 1
  const fresh = !gated || !same(gated.head, headNow)
  const gatesStep = async () => {
    if (!fresh) return gated
    return runGates(round, `gates:r${round}`)
  }
  phase('Review')
  let fromHead = headNow
  const active = LENSES.filter(l => LENS_KEYS.includes(l.key))
  gated = await gatesStep()
// @include review call

  const found = fresh ? gated.found.slice() : []
  let reviewed = true
  lensResults.forEach((res, i) => {
    const l = active[i]
    if (!res) { failures.push(`review r${round} ${l.key}`); verdicts.push({ round, lens: l.key, verdict: 'DIED' }); reviewed = false; return }
    const quiet = silence(res)
    if (quiet) { failures.push(`review r${round} ${l.key} silent: ${quiet}`); reviewed = false }
    verdicts.push({ round, lens: l.key, verdict: quiet ? 'SILENT' : res.verdict, count: res.findings.length })
    if (l.key === 'checklist') {
      const rows = {}
      res.checked.forEach(c => { rows[idOf(c.item)] = c })
      checkIds.forEach(id => { status[id] = rows[id] ? { status: rows[id].status, promise: rows[id].promise, counterexample: rows[id].counterexample, evidence: rows[id].evidence } : { status: 'unverified', evidence: 'no checked row' } })
      // unmet is fixed like any major; unverified only goes to the leftover list at the end.
      checkIds.filter(id => status[id].status === 'unmet').forEach(id => found.push({ id: `R${round}-${id}`, source: 'checklist', severity: 'major',
        where: research.requirements.find(r => idOf(r) === id), problem: `${status[id].promise} — ${status[id].evidence}`, trigger: status[id].counterexample,
        consequence: 'the statement\'s promise is not met', fix: 'keep the promise' }))
    }
    found.push(...tidy(res.findings).map((f, k) => proven(Object.assign({ id: `R${round}-${l.key}-${k + 1}`, source: l.key }, f))))
  })
  let toFix = found.filter(f => f.severity !== 'minor')
  advisory.push(...found.filter(f => f.severity === 'minor'))
  if (lensResults.every(r => !r)) log(`round ${round}: every lens died — this round was NOT reviewed`)
  const bySeverity = s => found.filter(f => f.severity === s).length
  rounds.push({ round, major: bySeverity('major'), minor: bySeverity('minor'), gates: gated.gates })
  log(`round ${round}: ${toFix.length} to fix`)

  if (!reviewed) log(`round ${round}: a lens died or came back silent — not a clean round`)
  if (!toFix.length && reviewed && round >= MIN_ROUNDS) {
    if (mutated) break
    toFix = await runMutation()
    if (!toFix.length) break
    // Survivors get a fix and one more review round, without the step.
    log(`mutation: ${toFix.length} survivors to fix`)
    if (round === N) N += 1
  }
  if (toFix.length && round === N && EXTRA > 0) {
    EXTRA -= 1
    N += 1
    log(`round ${round}: ${toFix.length} to fix in the last round, one more round reviews the fix`)
  }
  let fix = null
  if (toFix.length) {
    fromHead = headNow
    fix = await runFix(round, toFix, `fix:r${round}`)
    if (!fix) { failures.push(`fix r${round}`); unfixed = toFix; break }
    fixed.push(...fix.applied.map(a => Object.assign({ round }, a)))
    rounds[rounds.length - 1].applied = fix.applied.length
    rounds[rounds.length - 1].rejected = fix.rejected.length
    rejections = fix.rejected.map(r => Object.assign({}, toFix.find(f => f.id === r.id) || { id: r.id }, { argument: r.argument }))
    toFix.forEach(f => history.push(Object.assign({ id: f.id, round }, outcomeOf(f, fix))))
    reconcile(toFix, fix)
    headNow = fix.head || headNow
  }
  if (round === N) {
    unfixed = rejections.slice()
    // The last round's fix gets a fix-diff review; its majors get one more fix and review, then are left over.
    if (toFix.length && !same(headNow, fromHead)) {
      let from = fromHead
      let given = toFix
      let by = fix
      for (let pass = 0; ; pass++) {
        const late = await fixReview(from, given.map(f => outcomeOf(f, by)), `review:fix:r${round}${pass ? `:${pass}` : ''}`)
        if (!late) {
          unfixed.push(...given.map(f => Object.assign({}, f, { status: 'unverified', problem: `fixed in the last round, its review died: ${f.problem}` })))
          break
        }
        advisory.push(...late.filter(f => f.severity === 'minor'))
        const majors = late.filter(f => f.severity !== 'minor')
        if (!majors.length) break
        if (pass >= 1) { unfixed.push(...majors.map(f => Object.assign({}, f, { status: 'unverified' }))); break }
        from = headNow
        const again = await runFix(round, majors, `fix:r${round}:review`)
        if (!again) { failures.push(`fix r${round} review`); unfixed.push(...majors); break }
        fixed.push(...again.applied.map(a => Object.assign({ round }, a)))
        headNow = again.head || headNow
        given = majors
        by = again
      }
    }
    if (!same(headNow, gated.head)) {
      // The last fix moved HEAD and no review follows: the gates step checks it.
      gated = await runGates(round, `gates:r${round}:recheck`, 'r')
      rounds[rounds.length - 1].recheck = gated.gates
      unfixed.push(...gated.found)
    }
  }
}
// A run that used up its rounds without a clean one still gets its one mutation run; its survivors are left over.
if (!mutated && !failures.some(f => f.startsWith('fix '))) unfixed.push(...await runMutation())
// A finding is the same finding by what it says, not by its positional id: a survivor by its patch,
// any other by source, place and problem (a rejection without a place by its id).
const sameKey = f => f.key || (f.where ? `${f.source}|${f.where}|${f.problem}` : f.id)
const uniq = xs => xs.filter((x, i) => xs.findIndex(y => sameKey(y) === sameKey(x)) === i)
const unmet = checkIds.filter(id => !status[id] || status[id].status !== 'met').map(id => ({
  id, source: 'checklist', where: research.requirements.find(r => idOf(r) === id), status: status[id] ? status[id].status : 'unverified',
  problem: status[id] ? status[id].evidence : 'the checklist lens never answered' }))

// @include minor-fix run
// @include proofs settle
const minorApplied = f => !!minorFix && minorFix.applied.some(a => a.id === f.id)

// Freeing the run directory is the main thread's step after acceptance (docs/ticket-tdd/README.md).
return {
  status: failures.length ? 'done_with_failures' : impl.unverified.length ? 'done_unverified' : 'done',
  rounds_planned: N,
  rounds_run: round,
  rounds,
  verdicts,
  mutation,
  uncovered_requirements: cov,
  dropped_facts: droppedFacts,
  unresearched_requirements: unresearched,
  plan_questions: questions,
  research_issues: researchIssues,
  research_questions: researchQuestions,
  implement_questions: implementQuestions,
  gates: GATES,
  gates_questions: gatesQuestions,
  verify_launch: plan.verify_launch,
  verify_review: plan.verify_review,
  leftover_findings: uniq(unfixed.concat(unmet)),
  advisory: uniq(advisory).filter(f => !minorApplied(f)),
  minor_fixes: minorFix && { applied: minorFix.applied, rejected: minorFix.rejected },
  stray_proofs: strayProofs,
  unverified: impl.unverified,
  implement: { checks: impl.checks, notes: impl.notes },
  mailbox,
  failures,
}
