// Block plan (and replan): the case and cases schemas, the plan call, the coverage and duplicate checks and the one replan.
// @part schema

const CASE = { type: 'object', properties: {
  id: { type: 'string' }, requirement: { type: 'string' }, title: { type: 'string' },
  arrange: { type: 'string' }, act: { type: 'string' }, asserts: { type: 'array', items: { type: 'string' } },
}, required: ['id', 'requirement', 'title', 'arrange', 'act', 'asserts'] }
// A case names its requirement by id, one of the ids the planner is given.
const casesSchema = ids => ({ type: 'object', properties: {
  cases: { type: 'array', items: Object.assign({}, CASE, { properties: Object.assign({}, CASE.properties, { requirement: { type: 'string', enum: ids } }) }) },
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
const PLAN_CONTRACT = contract(READ_ONLY, 'questions: every point the ticket and the research leave open that a case still depends on, one entry each: requirement (its id), question, reading (the one the cases take), cases (the ids of the cases that take it), settles (research: the repository holds the answer and the research does not give it; owner: the ticket and the spec leave it to their author). An empty list says nothing was left open.', died('Answer'))

// With no test requirement there is nothing to plan: no planner call, no cases.
let plan = !testIds.length ? { cases: [] } : await call('plan', NO_CODE_PRE, 'plan', { test_ids: testIds.join(', '), research }, PLAN_CONTRACT,
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
let cov = coverage(plan)
let dup = duplicates(plan)
if (cov.length || dup.length) {
  plan = await call('plan', NO_CODE_PRE, 'replan', {
    test_ids: testIds.join(', '), 'plan.cases': plan.cases, research,
    uncovered: cov, uncovered_note: cov.length > 0, duplicates: dup, duplicates_note: dup.length > 0,
  }, PLAN_CONTRACT, { schema: casesSchema(testIds), phase: 'Plan', label: 'replan' }) || plan
  cov = coverage(plan)
  dup = duplicates(plan)
}
plan.verify_review = checkIds.filter(id => !testIds.includes(id)).map(lineOf)
plan.verify_launch = reqIds.filter(id => !checkIds.includes(id)).map(id => ({ requirement: lineOf(id), how: harnessOf(id).how }))
// A question is kept only when a case takes its reading.
const questions = (plan.questions || []).filter(q => q.cases.some(id => plan.cases.some(c => c.id === id)))
const cases = plan.cases.map(c => Object.assign({}, c, { requirement: lineOf(idOf(c.requirement)) }))
log(`plan: ${cases.length} cases, ${cov.length} uncovered, ${dup.length} duplicate checks, ${questions.length} questions (${(plan.questions || []).length - questions.length} tied to no case), ${plan.verify_review.length} verify-by-review, ${plan.verify_launch.length} verify-by-launch`)
