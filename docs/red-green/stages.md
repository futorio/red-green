# Stages

What the script enforces and decides at each stage. What an agent is told to do is in the block's default,
`.claude/workflows/red-green/template/defaults/<block>.md`; a block's inputs and config are in [`blocks.md`](blocks.md).
The output schemas are in `template/core/<block>.js`.

A run takes one path:

```text
research -> plan -> implement
  -> iteration x blocks.review.rounds:
       gates <-> fix (a red gate, up to blocks.gates.fix_attempts)
       review
       clean and round >= blocks.review.min: leave the loop
       fix (not in the last iteration)
```

Acceptance follows, in the main thread ([`/red-green:start`](../../skills/start/SKILL.md)). A run makes no mutants:
mutation runs by hand, with [`skills/mutate.mjs`](args-and-profile.md#by-hand-mutation).

"Died" is a call with no answer. It lands in `failures`, or ends the run (`status: failed`) where the table says so.
Each stage's questions go to the result as `<stage>_questions`, not to later prompts; one naming no known requirement
or listed case is dropped.

Labels are unique, since the core's stub tests key on them.

| block | labels | invariants |
|---|---|---|
| `research` | `research`, `research:retry` | read-only; died: the run fails |
| `plan` | `plan`, `replan` | read-only; died: the run fails (replan: the previous cases stand) |
| `implement` | `implement`, `implement:retry` | writer; died: one retry, then the run fails |
| `gates` | `gates:r<n>`, `gates:r<n>:a<k>`, either with `:retry` | read-only; only runs the gate runner; no result: one retry, then `failures` |
| `review` | `review:r<n>:checklist`, `review:r<n>:code` | read-only (the code lens may write uncommitted proofs, except in the last iteration) |
| `fix` | `fix:r<n>`, `fix:r<n>:a<k>` | writer; died: `failures`, and an iteration's fix ends the loop |

`r<n>` is the iteration, `a<k>` an attempt on a red gate within it.

## Gate runner

[`skills/run_gates.mjs`](../../.claude/workflows/red-green/skills/run_gates.mjs) owns gate execution for the writers, the
gates stage, the baseline and acceptance. It runs from the worktree:

```
node run_gates.mjs --gates <json> --dir <run dir> [--tier fast|round|acceptance] [--baseline <json>] [--no-cache] [--wait <s>] [--timeout <s>]
```

- **Tiers** are cumulative, `round` by default: `fast` runs fast gates, `round` fast and round gates, `acceptance` all.
- **A row per gate**, one JSON line: `name`, `status`, `line`, `log`, `seconds`, `cached`. The exit code decides `status`:
  `green` or `red`, `not_run` when a signal or the timeout ended the gate. A gate red in the given baseline is `known_red`: run, reported,
  not blocking. `line` is the last non-empty line of its output, or `(no output)`; `log` its full output, under `--dir`.
- **Exit codes:** 0 the report is complete, whatever the gates did; 2 it could not run or the tier selects no gate, stderr
  says why; 3 gates are still running, call again. One call waits 540 seconds by default.
- **Timeout:** a gate past `--timeout` (7200 seconds by default) has its process group killed; its `line` says so.
- **Detached, one lock per worktree:** the gates run in a detached process and outlive the call. A second call waits for
  the running one and starts nothing of its own; a dead holder's lock is taken over once its gate has ended or passed its
  timeout.
- **Cache:** per gate under `--dir`, keyed on its command, HEAD and the tree of tracked and untracked non-ignored files, so
  a retry on the same tree picks up finished gates. Only the gates stage uses it; writers, the baseline and acceptance pass
  `--no-cache`. `--dir` must be outside the tree or ignored, or its logs change the key.

## Research

The agent returns schema-forced JSON: `requirements`, `facts`, `plan`, `test_harness`, `questions`. The checks are code:

- Requirement lines start `R<n>: ` (schema); a repeated id renumbers them `R1..Rn`.
- A plan step over 600 characters gets one `research:retry` with the errors; a failed retry fails the run.
- Facts naming neither a listed id nor `general` are dropped (`dropped_facts`), and so is a `note` whose `$ command` is
  not one `rg`, `grep`, `git`, `find` or `ls` (`SEARCH`: no `;`, `&` or `|`).
- Requirements no fact cites go to `unresearched_requirements`; `test_harness` keeps the first entry per requirement and drops one naming an unknown id.
- Repairs, and a requirement without a `test_harness` entry, go to `research_issues`, not `failures`.

The checked JSON is pasted into every later prompt.

## Planning and the coverage check

A requirement's `test_harness` entry routes it: `test` to the planner (not called without one); `review`, `none` or no
entry to `verify_review`, which the checklist lens checks by name; `launch` to `verify_launch`, which no lens or gate
sees and the result lists with research's `how`. Cases cite only `test` ids.

**Coverage check:** every `test` requirement must be cited by a case, and no check (same assert after the same Arrange
and Act, case and whitespace folded) may sit in two cases. A miss sends the plan back once (`replan`) naming the
uncovered ids and duplicates; what is still uncovered goes to the result.

**Property cases:** a claim over a domain too large to enumerate may get a property case; a small finite domain is one
case with a table of literal rows. Its optional `property` holds the property contract: `id`, `statement` (255 characters
at most), `source`, `domain` (JSON in `run`'s domain language with no `blocks.implement.property_framework`, else text
for the framework; a domain `run` cannot state keeps the case literal) and `mut`, one wrong output per input the
statement names. Its Act runs over the domain and its asserts hold the property and the rejection of each `mut`, the
one exception to one Act and single literals. It may go through a lower seam than `how` names when that one costs too
much per example, saying so; a literal case keeps the named seam. The script accepts as `source` only a requirement id
or a listed fact's `where` (any one location of a list). A bad source or an over-limit statement joins the replan's
reasons, the latter told to split into flat property contracts sharing an id prefix; a case still failing after the
replan is dropped (logged), and what it leaves uncovered goes to `uncovered_requirements`. Research does not change.

**Limit on tests:** plan's rules and the code lens hold one list, the `plan` default's `limit` part. Worth testing:
requirement behaviour, invariant, boundary, error, regression. Banned: doc and message wording, constants, private
structure, the framework, getters, mock checks; an exact message only when a requirement names it. The code lens raises a
banned test as a major whose `trigger` is the test, so it goes to fix and the minors cap cannot drop it.

## Implementation

Follows [`skills/implement.md`](../../.claude/workflows/red-green/skills/implement.md), `skills/tdd/` and `profile.code_rules`. `head` still at `base`: one more run, then `failed`.

- **One gate rule for writers (implement, fix):** before each commit, run the runner at tier `fast` with `--no-cache`, then
  commit as is, whatever it reports. No stage reverts: the gates stage follows every writer. With no `fast` gate the prompt
  says nothing about gates.
- **Property tests:** only when a case has a `property`, implement gets the rule: one test per property case, opening
  with the marker `contract: <id>: <statement>` as a comment, running the property over the domain, checking that it
  rejects each `mut`, and printing each example before running it. With no framework the marker's next line is
  `domain: <json>` and the test follows `run`'s test-side protocol ([`args-and-profile.md`](args-and-profile.md));
  with one it is written in it and reads `PROPERTY_SEED` and `PROPERTY_EXAMPLES`. The script adds the property contract's
  id to that case's check row as `contract`.
- **Checks:** one row per case and per boundary phrase, each with a `test` or an `unverified` reason; a row with a test also
  has `red`, the failure line it showed before the code. The script adds to `unverified`: `case <id>: no check reported` per
  case without a row, `<ref>: <reason>` per `unverified` row, and `<ref>: test <name> reported no red line` per test row
  without `red`.

## Gates

Skipped when HEAD has not moved and every gate holds a result: the last rows stand and no agent is called. Otherwise one
agent runs the runner at tier `round`, calls it again on exit 3, and returns its rows. The status is the script's.

- **`red`** is a major `G<round>-<name>`, or `G<round>a<k>-<name>` after attempt `k`. Its `problem` names the log, so a fix
  need not run the gate again to see the cause.
- **`known_red`** is shown to the lenses and makes no finding.
- **No result** (`not_run`, no row, the script's exit 2, a dead step) gets one `:retry` of the stage, which picks up finished
  gates. Still none: an entry in `failures` and no finding, and the next iteration runs the stage again though HEAD has not
  moved. It does not keep an iteration from being clean, since `failures` stops the
  fast-forward.

Lenses run no gate.

## Attempts on a red gate

A red gate goes to `fix` at once as a major, before any review, and the gates stage runs again. This repeats up
to `blocks.gates.fix_attempts` (2) per iteration and uses up no iteration. `fix_attempts: 0` sends a red gate straight to
review.

An attempt whose fix leaves HEAD unmoved ends that iteration's attempts, and a gate a fix rejected at this HEAD gets no new
attempt. When such gates are all an iteration has to fix, the loop ends there, with them in `leftover_findings`, since
another iteration would review the same code. An attempt whose fix dies is an entry in `failures` and ends the
attempts. Attempts are left out of the EARLIER FIXES a fix is given, so they do not count toward the rule on a finding that
recurs after two fixes.

A gate still red goes on to the lenses with a note naming it and the attempts made on it so far in the run (the most of any
gate named), and it stays a major, so the iteration is not clean.

## Review

Two lenses in parallel (`blocks.review.lenses`), given every earlier finding with its outcome; a rejected one is raised
again only with a `problem` that answers the fixer's `argument`.

- **Code lens:** with property cases in the plan it also raises a property test lacking the check that its property
  rejects each named wrong output, as a major whose `trigger` is that test.
- **Checklist lens:** one `checked` row per requirement id except `verify_launch` ones, `status`
  `met|unmet|unverified`; an id without a row is `unverified`. `unmet` becomes a major finding; `unverified` goes to
  `leftover_findings` and starts no fix.
- **The last fix:** after a fix, each lens gets `from_head` and the outcomes of every fix since the last review, and verifies
  on `git diff {{from_head}}..HEAD` that each `fixed` finding is fixed, that each rejection's argument holds and that no test
  was weakened. A claim that fails is a new major. A rejection no lens raises again is accepted.
- **Severity:** the script turns a major with an empty `trigger` into a minor and keeps at most `blocks.review.minors`
  (2) minors per lens; a dropped minor's proof is a stray.
- **Silence is not clean:** `verdict` is `clean` exactly when `findings` is empty and no row is `unmet`. No rows, or a
  disagreeing verdict, reads as `SILENT` in `verdicts` and lands in `failures`. A dead or silent lens keeps the iteration
  from being clean.

## Fix

Runs at the end of an iteration with a major, unless it is the last. It gets majors and minors in one call, the minors including earlier iterations' that no fix has answered, each once; minors alone make no fix. A finding that does not fit is rejected with an argument citing code, the ticket or the
spec. Fixed and rejected findings, minors included, enter the earlier findings. `applied` findings with `head` unchanged are
an entry in `failures`.

**Proofs.** A code-lens major may carry `proof: {path, command, red}`, an uncommitted test red on HEAD. Green on HEAD is
a valid rejection ("proof green"), a red proof only an argument against the test. Each is rewritten into the suite and
committed, or deleted, and reported in `proofs`. In the last iteration, and for any minor, the code lens writes no proof
file; a finding the script downgrades to minor loses its proof, and the next fix deletes the file. A stray is a proof on any
other source's finding, on a minor dropped over the cap, a sent proof the fix reports by neither id nor path, or one no fix was sent (its fix died, a clean
iteration, the last one): a row in `stray_proofs` and one `failures` entry each at the end. The main thread deletes them
before acceptance.

## Loop exit

`blocks.review.rounds` (3) iterations at most, a number fixed at the start, so at most `rounds - 1` fixes follow a review. A
clean iteration (no major, every lens answered) ends the loop at or past `blocks.review.min` (2). A clean
iteration before `min` makes no fix, and the next one reviews the same code at no gate cost.

The last iteration makes no fix: its majors and unmet requirements go to `leftover_findings`. Blocking there means
`severity: major` or `status: unmet`; an `unverified` row is reported, not blocking. `advisory` holds the minors no fix
applied, from any iteration. See
[`template/core/orchestrator.js`](../../.claude/workflows/red-green/template/core/orchestrator.js).
