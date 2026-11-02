// Block plan (and replan): the case and cases schemas, the plan call, the coverage and duplicate checks, the one replan,
// and its inputs. Its only interface is the include order: it reads research, reqIds, failures, NO_CODE_PRE, READ_ONLY,
// call, contract, died, idOf, log, phase, CONTRACTS, and INPUTS, BLOCK_PATHS, STRING, LIST, INTEGER, OPTIONAL; it
// declares CASE, plan, testIds, checkIds, cov, questions and cases for later parts.
// @part schema

// A property case's contract (docs/red-green/stages.md): its statement's limit, the contract CLI's, is in the planner's
// schema alone, so a replan still takes an over-limit case back.
const property = statement => ({ type: 'object', properties: {
  id: { type: 'string' }, statement, source: { type: 'string' }, domain: { type: 'string' }, mut: { type: 'array', items: { type: 'string' } },
}, required: ['id', 'statement', 'source', 'domain', 'mut'] })
const CASE = { type: 'object', properties: {
  id: { type: 'string' }, requirement: { type: 'string' }, title: { type: 'string' },
  arrange: { type: 'string' }, act: { type: 'string' }, asserts: { type: 'array', items: { type: 'string' } },
  property: property({ type: 'string' }),
}, required: ['id', 'requirement', 'title', 'arrange', 'act', 'asserts'] }
// A case names its requirement by id, one of the ids the planner is given.
const casesSchema = ids => ({ type: 'object', properties: {
  cases: { type: 'array', items: Object.assign({}, CASE, { properties: Object.assign({}, CASE.properties, {
    requirement: { type: 'string', enum: ids }, property: property({ type: 'string', maxLength: CONTRACTS.LIMIT }) }) }) },
  questions: { type: 'array', items: { type: 'object', properties: {
    requirement: { type: 'string' }, question: { type: 'string' }, reading: { type: 'string' },
    cases: { type: 'array', items: { type: 'string' } }, settles: { type: 'string', enum: ['research', 'owner'] },
  }, required: ['requirement', 'question', 'reading', 'cases', 'settles'] } } }, required: ['cases', 'questions'] })
// @part call

phase('Plan')
// Research's test_harness routes each requirement: test gets cases; review, none and no entry go to the checklist lens
// alone; launch leaves the run, listed in the result with research's how.
const harnessOf = id => research.test_harness.find(h => idOf(h.requirement) === id) || { by: 'review' }
const lineOf = id => research.requirements.find(r => idOf(r) === id)
const testIds = reqIds.filter(id => harnessOf(id).by === 'test')
const checkIds = reqIds.filter(id => harnessOf(id).by !== 'launch')
// The property framework the project declares, or none: then property cases go through the contract CLI's run.
const FRAMEWORK = CONFIG.implement.property_framework
const frameworkValues = on => ({ property_framework: FRAMEWORK || undefined, property_framework_note: on && !!FRAMEWORK, property_runner_note: on && !FRAMEWORK })
// The property rule's statement limit and, for the runner, its domain forms, from the contract CLI.
const contractValues = { statement_limit: CONTRACTS.LIMIT, domain_forms: FRAMEWORK ? undefined : Object.values(CONTRACTS.KINDS).map(k => k[1]).join(', ') }
const PLAN_CONTRACT = contract(READ_ONLY, 'questions: every point the ticket and the research leave open that a case still depends on, one entry each; reading: the one the cases take; settles: research (the repository holds the answer and the research does not give it) or owner (the ticket and the spec leave it to their author). An empty list says nothing was left open.', died('Answer'))

// With no test requirement there is nothing to plan: no planner call, no cases.
let plan = !testIds.length ? { cases: [] } : await call('plan', NO_CODE_PRE, 'plan', Object.assign({ test_ids: testIds.join(', '), research }, frameworkValues(true), contractValues), PLAN_CONTRACT,
  { schema: casesSchema(testIds), phase: 'Plan', label: 'plan' })
if (!plan) return { status: 'failed', stage: 'plan', failures }
// @part replan

