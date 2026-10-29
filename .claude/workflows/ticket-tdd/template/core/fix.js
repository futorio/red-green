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
  return call('fix', PRE, 'fix', { round, IMPLEMENT_SKILL, code_rules: CODE_RULES, findings: toFix, research, fixed, earlier_fixes: fixed.length > 0 }, fixContract(
    'Commit only with every gate at its baseline or better. If a gate stays worse than its baseline, leave the change uncommitted, report `head` unchanged and reject every finding, naming each such gate in its `argument`.',
    toFix.some(f => f.proof) && 'For a finding with a `proof`, run its `command` first: green on HEAD is a valid rejection ("proof green"); a red proof is rejected only with an argument against the test. Never leave a proof as written: rewrite it into the suite in its style and commit it, or delete it; report each in `proofs`.',
    fixed.length && 'A finding whose root cause appears in EARLIER FIXES twice already is not patched a third time: reject it with the argument "recurs after two fixes: needs a split or the user".'),
  { schema: FIX_SCHEMA, phase: 'Fix', label })
}
// The contract part of fix and minor fix: a writer that keeps its bar (COMMIT_RULE folds into the one commit), the
// block's rules, the head and proofs it reports.
const fixContract = (bar, ...rules) => contract(writer(bar), ...rules,
  'Report head: `git rev-parse HEAD` after your last change; proofs: [] when no finding has a proof.', died('Answer'))
