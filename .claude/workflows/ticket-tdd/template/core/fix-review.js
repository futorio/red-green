// Block fix review: fixReview, the review of the last round's fix diff.
// @part run

// The last round's fix, which no full round follows, is reviewed on its own diff: did it fix what it was given, did it break
// anything near it, did it weaken a test. Returns its findings, or null when the reviewer died.
let fixReviews = 0
async function fixReview(fromHead, given, label) {
  fixReviews += 1
  phase('Review')
  const res = await ask(`${NO_CODE_PRE}

STAGE: fix review, HEAD ${headNow}. A fix moved HEAD from ${fromHead}; no full review round follows it. Review its diff, \`git diff ${fromHead}..HEAD\`, and only that: (1) each finding it was given is fixed by the diff or rightly rejected; (2) the diff breaks nothing it touches — a sibling caller, another writer of the same state{{test_case_review.fix}}. ${READ_ONLY} The gates step checks this HEAD after you. ${TARGETED}
${SEVERITY}
${CHECKED('finding it was given (item = its id), then one per other thing you verified')}
GIVEN:
${JSON.stringify(given.map(f => ({ id: f.id, where: f.where, problem: f.problem })))}

RESEARCH:
${RESEARCH}`, { model: M.review, effort: 'high', schema: REVIEW_SCHEMA, phase: 'Review', label })
  if (!res) { failures.push(`fix review ${label}`); return null }
  const quiet = silence(res)
  if (quiet) failures.push(`fix review ${label} silent: ${quiet}`)
  verdicts.push({ round: label, lens: 'fix review', verdict: quiet ? 'SILENT' : res.verdict, count: res.findings.length })
  return tidy(res.findings).map((f, k) => proven(Object.assign({ id: `F${fixReviews}-${k + 1}`, source: 'fix review' }, f)))
}
