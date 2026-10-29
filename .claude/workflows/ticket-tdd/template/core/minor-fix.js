// Block minor fix: the one cheap pass over minor findings after the rounds.
// @part run
// Cheap minor findings get one pass of a cheaper fixer after the rounds; the ones it does not apply stay advisory.
const cheap = uniq(advisory)
let minorFix = null
if (cheap.length && !failures.length) {
  phase('Fix')
  minorFix = await call('minor-fix', PRE, `STAGE: minor fixes. Read {{IMPLEMENT_SKILL}} and follow it, code rules included.{{code_rules}} Apply each finding below whose fix is cheap: a few lines in files this run already changed, no new test file, no change of design. Reject every other one with a one-line reason; it stays advisory. Verify before you agree; never delete the thing a finding is about to silence it. Re-run the gates; if any gate is worse than before your edit, revert your edits and reject them all.

FINDINGS:
{{findings}}`, { IMPLEMENT_SKILL, code_rules: CODE_RULES, findings: cheap }, contract(writer('Commit only with the gate at its baseline or better.'),
    A.one_commit && 'Fold the change into the one commit with --amend, rewriting its message.',
    cheap.some(f => f.proof) && 'Delete the file of every finding with a `proof`, applied or not, and report each in `proofs`.',
    'Report head: `git rev-parse HEAD` after your last change.',
    'No answer counts as died: a failure.'), { schema: FIX_SCHEMA, phase: 'Fix', label: 'fix:minor' })
  if (!minorFix) failures.push('fix minor')
  else reconcile(cheap, minorFix)
}
