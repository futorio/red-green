// The orchestrator: args, the round loop, findings, failures and the result. render.mjs replaces each @include line
// with that part of a block file. docs/red-green/maintaining.md.
// @part main
export const meta = {
  name: 'red-green-workflow',
  description: 'Implement one ticket: research, TDD with coverage-checked test cases, review/fix loop',
  whenToUse: 'Implement per a ticket or spec path; project specifics come in args.profile. Launch with the start skill (skills/start/SKILL.md of the red-green repository)',
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
const IMPLEMENT_SKILL = `${TOOLS}/.claude/workflows/red-green/skills/implement.md`
const MUTATE = `${TOOLS}/.claude/workflows/red-green/skills/mutate.mjs`
const RUN_GATES = `${TOOLS}/.claude/workflows/red-green/skills/run_gates.mjs`
// The profile, its strings' {{base}}, {{run}}, {{repo}} and {{tools}} filled from args; any other {{...}} stays as
// given and is listed in UNFILLED as [where, placeholder, name] for the config check (docs/red-green/args-and-profile.md).
const RUN_VALUES = { base: BASE, run: RUN, repo: REPO, tools: TOOLS }
const UNFILLED = []
const fillRun = (v, at) => typeof v === 'string' ? v.replace(/\{\{([^{}]*)\}\}/g, (m, p) => Object.hasOwn(RUN_VALUES, p) ? RUN_VALUES[p] : (UNFILLED.push([at, m, p]), m))
  : Array.isArray(v) ? v.map((x, i) => fillRun(x, `${at}[${i}]`))
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillRun(x, `${at}.${k}`)])) : v
const P = fillRun(A.profile || {}, 'profile')
// Each block's default instructions, from template/defaults/<block>.md: {<block>: {<part>: text}} (docs/red-green/blocks.md).
const DEFAULTS = {{defaults}}
// @include shared text
// @include shared validate
// blocks.gates.gates: [{name, command, tier?}], set once the block config is merged, and those the gates step runs;
// args.baseline: {<gate name>: {status, line}} at base, for those it runs.
let GATES = []
let STAGE_GATES = []
const BASELINE = typeof A.baseline === 'object' && A.baseline || {}
// @include shared preamble
// @include mailbox ask
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
// @include mutation inputs
// @include fix inputs
// @include registry registry
// @include registry call
// @include shared config
// Each block's config: the render config's defaults, profile.blocks.<name> over them (docs/red-green/blocks.md).
const { merged: CONFIG, errors: configErrors } = mergeBlocks({{blocks}}, P.blocks, REGISTRY)
// A block with no model runs on the model of the block it follows.
const FOLLOWS = { plan: 'research' }
Object.entries(FOLLOWS).forEach(([b, leader]) => { CONFIG[b].model = CONFIG[b].model || CONFIG[leader].model })
// These args and profile fields moved into the block config; one still given fails the run instead of being ignored.
const MOVED = [[A, 'args', { models: 'profile.blocks.<name>.model', rounds: 'profile.blocks.review.rounds', extra_rounds: 'profile.blocks.review.rounds', min_rounds: 'profile.blocks.review.min' }],
  [P, 'profile', { research: 'profile.blocks.research.prompt as "{{default}}\\n<text>"', runtime: 'profile.blocks.review.runtime', gates: 'profile.blocks.gates.gates', mutation: 'profile.blocks.mutation' }],
  [Object(P.blocks), 'profile.blocks', { 'minor-fix': 'profile.blocks.fix: minors reach a fix with a major', 'fix-review': 'profile.blocks.review: the next iteration verifies each fix' }],
  [Object(Object(P.blocks).review), 'profile.blocks.review', { extra: 'profile.blocks.review.rounds' }]]
MOVED.forEach(([from, name, to]) => Object.keys(to).filter(k => k in from).forEach(k => configErrors.push(`${name}.${k} moved to ${to[k]}`)))
// A block prompt keeps its registry paths ({{default}} among them) for the call to fill; any other placeholder is an error.
UNFILLED.filter(([at, , p]) => !(/^profile\.blocks\.[^.]+\.prompt$/.test(at) && Object.hasOwn(REGISTRY, p)))
  .forEach(([at, m]) => configErrors.push(`${at}: unknown placeholder ${m}`))
Object.entries(CONFIG).filter(([, c]) => c.prompt && c.skill).forEach(([b]) => configErrors.push(`blocks.${b}: prompt or skill, not both`))
// Mutation runs on a test or a tool; with no blocks.mutation given the step is skipped.
if ((P.blocks || {}).mutation && !CONFIG.mutation.tool && !CONFIG.mutation.test) configErrors.push('blocks.mutation: neither test nor tool')
if (CONFIG.mutation.build && !CONFIG.mutation.test) configErrors.push('blocks.mutation: build without test')
if (CONFIG.mutation.tool && (CONFIG.mutation.test || CONFIG.mutation.build)) configErrors.push('blocks.mutation: tool, or build and test, not both')
if (CONFIG.review.rounds < 1) configErrors.push(`blocks.review.rounds: ${CONFIG.review.rounds} is below 1`)
if (CONFIG.review.min < 1) configErrors.push(`blocks.review.min: ${CONFIG.review.min} is below 1`)
if (CONFIG.review.min > CONFIG.review.rounds) configErrors.push(`blocks.review.min: ${CONFIG.review.min} is over rounds ${CONFIG.review.rounds}: set min too`)
// @include gates config
if (configErrors.length) return { status: 'failed', stage: 'config', note: configErrors.join('; '), failures: [] }
GATES = CONFIG.gates.gates
STAGE_GATES = GATES.filter(g => g.tier !== 'acceptance')
const failures = []
// Each gate the stage runs needs a baseline.
// @include gates baseline
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
const N = CONFIG.review.rounds
// A run reviews review.min rounds in full even when the first is clean: round 2 catches majors round 1 missed.
const MIN_ROUNDS = CONFIG.review.min
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

