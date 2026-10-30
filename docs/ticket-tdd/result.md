# Result

`{status, rounds_planned, rounds_run, rounds[] (major/minor, applied, rejected, `gates`: the rows of the gates step that gated the round's HEAD, `recheck`: those of the step after the last fix),
verdicts, mutation (`{mutants: [{id, target, file, line, patch, status}], counts}` by status, or null when the step did not apply or is absent),
gates (the gates used: declared, or discovered with their source and baseline line), gates_questions (the discovery step's questions; empty when the profile declared the gates),
uncovered_requirements (test ids no case covers), dropped_facts, unresearched_requirements, research_issues, research_questions, plan_questions, implement_questions, verify_launch (`{requirement, how}` each, a notice that does not change `status`), verify_review, unverified, leftover_findings, advisory, minor_fixes, stray_proofs (`{id, path}` of each proof no fix accounted for),
implement (`{checks, notes}`), mailbox (every receipt, with its agent label), failures}`. `status` is `done_with_failures`
when `failures` is not empty, else `done_unverified` when `unverified` (implement's list with its check rows folded in) is not empty,
else `done`. `leftover_findings` also holds every requirement not `met` after the last round; `leftover_findings` and `advisory` hold each finding once: a survivor by its patch, any other finding by source, place and problem, not by its positional id. A run that returns no findings has not necessarily been reviewed: a
lens killed by an API error reads as `DIED` in `verdicts`, one that answered without evidence as `SILENT`, one
whose input did not fill as `DIED` with a `<label> input:` entry in `failures`.

A run that stops early returns `{status: 'failed', stage, note?, failures}` with what it has: `stage` is `config`
(a moved arg or profile field, or a block config that is unknown, off its schema or conflicting, before any agent), `gates` or `gates:discover`, `research`, `plan` or
`implement`.
