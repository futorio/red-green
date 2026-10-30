# Stages

What the script enforces and decides at each stage. What an agent is told to do is in the block's default,
`.claude/workflows/ticket-tdd/template/defaults/<block>.md`. A block's inputs are its `INPUTS` entry in
`template/core/shared.js`; its config defaults are `template/default.json` (`blocks.md`).

"Died" is a call with no answer; it lands in `failures`. Each stage's questions go to the result as
`<stage>_questions`, not to later prompts; one naming no known requirement, gate or listed case is dropped.

| block | labels | output | invariants |
|---|---|---|---|
| `gates` | `gates:discover`, `gates:r<n>`, `gates:r<n>:recheck` | `DISCOVER_SCHEMA`, `GATES_SCHEMA` | read-only; discovery dead or empty: the run fails |
| `research` | `research`, `research:retry` | `RESEARCH_SCHEMA` | read-only; died: the run fails |
| `plan` | `plan`, `replan` | `casesSchema` | read-only; died: the run fails (replan: the previous cases stand) |
| `implement` | `implement`, `implement:retry` | `IMPL_SCHEMA` | writer; died: one retry, then the run fails |
| `review` | `review:r<n>:checklist`, `review:r<n>:code` | `reviewSchema` | read-only (the code lens may write uncommitted proofs) |
| `fix` | `fix:r<n>`, `fix:r<n>:review` | `FIX_SCHEMA` | writer; commits only with every gate at baseline or better; died: the rounds stop |
| `fix-review` | `review:fix:r<n>[:<pass>]` | `REVIEW_SCHEMA` | read-only; died: its findings stay `unverified` |
| `mutation` | `mutation` | `MUTATION_SCHEMA` | read-only |
| `minor-fix` | `fix:minor` | `FIX_SCHEMA` | writer; reverts when a gate got worse than before its edit |

## 0. Gates discovery

Only when `blocks.gates.gates` is absent. The returned gates become the profile's gates, each `line` its baseline. A
dead step, or one with no gate, ends the run as `failed` before research.

## 1. Research

The agent returns schema-forced JSON: `requirements`, `facts`, `plan`, `test_harness`, `questions`. The checks are code:

- Requirement lines start `R<n>: ` (schema); a repeated id renumbers them `R1..Rn`.
- A plan step over 600 characters gets one `research:retry` with the errors; a failed retry fails the run.
- Facts naming neither a listed id nor `general` are dropped (`dropped_facts`), and so is a `note` whose `$ command` is
  not one `rg`, `grep`, `git`, `find` or `ls` (`SEARCH`: no `;`, `&` or `|`).
- Requirements no fact cites go to `unresearched_requirements`; `test_harness` keeps the first entry per requirement.
- Repairs, and a requirement without a `test_harness` entry, go to `research_issues`, not `failures`.

The checked JSON is pasted into every later prompt, without the `R<n>: ` pattern and the 600-character limit; no stage
edits it.

## 2. Planning and the coverage check

A requirement's `test_harness` entry routes it: `test` to the planner (not called without one); `review`, `none` or no
entry to `verify_review`, which the checklist lens checks by name; `launch` to `verify_launch`, which no lens or gate
sees and the result lists with research's `how`. Cases cite only `test` ids.

**Coverage check:** every `test` requirement must be cited by a case, and no check (same assert after the same Arrange
and Act, case and whitespace folded) may sit in two cases. A miss sends the plan back once (`replan`) naming the
uncovered ids and duplicates; what is still uncovered goes to the result.

## 3. Implementation

Follows `skills/implement.md`, `skills/tdd/` and `profile.code_rules`. It commits as it stands, even with a gate worse
than baseline (the gates step turns it into a finding). `head` still at `base`: one more run, then `failed`.

- **Checks:** one row per case and per boundary phrase, each with a `test` or an `unverified` reason (schema). The
  script adds `case <id>: no check reported` per case without a row, and `<ref>: <reason>` per `unverified` row, to
  `unverified`; the checklist lens decides whether every phrase has a row.

