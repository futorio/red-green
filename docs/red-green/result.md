# Result

| field | holds |
|---|---|
| `status` | `done_with_failures` when `failures` is not empty, else `done_unverified` when `unverified` is, else `done` |
| `rounds_planned`, `rounds_run`, `rounds[]` | per iteration: major/minor counts (findings, not groups), `gates` (the rows its lenses got), and `applied`, `rejected` of its closing fix, when it had one (attempts on a red gate are not counted) |
| `verdicts` | per lens: its verdict, `DIED` or `SILENT` ([`stages.md`](stages.md)) |
| `gates`, `research_questions`, `plan_questions`, `implement_questions` | the declared gates; open questions per stage |
| `uncovered_requirements`, `dropped_facts`, `unresearched_requirements`, `research_issues` | test ids no case covers, a dropped property case's included; research repairs |
| `verify_launch` | `{requirement, how}` each: a notice for the operator, does not change `status` |
| `verify_review`, `unverified` | requirements checked by name; implement's list with its check rows folded in |
| `leftover_findings` | unfixed majors of the last iteration or a dead fix, each once (by source, place and problem), those on one file and symbol as one group `{id, where, views}` as fix gets them, and every requirement not `met` after the last iteration. Blocking: `severity: major` or `status: unmet` |
| `advisory` | the minors no fix applied, from any iteration, each once: a clean iteration's and a fix's rejected ones included |
| `stray_proofs` | `{id, path}` of unaccounted proofs |
| `implement`, `mailbox`, `failures` | `{checks, notes}`, a property case's row with its `contract` id; every receipt with its agent label; every failure |

No findings does not mean reviewed: check `verdicts`.

A run that stops early returns `{status: 'failed', stage, note?, failures}`, with `research` and `cases` at stage
`implement`. `stage` is `config`, `gates` (a missing baseline), `research`, `plan` or `implement`.
