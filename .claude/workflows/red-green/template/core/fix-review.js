// Block fix review: fixReview, the review of the last round's fix diff, and its inputs. Its only interface is the
// include order: it reads CONFIG, headNow, research, failures, verdicts, NO_CODE_PRE, READ_ONLY, TARGETED, SEVERITY,
// CHECKED, REVIEW_SCHEMA, call, contract, silence, tidy, proven, phase, and INPUTS, BLOCK_PATHS, STRING.
// @part run

// The last round's fix, which no full round follows, is reviewed on its own diff: did it fix what it was given, did it break
// anything near it, did it weaken a test. given: each finding the fix was sent, with its outcome (outcomeOf). Returns
// its findings, or null when the reviewer died.
let fixReviews = 0
async function fixReview(fromHead, given, label) {
  fixReviews += 1
  phase('Review')
  const res = await call('fix-review', NO_CODE_PRE, 'fix-review', {
    HEAD: headNow, from_head: fromHead, research, 'duty.test_case_review_fix': CONFIG.review.duties.test_case_review,
    given,
  }, contract(READ_ONLY, TARGETED, SEVERITY, CHECKED('finding it was given (item = its id), then one per other thing you verified')),
  { schema: REVIEW_SCHEMA, phase: 'Review', label })
  if (!res) { failures.push(`fix review ${label}`); return null }
  const quiet = silence(res)
  if (quiet) failures.push(`fix review ${label} silent: ${quiet}`)
  verdicts.push({ round: label, lens: 'fix review', verdict: quiet ? 'SILENT' : res.verdict, count: res.findings.length })
  return tidy(res.findings).map((f, k) => proven(Object.assign({ id: `F${fixReviews}-${k + 1}`, source: 'fix review' }, f)))
}
// @part inputs
// Fix review's inputs, and the path only it reads: each finding the fix was given, with its outcome.
INPUTS['fix-review'] = ['HEAD', 'from_head', 'duty.test_case_review_fix', 'given', 'research']
Object.assign(BLOCK_PATHS, { given: { type: 'array', items: { type: 'object', properties: { id: STRING, where: STRING, problem: STRING,
  outcome: { type: 'string', enum: ['fixed', 'rejected'] }, argument: STRING }, required: ['id', 'problem', 'outcome'] } } })