## 4. Gates

One agent per HEAD, before the lenses, skipped when HEAD has not changed. It
returns `{name, status: green|red|not_run, line}` per declared gate. The script makes the findings: a `red` row is a
major `G<round>-<name>` (`G<round>r-<name>` after the last fix), its trigger the line against the baseline. A `not_run`
row, a declared gate with no row and a dead step land in `failures`. Lenses run no gate.

## 5. Review × n

Two lenses in parallel (`blocks.review.lenses`), given every earlier finding with its outcome; a rejected one is raised
again only with a `problem` that answers the fixer's `argument`.

- **Checklist lens:** one `checked` row per requirement id except `verify_launch` ones, `status`
  `met|unmet|unverified`; an id without a row is `unverified`. `unmet` becomes a major finding; `unverified` goes to
  `leftover_findings` and starts no round.
- **Severity:** the script turns a major with an empty `trigger` into a minor and keeps at most `blocks.review.minors`
  (2) minors per lens and per fix-diff review. Minors go to `advisory`: never sent to a round's fix, never holding a
  round open.
- **Silence is not clean:** `verdict` is `clean` exactly when `findings` is empty and no row is `unmet`. No rows, or a
  disagreeing verdict, reads as `SILENT` in `verdicts` and lands in `failures`. A dead or silent lens keeps the round
  from ending the loop.

## 6. Fix

A finding that does not fit is rejected with an argument citing code, the ticket or the spec, and returns next round.
When a gate stays worse the fix reverts, reports `head` unchanged and rejects every finding.

**Proofs.** A code-lens major may carry `proof: {path, command, red}`, an uncommitted test red on HEAD. Green on HEAD is
a valid rejection ("proof green"), a red proof only an argument against the test. Each is rewritten into the suite and
committed, or deleted, and reported in `proofs`. A stray is a proof on any other source's finding, a sent proof the fix
reports by neither id nor path, or one no fix was sent (its fix died, the run stopped): a row in `stray_proofs` and one
`failures` entry each at the end. A stray never skips the minor fix.

**Fix-diff review.** The last round's fix gets one reviewer on its own diff; what it still finds after one more fix is
left over as `unverified`. `blocks.review.extra` adds full rounds instead.

## 6a. Mutation

Once per run, after the first round that ends with no finding to fix (see Loop exit). Survivors get a fix, then one
more review round without the step, even past the planned rounds.

The generated form writes one patch per `checks` row with a test, plus at most `blocks.mutation.edges` (5);
`skills/mutate.mjs` runs each: a failing or timed-out `build` makes it `invalid`, a failing `test` kills it, a patch
that does not apply is `not_run`, the rest `survived`. The `{tool}` form returns the same records; the script derives
ids (`M-<n>`), `file:line` and counts.

- `applies` false: the step is skipped with a log line.
- `ran` false where it applies, a `not_run` mutant and a dead step land in `failures`; `invalid` ones are only counted.
- Every survivor is a major finding (`source: mutation`) sent to fix. No separate call rules on survivors.

## 6b. Minor fix

After the rounds and the mutation step; skipped with no minor finding or after a failed stage. It applies the cheap
advisory findings and rejects the rest (`minor_fixes`); no fix-diff review follows.

## Loop exit

```
loop:
  round += 1
  gates, if HEAD changed; then the lenses in parallel, given its rows
  findings = gates findings + review findings, minors set aside
  if no findings and every lens answered and round >= min(n, review.min):
    if the mutation step ran: break
    mutation step; no survivor: break
    findings = survivors; if round == n: n += 1
  if findings and round == n and review.extra rounds left: n += 1
  if findings: fix; a sent proof it does not report is a stray
  if round == n: fix-diff review of the fix (majors: one more fix and review, then leftover);
    gates once more if the fix moved HEAD (its red gates are leftover); break
after the loop: the mutation step once if it has not run (unless a fix died); survivors are leftover;
minor fix (deletes the proofs on minors); every proof no fix was sent is a stray; strays become failures
```
