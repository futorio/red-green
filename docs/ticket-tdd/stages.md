# Stages

## 0. Gates discovery

Only when `blocks.gates.gates` is absent, before research: one agent (`gates:discover`, `blocks.gates`, the
no-code preamble plus the long-command rule) finds the project's gates — in the repository's agent instructions, then CI config,
then the task runner; the first source that names gates wins. A gate is a command CI or those
instructions require before a commit; it runs with no human, network or secrets, passes or fails by exit
code and writes nothing to the tree. It runs each one once on the base tree, exactly as its `command`
reads; one that cannot run that way there becomes a question, not a gate. It returns `gates[]`
`{name, command, source, line}` and `questions[]` `{command, source, question}` for the commands it is
unsure of, `source` being the source of the gate a question bears on; a repository with no gate answers `gates: []`
and a question saying where it looked. The script uses `gates` as the profile's gates and each `line` as that gate's baseline. A
question whose `source` none of the returned gates has is dropped with a log line; the rest go to the
result as `gates_questions`, and no later stage gets them. A dead step, or one that finds no gate, ends the
run as `failed` before research; the latter keeps its `gates_questions`, which say why.

## 1. Research

A spec is not an implementation plan. The research agent reads the target, its spec, siblings, the
documents they cite and the code they touch, and returns JSON only (schema-forced, no Markdown copy):

- `requirements[]`: one line each, prefixed `R<n>:` and naming the checklist box it comes from;
- `facts[]`: `{kind, fact, where, requirements}`, where `requirements` lists the ids the fact serves, or
  `general` for one that serves the whole ticket. Kinds, picked by one rule (lines of code show it →
  `change-site` if the change touches them, else `code`; no lines → `note`):
  - `code`: how existing code behaves, places to recheck but not edit; `where` a list of `file` or `file:a-b`;
  - `change-site`: a place the change will touch; `where` as for `code`;
  - `note`: anything no lines of code show; `where` is `path § section` (a repository document) or
    `$ command` (a read-only `rg`, `grep`, `git`, `find` or `ls` of the repository). Outside
    documentation is not a source.
- `plan[]`: the fewest actions in dependency order, built from the facts to meet the requirements, reusing
  what the facts name first; every step changes code, config or docs (running checks, committing and
  recording results are the implementer's and the gates'); each step is two or three sentences (at most 600
  characters, checked by the core: an answer with a longer step gets one `research:retry`) naming the part of the code it acts on and every tool, symbol and file involved,
  and leaves line ranges, flags, commands and lists to the facts;
- `test_harness[]`: exactly one `{requirement, by: test|review|launch|none, how}` per requirement, no
  run commands.
- `questions[]`: `{requirement, question, settles: owner|outside}`, every point a requirement depends on that
  the repository does not settle (`owner`: the ticket leaves it to its author; `outside`: running the
  program, outside documentation or data). A question naming an unknown id is dropped and reported in
  `research_issues`; the rest go to the result as `research_questions` and are cut from the JSON later
  prompts get: what research could not settle is not passed on as knowledge.

Every fact is shown by lines of code, a repository document or a read-only search. The environment and the
checks' results belong to the baseline and the gates step, and the prompt says so: without that line the
agent probed the sandbox and filed what it found as plan steps and `$ command -v` notes. The research prompt gets the preamble
without the commit, gate and long-command rules, and its mailbox note without the gate and commit
checkpoints.

**The research checks** are code in the script. The schema rejects a requirement line without an `R<n>: `
prefix; lines with a repeated id are renumbered `R1..Rn`. Facts whose `requirements` name neither a listed
id nor `general` are dropped (`dropped_facts` in the result), and so is a `note` whose `$ command` is not one
`rg`, `grep`, `git`, `find` or `ls` (`SEARCH`: no `;`, `&` or `|`); requirements no fact cites are listed in
`unresearched_requirements`. `test_harness` keeps the first entry per requirement and drops entries naming
an unknown id. Each repair, and each requirement with no `test_harness` entry, is reported in
`research_issues`, not `failures`: the run goes on, and a requirement with no case still meets the coverage
check. `files[]` is derived from the `where` of the `code` and
`change-site` facts. The checked JSON is pasted into every later prompt, with the rule to start from the
`change-site` facts and read only the lines a stage changes or verifies; no stage edits it.

