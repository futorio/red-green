// Block fix: its schema and runFix.
// @part schema

const FIX_SCHEMA = { type: 'object', properties: {
  applied: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, what: { type: 'string' } }, required: ['id', 'what'] } },
  rejected: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, argument: { type: 'string' } }, required: ['id', 'argument'] } },
  proofs: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, path: { type: 'string' }, outcome: { type: 'string', enum: ['rewritten', 'deleted'] } }, required: ['id', 'path', 'outcome'] } },
  head: { type: 'string' },
}, required: ['applied', 'rejected', 'proofs', 'head'] }
// @part run
async function runFix(round, toFix, label) {
  phase('Fix')
  return call('fix', PRE, 'fix', {
    round, IMPLEMENT_SKILL, code_rules: CODE_RULES, findings: toFix, research,
    proof_note: note(toFix.some(f => f.proof)), fixed, earlier_fixes: note(fixed.length),
  }, fixContract(
    toFix.some(f => f.proof) && 'Never leave a proof as written: rewrite it into the suite in its style and commit it, or delete it; report each in `proofs`.'),
  { schema: FIX_SCHEMA, phase: 'Fix', label })
}
// The contract part of fix and minor fix: a writer that keeps the bar (COMMIT_RULE folds into the one commit), the
// block's rules, the head it reports.
const fixContract = (...rules) => contract(writer('Commit only with the gate at its baseline or better.'), ...rules,
  'Report head: `git rev-parse HEAD` after your last change.', died('Answer'))
