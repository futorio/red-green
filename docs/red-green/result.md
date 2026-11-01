# Result

| field | holds |
|---|---|
| `status` | `done_with_failures` when `failures` is not empty, else `done_unverified` when `unverified` is, else `done` |
| `rounds_planned`, `rounds_run`, `rounds[]` | per iteration: major/minor counts, `gates` (the rows its lenses got), and `applied`, `rejected` of its closing fix, when it had one (attempts on a red gate are not counted) |
| `verdicts` | per lens: its verdict, `DIED` or `SILENT` ([`stages.md`](stages.md)) |
| `mutation` | `{mutants: [{id, target, file, line, patch, status}], counts}`, accumulated over every step, ids `M<round>-<i>`; null when no step reported mutants |
| `gates`, `research_questions`, `plan_questions`, `implement_questions` | the declared gates; open questions per stage |
| `uncovered_requirements`, `dropped_facts`, `unresearched_requirements`, `research_issues` | test ids no case covers; research repairs |
| `verify_launch` | `{requirement, how}` each: a notice for the operator, does not change `status` |
| `verify_review`, `unverified` | requirements checked by name; implement's list with its check rows folded in |
| `leftover_findings` | unfixed majors and survivors of the last iteration or a dead fix, each once (a survivor by its patch, any other by source, place and problem), and every requirement not `met` after the last iteration. Blocking: `severity: major` or `status: unmet` |
| `advisory` | the minors no fix applied, from any iteration, each once: a clean iteration's and a fix's rejected ones included |
| `stray_proofs` | `{id, path}` of unaccounted proofs |
| `implement`, `mailbox`, `failures` | `{checks, notes}`; every receipt with its agent label; every failure |

No findings does not mean reviewed: check `verdicts`.

A run that stops early returns `{status: 'failed', stage, note?, failures}`, with `research` and `cases` at stage
`implement`. `stage` is `config`, `gates` (a missing baseline), `research`, `plan` or `implement`.