| block | `research` (`blocks.md`) |
|---|---|
| labels | `research`, `research:retry` |
| inputs | `TARGET`, `retry_note`; `previous_notes` (the check errors) on `research:retry` alone |
| defaults | `defaults/research.md`: `research`, `retry_note`; its `section` is the RESEARCH part later blocks include |
| output | `RESEARCH_SCHEMA`: requirements, facts, plan, test_harness, questions; as the `research` input of later blocks, without the `R<n>: ` pattern and the 600-character limit, which only research's own output is held to |
| invariants | read-only; a plan step over 600 characters: one retry with the core's errors, then died; died (no answer): the run fails, a failed retry with a `research:retry output:` entry in `failures` |
| config | `model` opus, `effort` high |

## 2. Test-case planning, and the coverage check

The script routes each requirement by its `test_harness` entry: `test` goes to the planner; `review`,
`none` and a requirement with no entry go to `verify_review`, which the checklist lens checks by name;
`launch` goes to `verify_launch`, which leaves the run: no lens or gate looks at it, and the result lists
each one with research's `how` for the operator to run by hand. With no `test` requirement the planner is
not called and there are no cases.

Before any code exists, the planner turns the `test` requirements into cases `{id, requirement, title,
arrange, act, asserts[]}`: one case for each behaviour a requirement names, its boundaries and rejections
included, each check in one case, each case one test through the seam research's `how` names. A case tests
behaviour, not implementation; its Arrange writes out every input and runs the real code, with a stub only
for what a test cannot run (another program, the network, hardware, the clock), stating what the stub is
given and what it returns or writes. The ticket and the spec are the oracle: each expected value is a single
literal from them, and a default or precedence they leave open takes the reading their words support,
stated in the case. `requirement` is an id; the schema accepts only the `test` ids. The script then replaces each
id with the full requirement line, so later stages and the result see the line. The planner gets the
preamble research gets, without the commit, gate and long-command rules.

**The coverage check** is code in the script: every `test` requirement must be cited by a case, and no
check (the same assert after the same Arrange and Act, case and whitespace folded) may sit in two cases.
Either miss sends the plan back to the planner once, naming the uncovered ids and the duplicated checks;
what is still uncovered goes into the result.

**Open questions.** The planner also lists every point the ticket and research leave open that a case
depends on: `{requirement, question, reading, cases, settles}`, `settles` `research` (the repository holds
the answer, research did not give it) or `owner` (the ticket leaves it to its author). A question no
listed case takes is dropped. They go to the result as `plan_questions`, for reading the run afterwards;
no later stage gets them.

