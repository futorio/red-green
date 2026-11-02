// Block fix: its schema, runFix and fixContract, and its inputs. Its only interface is the include order: it reads
// IMPLEMENT_SKILL, CODE_RULES, research, fixed, PRE, call, contract, writer, died, phase, and INPUTS, BLOCK_PATHS,
// STRING, INTEGER; it declares FIX_SCHEMA, grouped, runFix and fixContract for later parts.
// @part schema

const FIX_SCHEMA = { type: 'object', properties: {
  applied: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, what: { type: 'string' } }, required: ['id', 'what'] } },
  rejected: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, argument: { type: 'string' } }, required: ['id', 'argument'] } },
  proofs: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, path: { type: 'string' }, outcome: { type: 'string', enum: ['rewritten', 'deleted'] } }, required: ['id', 'path', 'outcome'] } },
  head: { type: 'string' },
}, required: ['applied', 'rejected', 'proofs', 'head'] }
// @part run
// Findings of any lens on one file and symbol are one item: its id joins theirs with +, each finding a view. A gate's
// or a requirement's finding names no symbol and stays alone.
const placeOf = f => f.where && typeof f.where === 'object' ? `${f.where.file}\n${f.where.symbol}` : f
function grouped(findings) {
  const at = new Map()
  findings.forEach(f => at.set(placeOf(f), (at.get(placeOf(f)) || []).concat(f)))
  return [...at.values()].map(fs => fs.length < 2 ? fs[0]
    : { id: fs.map(f => f.id).join('+'), where: fs[0].where, views: fs.map(({ id, source, where, ...view }) => Object.assign({ lens: source }, view)) })
}
// Fix answers an item once; its answer holds for each finding in it, under the finding's id.
const perFinding = (xs, items) => xs.flatMap(x => items.some(i => i.views && i.id === x.id) ? x.id.split('+').map(id => Object.assign({}, x, { id })) : [x])
async function runFix(round, toFix, label) {
  phase('Fix')
  const items = grouped(toFix)
  const res = await call('fix', PRE, 'fix', { round, IMPLEMENT_SKILL, code_rules: CODE_RULES, findings: items, research, fixed, earlier_fixes: fixed.length > 0 }, fixContract(
    'Commit your work as it stands.',
    items.some(i => i.views) && 'An item with `views` is the findings on one place, a view per lens: verify each view and answer the item once, by its id.',
    toFix.some(f => f.proof) && 'For a finding with a `proof`, run its `command` first: green on HEAD is a valid rejection ("proof green"); a red proof is rejected only with an argument against the test. Never leave a proof as written: rewrite it into the suite in its style and commit it, or delete it; report each in `proofs`.',
    orphanFiles().length && `Delete each of these proof files and report it in \`proofs\`, by the id before its path: ${orphanFiles().join(', ')}.`,
    fixed.length && 'A finding whose root cause appears in EARLIER FIXES twice already is not patched a third time: reject it with the argument "recurs after two fixes: needs a split or the user".'),
  { schema: FIX_SCHEMA, phase: 'Fix', label })
  return res && Object.assign(res, { applied: perFinding(res.applied, items), rejected: perFinding(res.rejected, items) })
}
// The contract part of fix: a writer that keeps its bar (COMMIT_RULE folds into the one commit), the
// block's rules, the head and proofs it reports.
const fixContract = (bar, ...rules) => contract(writer(bar), ...rules,
  'Report head: `git rev-parse HEAD` after your last change; proofs: [] when no finding has a proof and no proof file is listed.', died('Answer'))
// @part inputs
// Fix's inputs, and the path only it reads: each applied fix so far.
INPUTS.fix = ['round', 'IMPLEMENT_SKILL', 'code_rules', 'findings', 'fixed', 'earlier_fixes', 'research']
Object.assign(BLOCK_PATHS, { fixed: { type: 'array', items: { type: 'object', properties: { round: INTEGER, id: STRING, what: STRING }, required: ['round', 'id', 'what'] } } })