// Coverage: every test requirement is cited by at least one case.
const coverage = p => testIds.filter(id => !p.cases.some(c => idOf(c.requirement) === id))
// Duplicates: the same check after the same Arrange and Act in two cases (case and whitespace folded).
const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim()
function duplicates(p) {
  const seen = {}
  p.cases.forEach(c => c.asserts.forEach(a => { const k = `${norm(c.arrange)} | ${norm(c.act)} | ${norm(a)}`; (seen[k] = seen[k] || new Set()).add(c.id) }))
  return Object.entries(seen).filter(([, ids]) => ids.size > 1).map(([check, ids]) => ({ check, cases: [...ids] }))
}
// A property's source is a requirement id or a listed fact's where, any one of its locations. Its id, statement and,
// with no framework, domain are what the contract CLI accepts in a marker; its mut names at least one wrong output.
const SOURCES = new Set(reqIds.concat(research.facts.flatMap(f => [].concat(f.where))))
const domainError = d => { try { CONTRACTS.compile(JSON.parse(d)); return null } catch (e) { return e.message } }
const issuesOf = c => {
  if (!c.property) return []
  const { id, statement, source, domain, mut } = c.property, rejected = !FRAMEWORK && domainError(domain)
  return [
    !CONTRACTS.ID.test(id) && `id ${JSON.stringify(id)} is not a contract id, dot-separated segments of letters, digits, _ and -`,
    [...statement].length > CONTRACTS.LIMIT && `statement over ${CONTRACTS.LIMIT} characters: split it into flat contracts sharing an id prefix, one case each`,
    /[\r\n]/.test(statement) && 'statement holds a line break; a marker is one line',
    !SOURCES.has(source) && `source ${JSON.stringify(source)} is neither a requirement id nor a listed fact's \`where\``,
    rejected && `domain ${JSON.stringify(domain)} is one the runner rejects: ${rejected}`,
    !mut.length && 'mut is empty',
  ].filter(Boolean).map(e => `${c.id}: ${e}`)
}
let cov = coverage(plan)
let dup = duplicates(plan)
let issues = new Map(plan.cases.map(c => [c, issuesOf(c)]).filter(([, e]) => e.length))
if (cov.length || dup.length || issues.size) {
  log(`plan: replan: uncovered ${cov.join(', ') || 'none'}; duplicate checks in ${[...new Set(dup.flatMap(d => d.cases))].join(', ') || 'none'}${issues.size ? `; property cases failing their checks: ${[...issues.keys()].map(c => c.id).join(', ')}` : ''}`)
  plan = await call('plan', NO_CODE_PRE, 'replan', Object.assign({
    test_ids: testIds.join(', '), 'plan.cases': plan.cases, research,
    uncovered: cov, uncovered_note: cov.length > 0, duplicates: dup, duplicates_note: dup.length > 0, property_issues: [...issues.values()].flat(), property_issues_note: issues.size > 0,
  }, frameworkValues(true), contractValues), PLAN_CONTRACT, { schema: casesSchema(testIds), phase: 'Plan', label: 'replan' }) || plan
  // A property case still failing its checks is dropped; what that leaves uncovered is reported with the rest.
  issues = new Map(plan.cases.map(c => [c, issuesOf(c)]).filter(([, e]) => e.length))
  issues.forEach(e => log(`plan: dropped ${e.join('; ')}`))
  plan.cases = plan.cases.filter(c => !issues.has(c))
  cov = coverage(plan)
  dup = duplicates(plan)
}
plan.verify_review = checkIds.filter(id => !testIds.includes(id)).map(lineOf)
plan.verify_launch = reqIds.filter(id => !checkIds.includes(id)).map(id => ({ requirement: lineOf(id), how: harnessOf(id).how }))
// A question is kept only when a case takes its reading.
const questions = (plan.questions || []).filter(q => q.cases.some(id => plan.cases.some(c => c.id === id)))
const cases = plan.cases.map(c => Object.assign({}, c, { requirement: lineOf(idOf(c.requirement)) }))
log(`plan: ${cases.length} cases, ${cov.length} uncovered, ${dup.length} duplicate checks, ${questions.length} questions (${(plan.questions || []).length - questions.length} tied to no case), ${plan.verify_review.length} verify-by-review, ${plan.verify_launch.length} verify-by-launch`)
// @part inputs
// Plan's and replan's inputs, and the paths only they read: the uncovered test ids, checks in several cases, the
// planner's own cases, the property cases failing their checks.
INPUTS.plan = ['test_ids', 'statement_limit', 'domain_forms', 'property_framework', 'property_framework_note', 'property_runner_note', 'uncovered', 'uncovered_note', 'duplicates', 'duplicates_note', 'property_issues', 'property_issues_note', 'plan.cases', 'research']
Object.assign(BLOCK_PATHS, {
  uncovered: LIST, property_issues: LIST, statement_limit: INTEGER, domain_forms: OPTIONAL,
  duplicates: { type: 'array', items: { type: 'object', properties: { check: STRING, cases: LIST }, required: ['check', 'cases'] } },
  'plan.cases': { type: 'array', items: CASE },
})