| block | `plan` (`blocks.md`) |
|---|---|
| labels | `plan`, `replan` |
| inputs | `plan`: `test_ids`, `research`; `replan`: those and `uncovered`, `uncovered_note`, `duplicates`, `duplicates_note`, `plan.cases` |
| defaults | `defaults/plan.md`: `plan`, `replan`, the `rules` both include |
| output | `casesSchema(test ids)`: cases, questions |
| invariants | read-only; died (no answer): the run fails (plan) or the previous cases stand (replan) |
| config | `model` null (research's), `effort` high |

## 3. Implementation

Follows `skills/implement.md` and `tdd/` beside it, and `profile.code_rules`. Cases are taken one per
red → green cycle.

The skills are vendored and read by path (upstream sets `disable-model-invocation`). `implement.md` is
built from `mattpocock-skills` 1.2.3 `skills/engineering/implement/SKILL.md` and the in-loop and fix rules
of [ub-mode](https://github.com/unclebob/ub-mode) (Laziness Protocol, Boundary Discipline's entry check,
Type System Discipline's compiler rule, Make Operations Idempotent, Fix Root Causes); its § Code rules is
cited by the fix and the code lens. Not taken from ub-mode: the architecture and design rules (data shape
first, Redesign From First Principles, Model the Domain, pure business logic, shared state), which belong
before implementation; Attack the Premise; its tools (crapper, dryer, mutator); Build the Lever, Outcome-
Oriented Execution, Refactoring and the Practice section. `tdd/` is mattpocock's `tdd` with the seams taken
from the cases, no `/codebase-design` pointer, and three ub-mode loop rules (red for the right reason,
honest or unverified, a test fails when every function returns nothing); Sequence work into verifiable
units and Test Behavior, Not Implementation were already there.
Before reporting, every boundary the ticket states (a limit, an empty input, a missing key, an error path,
an exit code) gets a phrase row with a test at its requirement's seam, unverified only when the environment cannot run that test; then the
deliverable is called the way its consumer calls it and fed every input, mode and data file the ticket
names; what was not run that way is listed in `unverified`, an empty list being a claim that all of it was.
Report: `head`, `checks`, `unverified`, `questions`, notes.

**Checks.** One row per case (`ref`: its id) and per boundary phrase (`ref`: the ticket's words, quoted),
`{kind: case|phrase, ref, requirement, test?: {file, name}, unverified?}`, each with a `test` or an
`unverified` reason (the schema enforces one). The script adds `case <id>: no check reported` to
`unverified` for each case with no `case` row, and `<ref>: <reason>` for each row with `unverified`; the
checklist lens gets the whole list. Whether every boundary phrase has a row is left to that lens.

**Questions.** `{requirement, question, reading, settles: owner|plan}`: `plan` when the plan contradicts the
ticket and the implementer followed the ticket, `owner` when the ticket leaves it open. One for an unknown
requirement is dropped with a log line. They go to the result as `implement_questions` and to no stage.

Implementation commits its work as it stands, even with a gate worse than its baseline (with
`one_commit`, it creates the one commit); the gates step turns the red gate into a finding for the fix.
Fixes and the minor fix commit only with every gate at its baseline or better.

**If implementation made no commit** — `head` still at `base` — the stage runs once more, told that the
previous attempt made no commit and given its notes; a second such result ends the run as `failed`
before any review.

| block | `implement` (`blocks.md`) |
|---|---|
| labels | `implement`, `implement:retry` |
| inputs | `BASE`, `retry_note`, `IMPLEMENT_SKILL`, `code_rules`, `cases`, `research`; `previous_notes` on `implement:retry` alone |
| defaults | `defaults/implement.md`: `implement` |
| output | `IMPL_SCHEMA`: head, checks, unverified, questions, notes |
| invariants | writer, commits its work as it stands; died (no answer, or head at base): one retry, then the run fails |
| config | `model` sonnet, `effort` high |

## 4. Gates

One agent, run once per HEAD, before the lenses of its round, and skipped when HEAD has not changed
since the last gates step (implement and every fix report `head`). It only executes, read-only, under the
no-code preamble plus the long-command rule: it runs every gate `blocks.gates.gates` declares (listed in its
own prompt with their baselines) to completion, compares each with its baseline line, and returns one row
per gate, `{name, status, line}`: `status` `green` (at its baseline or better), `red` (worse) or `not_run`
(`line` the reason); the schema accepts only the declared names. Every HEAD gets every gate: there is no
scoped rerun after a fix.

The step returns no findings; the script makes them. A `red` row is a major finding `G<round>-<name>`
(`G<round>r-<name>` after the last fix), source `gates`, its trigger the gate's line against its
baseline line. A `not_run` row, a declared gate with no row, and a dead step each land in `failures`.
The lenses get each gate as `name: status — line` and run none of the gates; both lenses and the fix-diff review may make one
targeted run of the changed path. Scope is the checklist lens's; a number the statement gives is a
requirement it checks.

| block | `gates` (`blocks.md`; the discovery step of stage 0 too) |
|---|---|
| labels | `gates:discover`, `gates:r<n>`, `gates:r<n>:recheck` |
| inputs | `discover`: none; `run`: `HEAD`, `REPO`, `gate_list` |
| defaults | `defaults/gates.md`: `discover`, `run` |
| output | `DISCOVER_SCHEMA`: gates, questions; `GATES_SCHEMA`: head, gates, notes |
| invariants | read-only; died (no answer): a failure, and so is a missing or `not_run` row; discovery dead or with no gate: the run fails |
| config | `model` sonnet, `effort` medium, `gates` (null: discovery) |

## 5. Review × n

Two lenses in parallel — checklist (every requirement id but the `verify_launch` ones, every `verify_review` requirement) and code
(would it execute, is each assert falsifiable, is any test weakened or vacuous, `profile.code_rules`).
A diff with no production file gets one checked row saying so from the code lens, which then reviews only its tests.

**The checklist lens** reviews the change against its statement: the target and every document it
points to, as written before the code. It receives every requirement id except the `verify_launch` ones,
and the `unverified` list implement reported. For each id it quotes the statement's sentence as the
`promise` and tries a `counterexample`, the input most likely to make the promise false on the diff;
it returns one `checked` row per id with `promise`, `counterexample` and `status: met|unmet|unverified`,
`met` only when the counterexample was tried and the promise held. An id without a row counts as
`unverified`. An `unmet` requirement becomes a major finding — the promise and evidence as its `problem`,
the counterexample as its `trigger` — and goes to the fix like any other; an
`unverified` one goes to `leftover_findings` and starts no round. Its `findings` are for defects outside
the requirements, and a change the statement does not call for is one.

**Mutation cannot be skipped silently.** The mutation step reports whether it applied and ran; one
that applied and did not run, a `not_run` mutant, or a dead step lands in `failures`.

Every review stage (the lenses, the fix-diff review) gets the preamble of the stages
that write no code: no commit rules, no gate list. Each round the lenses also receive every finding of
the earlier rounds with its outcome — `fixed`, or `rejected` with the fixer's `argument`; a rejected
finding is raised again only as a finding whose `problem` answers that argument.

**Severity is `major` or `minor`.** `major` is a concrete defect in this diff with a `trigger` (a
reachable input or path) and a `consequence` (what breaks); everything else is `minor`. The script turns a
major with an empty `trigger` into a minor and keeps at most `blocks.review.minors` (2) minors per lens and per fix-diff review. Minors go to `advisory`: never sent to the round's
fix, never holding a round open; the minor fix after the rounds applies the cheap ones. One root cause is one finding; a closed finding is not restated
as a broader risk; from round 2 a new finding on code the last fix did not change says why it was
missed.

**Proof is optional.** A code-lens major about behaviour may carry `proof: {path, command, red}`: a
test the lens wrote as a new, uncommitted file in the repository's test directory, the command it ran
and the output line that showed it red on HEAD. A proof on any other source's finding is not sent to a
fix and is a stray (below).

**Silence is not clean.** Every reviewer returns `checked` rows — item plus the artifact that settled
it. `verdict` is `clean` exactly when `findings` is empty and no row is `unmet` (an unmet row is a finding by
itself). No rows or a `verdict` that disagrees with that reads as `SILENT` in `verdicts` and lands in
`failures`. A round with a dead or silent lens is
not clean and cannot end the loop.

| block | `review` (`blocks.md`) |
|---|---|
| labels | `review:r<n>:checklist`, `review:r<n>:code` |
| inputs | `round`, `rounds`, `TARGET`, `BASE`, `check_ids`, `verify_review`, `verify_review_note`, `unverified`, `unverified_note`, `config.runtime`, `runtime_note`, `IMPLEMENT_SKILL`, `duty.order`, `code_rules`, `duty.test_case_review`, `gate_rows`, `history`, `earlier_findings`, `research`; every lens fills all |
| defaults | `defaults/review.md`: one part per lens key (`checklist`, `code`), the `head` and `frame` both include, `weakened` (fix-review's duty includes it too) |
| output | `reviewSchema`: verdict, findings, checked, notes |
| invariants | read-only (the code lens may write uncommitted proofs); died (no answer, no checked rows, a verdict off the findings and unmet rows): a failure, the round is not clean |
| config | `model` opus, `effort` high, `rounds` 2, `extra` 0, `min` 2, `lenses` [checklist, code], `duties` {test_case_review: true, order: false}, `minors` 2, `runtime` null (a string: where the code lens asks whether every new branch executes as intended, " in <runtime>") |

## 6. Fix

Verify before agreeing and before disagreeing; a fix that does not fit is rejected with an argument
citing code, the ticket or the spec, and returns to the next round. Never delete the thing a finding is
about. Findings are grouped by root cause and each cause fixed once, and closed on every other path
the same failure could take. From round 2 the agent sees the
earlier rounds' fixes, and a cause already fixed twice is rejected as "recurs after two fixes: needs a
split or the user" rather than patched a third time. The fix commits only with every gate at its baseline or better;
when a gate stays worse, it reverts its edits, reports `head` unchanged and rejects every finding, naming
each such gate in the `argument`. The fix reports its `head` (the script's once-per-HEAD check reads it).

**Proofs.** A finding with a proof reaches the fix with it. The fix runs its command first: green on HEAD
is a valid rejection ("proof green"); a red proof is rejected only with an argument against the test.
Every proof is rewritten into the suite in its style and committed, or deleted, and reported in `proofs`
(`{id, path, outcome: rewritten|deleted}`). A proof on a minor goes to the minor fix, which deletes it. A
sent proof the fix reports by neither id nor path, and a proof no fix was sent (its fix died, the run
stopped), is a stray: a `{id, path}` row in `stray_proofs` and, at the end of the run, one `failures`
entry each (so a stray never skips the minor fix).

**The fix-diff review.** The last round's fix gets one reviewer (`review:fix:r<n>`) on `git diff <head before the fix>..HEAD` only,
given each finding the fix was sent with its outcome: is each `fixed` one fixed by the diff, does each `rejected` one's
`argument` hold against the code, does the diff break a sibling path, is a test weakened, deleted or vacuous. Its majors after the
last round get one more fix (`fix:r<n>:review`) and one more fix-diff review; what is still found is left
over as `unverified`. `blocks.review.extra` instead adds full rounds.

| block | `fix` (`blocks.md`) |
|---|---|
| labels | `fix:r<n>`, `fix:r<n>:review` |
| inputs | `round`, `IMPLEMENT_SKILL`, `code_rules`, `findings`, `fixed`, `earlier_fixes`, `research` |
| defaults | `defaults/fix.md`: `fix`, `silence` (the minor fix includes it too) |
| output | `FIX_SCHEMA`: applied, rejected, proofs, head |
| invariants | writer, commits only with every gate at its baseline or better, else reverts its edits, commits nothing and rejects every finding; died (no answer): a failure, the rounds stop |
| config | `model` null (implement's), `effort` high |

| block | `fix-review` (`blocks.md`) |
|---|---|
| labels | `review:fix:r<n>[:<pass>]` |
| inputs | `HEAD`, `from_head`, `duty.test_case_review_fix`, `given`, `research` |
| defaults | `defaults/fix-review.md`: `fix-review` |
| output | `REVIEW_SCHEMA` |
| invariants | read-only; died: no answer leaves what it was given over as unverified; no checked rows or a verdict off the findings is a failure |
| config | `model` null (review's), `effort` high; follows `review.minors` and `review.duties` |


## 6a. Mutation

**Mutants are aimed at the checks.** The step runs once per run, in its own `mutation` step, never in a
gates step: after the first round that ends with no finding to fix, on that HEAD. Its survivors get a fix,
then one more review round without the step, even past the planned rounds. A run that uses up its rounds
without such a round runs the step once at the end, and its survivors are left over.

By default (`{build?, test, timeout?}`) one agent (`blocks.mutation`: haiku, effort medium) reads the diff, the
ticket and implement's `checks` rows that carry a test (not the unverified ones) and writes, for each such
row, one patch that breaks the behaviour its test claims to pin, plus at most `blocks.mutation.edges` (5) on
edges the ticket does not state; each changes production source only, in one place, never a test, and applies to HEAD. It runs
them through `skills/mutate.mjs` (node and git only): each mutant, one at a time, in a detached worktree at
HEAD under the run directory, removed after. `build` and `test` each get the full `timeout` (seconds; `blocks.mutation.timeout`, 300,
when the profile gives none); a `build` that exits non-zero or runs past it makes the mutant `invalid`, a `test` that does
kills it, a patch that does not apply is `not_run`, the rest `survived`. The plug-in form (`{tool}`) names the project's own tool in words: when it
applies, its command, what it covers; it returns the same records.

The contract, both forms: `{applies, ran, not_run?, mutants: [{target, patch, status}]}`, `status`
`killed|survived|invalid|not_run`, `target` a check's `ref`, `edge: <short phrase>`, or `operator` for a tool
that cannot name one, `patch` a unified diff against HEAD. The script derives each id (`M-<n>`), its
`file:line` (the file from the patch's `+++` side, its `---` side for a deleted file; the line from the HEAD
side of its first hunk header) and the counts by status. `applies` false (no
file the step covers in `BASE..HEAD`; `ran` false, `mutants` []) skips the step with a log line; `ran` false
(the runner's exit 2: `not_run` its stderr) and each `not_run` mutant land in `failures`; `invalid` ones are only counted. Every survivor is a `major` finding (`source:
mutation`, its target in `problem`, its patch in `trigger`) that goes to fix, which makes the target's test
fail on it or rejects it with an argument like any finding. No separate call rules on survivors.

| block | `mutation` (`blocks.md`) |
|---|---|
| labels | `mutation` |
| inputs | `generated`: `HEAD`, `BASE`, `TARGET`, `RUN`, `config.edges`, `mutate_command`, `tested_checks`; `tool`: `HEAD`, `config.tool` |
| defaults | `defaults/mutation.md`: `generated`, `tool` |
| output | `MUTATION_SCHEMA`: applies, ran, not_run, mutants |
| invariants | read-only; died (no answer): a failure; so are `ran` false where it applies and a `not_run` mutant |
| config | `model` haiku, `effort` medium, `edges` 5, `timeout` 300, `build`, `test`, `tool` (null) |

## 6b. Minor fix

One agent (`blocks.minor-fix`; no model of its own: the fix's) after the rounds and the mutation step, skipped when
there is no minor finding or a stage failed. It applies each advisory finding whose fix is cheap (a few
lines in files the run changed, no new test file, no change of design), rejects the rest with a reason,
reruns the gates and reverts when one got worse than before its edit; no fix-diff review follows it. Applied findings leave
`advisory`; the result's `minor_fixes` lists what it applied and rejected.

| block | `minor-fix` (`blocks.md`) |
|---|---|
| labels | `fix:minor` |
| inputs | `IMPLEMENT_SKILL`, `code_rules`, `findings` |
| defaults | `defaults/minor-fix.md`: `minor-fix` |
| output | `FIX_SCHEMA` |
| invariants | writer, commits only with no gate worse than before its edit, else reverts its edits and rejects every finding; died (no answer): a failure |
| config | `model` null (fix's), `effort` medium |

## Loop exit

```
loop:
  round += 1
  gates (every gate), if HEAD changed since the last gates step; then in parallel the lenses, given its rows
  findings = gates findings + review(round, earlier findings), minors set aside
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