const advisory = []
const fixed = []
const history = []
const verdicts = []
const rounds = []
const status = {}
let unfixed = []
// The fixes since the last review: where the first started and what each did to its findings, for the next review.
let lastFix = null
// For each gate a fix rejected, the HEAD it was rejected at.
const gateRejected = {}
const FIX_ATTEMPTS = CONFIG.gates.fix_attempts
// What any fix leaves behind, whether an attempt on a red gate or the fix ending an iteration.
function settleFix(sent, fix, at) {
  const from = headNow
  const outcomes = sent.map(f => outcomeOf(f, fix))
  outcomes.forEach(o => history.push(Object.assign({ id: o.id, round }, o)))
  reconcile(sent.concat(orphans), fix)
  sent.filter(f => f.source === 'gates' && fix.rejected.some(r => r.id === f.id)).forEach(f => { gateRejected[f.where] = from })
  headNow = fix.head || headNow
  if (fix.applied.length && same(headNow, from)) failures.push(`applied with head unchanged at fix ${at}: ${fix.applied.map(a => a.id).join(', ')}`)
  lastFix = { from: lastFix ? lastFix.from : from, outcomes: (lastFix ? lastFix.outcomes : []).concat(outcomes) }
}
let round = 0
while (round < N) {
  round += 1
  if (!gated || !same(gated.head, headNow) || gated.gates.some(r => r.status === 'not_run')) gated = await runGates(`gates:r${round}`, round)
  // Attempts on a red gate: they cost no iteration, and this iteration's review covers them. Red always comes from the
  // latest rows, HEAD moved or not; a gate rejected at this HEAD gets no new attempt.
  const openGates = () => gated.found.filter(f => !same(gateRejected[f.where], headNow))
  let attempts = 0
  while (attempts < FIX_ATTEMPTS && openGates().length) {
    attempts += 1
    const at = `r${round}:a${attempts}`
    const fromHead = headNow
    const sent = openGates()
    const fix = await runFix(round, sent, `fix:${at}`)
    if (!fix) { failures.push(`fix ${at}`); break }
    settleFix(sent, fix, at)
    if (same(headNow, fromHead)) break
    gated = await runGates(`gates:${at}`, `${round}a${attempts}`)
  }
  phase('Review')
  const active = LENSES.filter(l => LENS_KEYS.includes(l.key))
// @include review call
  lastFix = null

  const found = gated.found.slice()
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
  const minors = found.filter(f => f.severity === 'minor')
  advisory.push(...minors)
  if (lensResults.every(r => !r)) log(`round ${round}: every lens died — this round was NOT reviewed`)
  const bySeverity = s => found.filter(f => f.severity === s).length
  rounds.push({ round, major: bySeverity('major'), minor: bySeverity('minor'), gates: gated.gates })
  log(`round ${round}: ${toFix.length} to fix`)

  if (!reviewed) log(`round ${round}: a lens died or came back silent — not a clean round`)
  if (!toFix.length && reviewed && round >= MIN_ROUNDS && !mutated) {
    toFix = await runMutation()
    if (toFix.length) log(`mutation: ${toFix.length} survivors`)
  }
  if (!toFix.length && reviewed && round >= MIN_ROUNDS) break
  // A fix needs a major or a survivor: minors alone wait for one, or stay advisory.
  if (!toFix.length) continue
  if (round === N) { unfixed = toFix; break }
  const sent = toFix.concat(minors)
  const fix = await runFix(round, sent, `fix:r${round}`)
  if (!fix) { failures.push(`fix r${round}`); unfixed = toFix; break }
  fixed.push(...fix.applied.map(a => Object.assign({ round }, a)))
  rounds[rounds.length - 1].applied = fix.applied.length
  rounds[rounds.length - 1].rejected = fix.rejected.length
  settleFix(sent, fix, `r${round}`)
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
// An unmet row's major (R<round>-R<n>) is left over as the row itself.
const rowMajor = f => /^R\d+-R\d+$/.test(f.id)

// @include proofs settle

// Freeing the run directory is the main thread's step after acceptance (skills/start/SKILL.md).
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
  verify_launch: plan.verify_launch,
  verify_review: plan.verify_review,
  leftover_findings: uniq(unfixed.filter(f => !rowMajor(f)).concat(unmet)),
  advisory: uniq(advisory.filter(f => !fixed.some(a => a.id === f.id))),
  stray_proofs: strayProofs,
  unverified: impl.unverified,
  implement: { checks: impl.checks, notes: impl.notes },
  mailbox,
  failures,
}
