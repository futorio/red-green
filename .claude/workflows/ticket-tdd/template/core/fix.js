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
  return call('fix', PRE, `STAGE: fix, round {{round}}. Read {{IMPLEMENT_SKILL}} and follow it, code rules included.{{code_rules}} For each finding: verify before you agree, verify before you disagree. A fix that does not fit the implementation is NOT applied: reject it with an argument that cites code, the ticket or the spec — it goes back to the reviewers. Never delete the thing a finding is about to silence it. Group the findings by root cause first and fix each cause once, not one finding at a time; for each cause, check whether the same failure can arrive by another path — a sibling caller, another writer of the same state — and close that path too. Re-run the gates.

FINDINGS:
{{findings}}
{{earlier_fixes}}
${RESEARCH_PART}`, {
    round, IMPLEMENT_SKILL, code_rules: CODE_RULES, findings: toFix, research,
    earlier_fixes: fixed.length ? `\nEARLIER FIXES:\n${JSON.stringify(fixed)}\n` : '',
  }, contract(writer('Commit only with the gate at its baseline or better.'),
    A.one_commit && 'Fold the change into the one commit with --amend, rewriting its message (create the commit if it does not exist yet and the gate is at baseline or better).',
    toFix.some(f => f.proof) && 'For a finding with a `proof`, run its `command` first: green on HEAD is a valid rejection ("proof green"); a red proof is rejected only with an argument against the test. Never leave a proof as written: rewrite it into the suite in its style and commit it, or delete it; report each in `proofs`.',
    fixed.length && 'A finding whose root cause appears in EARLIER FIXES twice already is not patched a third time: reject it with the argument "recurs after two fixes: needs a split or the user".',
    'Report head: `git rev-parse HEAD` after your last change.',
    'No answer counts as died: a failure, and the rounds stop.'), { schema: FIX_SCHEMA, phase: 'Fix', label })
}
