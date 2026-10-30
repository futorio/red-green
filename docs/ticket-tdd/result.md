# Result

| field | holds |
|---|---|
| `status` | `done_with_failures` when `failures` is not empty, else `done_unverified` when `unverified` is, else `done` |
| `rounds_planned`, `rounds_run`, `rounds[]` | per round: major/minor counts, `applied`, `rejected`, `gates` (rows gating its HEAD), `recheck` (rows after the last fix) |
| `verdicts` | per lens: its verdict, `DIED` (API error, or a `<label> input:` failure) or `SILENT` (answered without evidence) |
| `mutation` | `{mutants: [{id, target, file, line, patch, status}], counts}`; null when the step did not apply or is absent |
| `gates`, `gates_questions`, `research_questions`, `plan_questions`, `implement_questions` | the gates used (discovered ones with source and baseline line); open questions per stage |
| `uncovered_requirements`, `dropped_facts`, `unresearched_requirements`, `research_issues` | test ids no case covers; research repairs |
| `verify_launch` | `{requirement, how}` each: a notice for the operator, does not change `status` |
| `verify_review`, `unverified` | requirements checked by name; implement's list with its check rows folded in |
| `leftover_findings`, `advisory` | unfixed findings, each once (a survivor by its patch, any other by source, place and problem), including every requirement not `met` after the last round; the minors |
| `minor_fixes`, `stray_proofs` | what the minor fix applied and rejected; `{id, path}` of unaccounted proofs |
| `implement`, `mailbox`, `failures` | `{checks, notes}`; every receipt with its agent label; every failure |

No findings does not mean reviewed: check `verdicts`.

A run that stops early returns `{status: 'failed', stage, note?, failures}`. `stage` is `config` (a removed arg or
profile field, or a block config that is unknown, off its schema or conflicting), `gates` or `gates:discover`,
`research`, `plan` or `implement`.
