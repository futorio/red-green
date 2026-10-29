// Block minor fix: the one cheap pass over minor findings after the rounds.
// @part run
// Cheap minor findings get one pass of a cheaper fixer after the rounds; the ones it does not apply stay advisory.
const cheap = uniq(advisory)
let minorFix = null
if (cheap.length && !failures.length) {
  phase('Fix')
  minorFix = await call('minor-fix', PRE, 'minor-fix', { IMPLEMENT_SKILL, code_rules: CODE_RULES, findings: cheap }, fixContract('Commit only with no gate worse than before your edit.',
    cheap.some(f => f.proof) && 'Delete the file of every finding with a `proof`, applied or not, and report each in `proofs`.'), { schema: FIX_SCHEMA, phase: 'Fix', label: 'fix:minor' })
  if (!minorFix) failures.push('fix minor')
  else reconcile(cheap, minorFix)
}
