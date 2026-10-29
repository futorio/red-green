# ticket-tdd — research → TDD → review loop

A Workflow run that implements **one ticket or one spec** in any git repository. The script is
`.claude/workflows/ticket-tdd.js`; this directory holds what its agents read and run (`skills/`, the mutant
runner `mutate.mjs` among them) and
`workflow-doctor.sh`. This repository is the one shared copy: projects run it in place, never copy it.
The core knows nothing about any one project: what a project adds — its gates, its rules, the commands
its mutants run under — arrives in `args.profile`, from a small profile workflow in the project that calls
`workflow({ scriptPath: <core>/.claude/workflows/ticket-tdd.js }, {...args, tools: <core>, profile})`,
with `<core>` this repository's absolute path, given to the profile as an arg.

Moved out of touhou8-multiplayer at its commit `fac5910` (its ADR 0007); history before that is there.

## Shape

```
[gates discovery] → research
  → ( test-case planning → coverage → implementation )
  → ( gates → review → fix ) × n → fix-diff review
  → [mutation] → minor fix
```

Every run plans test cases, reviews with both lenses for two full rounds, and runs the mutation step
when `blocks.mutation` has a `test` or a `tool`. `n` is `blocks.review.rounds`, 2 by default. The gates step runs only when HEAD changed since the last
one, and runs before the lenses of its round, which get its rows. The last round's fix, which no full round follows, gets a
review of its own diff. Freeing the run directory is the main thread's step after acceptance.

## Parameters (`args`)

| arg | meaning | default |
|---|---|---|
| `target` | path of the ticket or spec | required |
| `repo`, `branch` | worktree the agents work in, and its branch | required |
| `tools` | checkout of this repository (it holds `.claude/workflows/ticket-tdd/`) | required |
| `run` | scratch directory for state files | required |
| `base` | the commit the run starts from; review diffs against it | required |
| `baseline` | `{<gate name>: <summary line at base, with the cause of any failure already there>}`, one entry per gate in `profile.blocks.gates.gates`; a missing entry fails the run before research; ignored when no gates are declared | required with declared gates |
| `one_commit` | the ticket pins exactly one commit: later stages `--amend` it | `false` |
| `profile` | the project's additions, below | `{}` |
| `replay` | harness-only: `render.mjs` sets it when it replays a case (§ Template); research's recorded output is taken as given, without the plan-step check and `research:retry`. A real run never sets it | `false` |

`models`, `rounds`, `extra_rounds` and `min_rounds` moved into the block config (`profile.blocks`, § Blocks), and so
did `profile.gates`, `profile.mutation` and `profile.runtime` (now `profile.blocks.review.runtime`);
`profile.research` gave way to a research `prompt`: `"{{default}}\n<text>"` renders the prompt it made byte for byte.
A run that still passes one fails before any agent (`status: failed`, `stage: config`, the note naming where it went)
instead of ignoring it.

### Model presets

Three `profile.blocks` model sets from the stage tournament (`.scratch/wf-ablation/tournament-report.md` in the
wf-ablation repo). Effort stays `high` for research, plan and implement (their defaults). Measured: plan opus beats
sonnet, haiku and no plan; implement models tie on the hidden verifiers; review opus leads lighter reviewers by
0.2-0.3 F2. Not measured: a lighter research model (its stage was stopped) and the fix model (it defaults to the
implement model).

| preset | for | `profile.blocks` | why |
|---|---|---|---|
| standard | most tickets | `{"implement": {"model": "haiku"}, "fix": {"model": "sonnet"}}` | plan and review keep opus; implement tied, haiku is the cheapest; fix stays on sonnet, unmeasured on haiku |
| hard | concurrency, determinism, cross-cutting changes | `{}` (the default: sonnet implement and fix) | same measured stages; sonnet costs a little more as insurance on cases the tournament had too few of to split |
| cheap | docs, config, small local edits | `{"research": {"model": "sonnet"}, "plan": {"model": "opus"}, "implement": {"model": "haiku"}, "fix": {"model": "haiku"}}` | research is the costliest stage (opus ~$4.3, sonnet ~$1.2 a case); its quality on sonnet is unmeasured, so only where a miss is cheap |

### `profile`

Every field is optional; an absent one leaves the core's neutral wording.

| field | type | where it lands |
|---|---|---|
| `commit` | string | every agent: commit-message rule appended to the core's |
| `context` | string[] | every agent: extra preamble lines (search traps, what not to touch, gate guidance such as tiers that never run in a run or one heavy check at a time) |
| `code_rules` | string[] | implement, fix, code lens: hard code rules |
| `blocks` | `{<block>: {<field>: value}}` | each block's config over the render config's defaults, field by field (§ Blocks): its model and knobs, its approach, its own instructions; an unknown block, field, duty or lens, or a value off its schema (`rounds: 'auto'`), fails the run before any agent |

The fields above reach every block that names them; what one block alone needs is that block's config. The approach
fields, where a block has more than one way to work:

| field | type | approach |
|---|---|---|
| `blocks.gates.gates` | `{name, command}[]`, names unique | declared: the code-writing agents' preamble (name, command, baseline) and the gates step; absent: the gates discovery step finds them |
| `blocks.mutation.build`, `.test`, `.timeout` | string, string, seconds | generated mutants, run under these commands; `timeout` 300 by default |
| `blocks.mutation.tool` | string | the project's own tool, in words, instead of `build` and `test` (both: a config error); no `profile.blocks.mutation`: the step is skipped with a log line; one given with neither `test` nor `tool`, or `build` without `test`: a config error |
| `blocks.review.lenses` | lens keys | the review lens set (§ Blocks) |

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

| block | `mutation` (§ Blocks) |
|---|---|
| labels | `mutation` |
| inputs | `generated`: `HEAD`, `BASE`, `TARGET`, `RUN`, `config.edges`, `mutate_command`, `tested_checks`; `tool`: `HEAD`, `config.tool` |
| defaults | `defaults/mutation.md`: `generated`, `tool` |
| output | `MUTATION_SCHEMA`: applies, ran, not_run, mutants |
| invariants | read-only; died (no answer): a failure; so are `ran` false where it applies and a `not_run` mutant |
| config | `model` haiku, `effort` medium, `edges` 5, `timeout` 300, `build`, `test`, `tool` (null) |

The repository's own agent instructions (`AGENTS.md`, `CLAUDE.md`) reach every agent anyway; the
profile carries only what a stage prompt must name explicitly.

## How to launch

1. **Worktree** — `git worktree add ../wt-<name> -b wf/<name> <branch>`, when another session may be
   committing to the branch.
2. **Baseline** — run each gate of `profile.blocks.gates.gates` in the worktree; its summary line, and any failure
   already there with its cause, becomes `args.baseline[<its name>]`. Without declared gates the run
   discovers the gates and measures the baseline itself; copy the result's `gates` into the profile.
3. **Run** — `Workflow({scriptPath: '<tools>/.claude/workflows/ticket-tdd.js', args})`; the project's specifics come in `args.profile`, never in a wrapper script. A launch by `name` runs the scripts as they were at session start, not as on disk.
4. **After** — check every lens returned a verdict and `failures` is empty; read the commits; re-run the
   gates; fast-forward the branch; free the run directory (`git worktree prune`, then delete every
   directory under `run`, keeping its top-level files); remove the worktree.

**A clarification mid-run** — create `<run>/mailbox.md` starting with the header in § Mailbox, verbatim, then
append entries; agents follow only the rules that header carries.

## Stages

### 0. Gates discovery

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

### 1. Research

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

| block | `research` (§ Blocks) |
|---|---|
| labels | `research`, `research:retry` |
| inputs | `TARGET`, `retry_note`; `previous_notes` (the check errors) on `research:retry` alone |
| defaults | `defaults/research.md`: `research`, `retry_note`; its `section` is the RESEARCH part later blocks include |
| output | `RESEARCH_SCHEMA`: requirements, facts, plan, test_harness, questions; as the `research` input of later blocks, without the `R<n>: ` pattern and the 600-character limit, which only research's own output is held to |
| invariants | read-only; a plan step over 600 characters: one retry with the core's errors, then died; died (no answer): the run fails, a failed retry with a `research:retry output:` entry in `failures` |
| config | `model` opus, `effort` high |

### 2. Test-case planning, and the coverage check

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

| block | `plan` (§ Blocks) |
|---|---|
| labels | `plan`, `replan` |
| inputs | `plan`: `test_ids`, `research`; `replan`: those and `uncovered`, `uncovered_note`, `duplicates`, `duplicates_note`, `plan.cases` |
| defaults | `defaults/plan.md`: `plan`, `replan`, the `rules` both include |
| output | `casesSchema(test ids)`: cases, questions |
| invariants | read-only; died (no answer): the run fails (plan) or the previous cases stand (replan) |
| config | `model` null (research's), `effort` high |

### 3. Implementation

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

| block | `implement` (§ Blocks) |
|---|---|
| labels | `implement`, `implement:retry` |
| inputs | `BASE`, `retry_note`, `IMPLEMENT_SKILL`, `code_rules`, `cases`, `research`; `previous_notes` on `implement:retry` alone |
| defaults | `defaults/implement.md`: `implement` |
| output | `IMPL_SCHEMA`: head, checks, unverified, questions, notes |
| invariants | writer, commits its work as it stands; died (no answer, or head at base): one retry, then the run fails |
| config | `model` sonnet, `effort` high |

### 4. Gates

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

| block | `gates` (§ Blocks; the discovery step of § 0 too) |
|---|---|
| labels | `gates:discover`, `gates:r<n>`, `gates:r<n>:recheck` |
| inputs | `discover`: none; `run`: `HEAD`, `REPO`, `gate_list` |
| defaults | `defaults/gates.md`: `discover`, `run` |
| output | `DISCOVER_SCHEMA`: gates, questions; `GATES_SCHEMA`: head, gates, notes |
| invariants | read-only; died (no answer): a failure, and so is a missing or `not_run` row; discovery dead or with no gate: the run fails |
| config | `model` sonnet, `effort` medium, `gates` (null: discovery) |

### 5. Review × n

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

| block | `review` (§ Blocks) |
|---|---|
| labels | `review:r<n>:checklist`, `review:r<n>:code` |
| inputs | `round`, `rounds`, `TARGET`, `BASE`, `check_ids`, `verify_review`, `verify_review_note`, `unverified`, `unverified_note`, `config.runtime`, `runtime_note`, `IMPLEMENT_SKILL`, `duty.order`, `code_rules`, `duty.test_case_review`, `gate_rows`, `history`, `earlier_findings`, `research`; every lens fills all |
| defaults | `defaults/review.md`: one part per lens key (`checklist`, `code`), the `head` and `frame` both include, `weakened` (fix-review's duty includes it too) |
| output | `reviewSchema`: verdict, findings, checked, notes |
| invariants | read-only (the code lens may write uncommitted proofs); died (no answer, no checked rows, a verdict off the findings and unmet rows): a failure, the round is not clean |
| config | `model` opus, `effort` high, `rounds` 2, `extra` 0, `min` 2, `lenses` [checklist, code], `duties` {test_case_review: true, order: false}, `minors` 2, `runtime` null (a string: where the code lens asks whether every new branch executes as intended, " in <runtime>") |

### 6. Fix

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

| block | `fix` (§ Blocks) |
|---|---|
| labels | `fix:r<n>`, `fix:r<n>:review` |
| inputs | `round`, `IMPLEMENT_SKILL`, `code_rules`, `findings`, `fixed`, `earlier_fixes`, `research` |
| defaults | `defaults/fix.md`: `fix`, `silence` (the minor fix includes it too) |
| output | `FIX_SCHEMA`: applied, rejected, proofs, head |
| invariants | writer, commits only with every gate at its baseline or better, else reverts its edits, commits nothing and rejects every finding; died (no answer): a failure, the rounds stop |
| config | `model` null (implement's), `effort` high |

| block | `fix-review` (§ Blocks) |
|---|---|
| labels | `review:fix:r<n>[:<pass>]` |
| inputs | `HEAD`, `from_head`, `duty.test_case_review_fix`, `given`, `research` |
| defaults | `defaults/fix-review.md`: `fix-review` |
| output | `REVIEW_SCHEMA` |
| invariants | read-only; died: no answer leaves what it was given over as unverified; no checked rows or a verdict off the findings is a failure |
| config | `model` null (review's), `effort` high; follows `review.minors` and `review.duties` |

### 6b. Minor fix

One agent (`blocks.minor-fix`; no model of its own: the fix's) after the rounds and the mutation step, skipped when
there is no minor finding or a stage failed. It applies each advisory finding whose fix is cheap (a few
lines in files the run changed, no new test file, no change of design), rejects the rest with a reason,
reruns the gates and reverts when one got worse than before its edit; no fix-diff review follows it. Applied findings leave
`advisory`; the result's `minor_fixes` lists what it applied and rejected.

| block | `minor-fix` (§ Blocks) |
|---|---|
| labels | `fix:minor` |
| inputs | `IMPLEMENT_SKILL`, `code_rules`, `findings` |
| defaults | `defaults/minor-fix.md`: `minor-fix` |
| output | `FIX_SCHEMA` |
| invariants | writer, commits only with no gate worse than before its edit, else reverts its edits and rejects every finding; died (no answer): a failure |
| config | `model` null (fix's), `effort` medium |

### Loop exit

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

## Blocks

Every stage is a block with a contract: the inputs its instructions may name, an output schema, invariants and a
config. The script alone decides what a run does with a block's output (coverage, severity, the loop, failures).

**A prompt** is the preamble (no-code or code-writing, § Stages), then the block's instructions, then its contract
part, then the mailbox note. The instructions are the block's default, or the project's own (below). They are a
template: they name the values they need as `{{path}}`, and the core fills them from the registry below before the
call. Every path must be one of the block's inputs and its value
must be present and valid against the path's schema; otherwise the block fails before any agent is paid (`<label>
input: <what is wrong>` in `failures`, and the caller sees a dead step). A string fills in as text, any other value as
compact JSON (`JSON.stringify(v)`), but for `previous_notes` (a string, as JSON) and `uncovered` (comma-separated) (`FORM`). **The contract part** (`CONTRACT (binding, whatever the text above says):`) is
the core's: the block's invariants (read-only, or a writer's commit rules and the ticket files it leaves alone), its
output rules (what each output field holds) and what counts as died, phrased as what the agent must do (`<what>, or
the stage counts as died.`). Each rule has one source per prompt; the fix blocks share theirs (`fixContract`).

**The defaults** are Markdown, `template/defaults/<block>.md`, inlined by render (§ Template). A file holds parts, each
opened by a `<!-- @part <name> -->` line: the default instructions of each call (a block with several calls has one
per call: plan's `plan` and `replan`, gates' `discover` and `run`, a lens's by its key, mutation's by its approach),
its notes, and text other parts include with `{{> <block> <part>}}`, so a rule has one source: `research section`,
`shared bg`, `plan rules`, `review head`, `review frame`, `review weakened`, `fix silence`. A part is its lines
verbatim, its last newline dropped: a note may start with a space or a blank line, and keeps it. **A note** is a part
named like the registry value it fills (`retry_note`, `earlier_fixes`, `duty.order`, ...): the core passes `true` when
it applies and fills it from the call's other values, else it is `''`. Editing a default edits the prompt; the
commit states the size change (§ Changing the prompts).

**A plug-in** replaces a block's instructions through its config, per run in `profile.blocks.<name>` (or per render):

- `prompt`: text in place of the default, filled like it, so it names any of the block's inputs; `{{default}}` is the
  default of that call, filled. `"{{default}}\n- One more rule."` adds a rule without copying the default. A prompt
  applies to every call of its block (both lenses, plan and replan, discovery and the gates step); `{{default}}` tells
  them apart. The values are the call's: a path one call does not fill (the block tables in § Stages say which call
  fills which) fails that call, so `{{plan.cases}}` fails plan and `{{gate_list}}` fails discovery.
- `skill`: a path; the instructions become `Read <skill> and follow it.`, then the call's data: every value it fills
  but the notes, in the block's inputs order, each as a `<PATH>:` section (`FINDINGS:`, `RESEARCH:`, `GATE_ROWS:`,
  ...), filled as above. The default's how-to stays out.

Not both: a block given `prompt` and `skill` fails the run before any agent. The contract part, the preamble and the
mailbox note stay the core's whatever the plug-in says, and so do the output schema and what the script does with the
output. The approach fields (§ `profile`) pick a procedure where a block has more than one.

**The registry** (`REGISTRY`) lists every path with its JSON Schema: `template/core/registry.js` holds the paths
several blocks share, and each block's `inputs` part in `template/core/<block>.js` the ones only it reads:

| kind | paths |
|---|---|
| run args | `REPO`, `BASE`, `TARGET`, `RUN` |
| computed | `HEAD` (the HEAD the step runs on), `from_head` (the HEAD a fix started from), `IMPLEMENT_SKILL`, `round`, `rounds` (planned), `gate_list`, `gate_rows`, `mutate_command`, `test_ids`, `check_ids`, `code_rules` (`profile.code_rules` as a section, `''` without) |
| notes' data | `previous_notes` (string: the attempt before a retry), `uncovered` (test ids), `duplicates` (`{check, cases}[]`: checks in several cases), `verify_review` (requirement lines), `unverified` (implement's claims), `history` (`{id, round, where?, problem, outcome: fixed\|rejected, argument?}[]`: earlier findings) |
| notes | `retry_note`, `uncovered_note`, `duplicates_note`, `verify_review_note`, `unverified_note`, `runtime_note`, `earlier_findings`, `earlier_fixes`, `duty.order`, `duty.test_case_review`, `duty.test_case_review_fix`: the default part of that name, filled, or `''` |
| stage outputs | `research` (the checked research: requirements, facts, plan, test_harness, files), `cases` (requirement lines expanded), `plan.cases` (the planner's, for the replan), `tested_checks` (implement's check rows with a test), `findings` (as sent to a fix), `given` (`{id, where, problem, outcome: fixed\|rejected, argument?}` per finding a fix was given), `fixed` (`{round, id, what}` per applied fix) |
| block config | `config.<field>` for every field of `blocks.<name>`: `model` (string or null), `effort` (string), `rounds`, `extra`, `min`, `minors`, `edges`, `timeout` (integers), `lenses` (`LENSES` keys), `duties` (booleans), `gates` (`{name, command}[]` or null), `build`, `test`, `tool`, `runtime`, `prompt`, `skill` (string or null; every block's `prompt` and `skill` null in `default.json`); instructions name `config.edges`, `config.tool` and `config.runtime` |
| default | `default`: the default instructions of the call, filled, for a project prompt that wraps them; every block takes it |

**The validator** (`shared.js` `validate`) is the core's own: `type`, `properties`, `required`, `items`, `enum`,
`pattern`, `anyOf`, `minItems`, `maxLength`; any other keyword anywhere in a schema throws. `render.mjs` exports the
same code for the tests.

**The config** of each block is `blocks.<name>`: defaults in the render config (`template/default.json`), and
`profile.blocks.<name>` over them per run, field by field (an object field such as `duties` key by key, a list
replaces). A `model` of `null` runs on the model of the block it follows (`FOLLOWS` in `orchestrator.js`): plan on
research's, fix on implement's, fix-review on review's, minor-fix on fix's. Each merged block config is checked
against the registry's `config.<field>` schemas: a value off its schema fails the run before any agent (`stage:
config`, the note naming `blocks.<name>.<field>`), and fails a render the same way.

Each block's table (labels, inputs, default parts, output schema, invariants, config defaults) sits at the end of its
section in § Stages; mutation's under § `profile`.

**The conformance check** runs a plug-in's real output through the core offline, before a paid run:

```
node template/render.mjs [config.json] [--case case.json] --conform <label> <output.json>
```

`<output.json>` is what the agent labelled `<label>` returned (`review:r1:code`, `mutation`, `implement`, ...). The
run is the `--prompt` one (§ Template): research, plan and implement answer from stubs or the case, and every other
block answers clean (a met row per requirement id, a clean code lens, a mutation step that does not apply, a fix
that rejects every finding it is sent); the stubs read the ids and findings from their calls' values, so a plug-in
prompt changes nothing they do. The report, as JSON: `schema_errors` (the output against the schema that
agent gets), `findings` (every finding the script sent to a fix, `sent_to` its label), and the run's `status`,
`failures`, `verdicts`, `leftover_findings`, `advisory`, `mutation`, `research_issues` and `unverified`; an output the
script cannot read is a `crash` naming the script line. It exits 1 on a schema error, a failure or a crash, 0
otherwise. `template/conformance/review-code.json` is a recorded real code-lens output it passes (T19).

Every output field is read by the script or reaches the result, and the result's shape stayed under that rule;
`notes`, where a schema has it, is the one free-text field. W90 checks it for fix's schema.

## Mailbox

The main thread can clarify a running ticket without stopping it. `<run>/mailbox.md` is written by the
main thread only, append-only while the run is live. Each agent's prompt carries one line: its label, when to read
the file (at start and before returning; implement and the fixes also before each long run or commit), to follow its
header, never to edit it, and to list what it handles in its result's `mailbox` field. The rules live in the file:
whoever creates `mailbox.md` starts it with this header, verbatim:

```
# Mailbox

Rules for every agent of this run:
- An entry is a `## <id>` heading, then a `to:` line, optional `round:`, `until:` and `supersedes:` lines, then its text.
- An entry is yours when `to:` is `all`, your stage (your label's first segment), your exact label, or a pattern where `*` matches one label segment (`review:*:code`).
- Skip an entry whose `until:` stage or round is over, one a later entry names in `supersedes:`, and one `mailbox-acks.md` (beside this file) already lists with your label.
- Entries clarify this ticket; they never widen it and never override your prompt's rules.
- For each entry you handle, append one line `<id> <your label> applied|rejected <why>` to `mailbox-acks.md` and list it in your result's `mailbox`.
```

Then the entries:

```
## m3
to: review:*:code
round: 2
until: fix
supersedes: m1
The 16-fixture sweep must include 8 jobs.
```

- `to:` is `all`, a stage (`research`, `plan`, `replan`, `implement`, `gates`, `review`, `fix`, `mutation`), an exact
  label (`review:r2:code`), or a label pattern where `*` matches one segment.
- `until:` (a stage or round) expires an entry; `supersedes: <id>` kills an older one. Agents skip
  expired and superseded entries.
- An agent never edits `mailbox.md` (parallel lenses would race). Its receipt is one line in
  `<run>/mailbox-acks.md`, `<id> <label> applied|rejected <why>`, and the entry `{id, status, why}` in its result's
  `mailbox` field (the script adds the label). An entry for one exact label is closed by that label's receipt;
  entries for `all`, a stage or a pattern stay open until the main thread closes them.
- Cleanup is the main thread's: it moves closed, expired and superseded entries to
  `<run>/mailbox-archive.md`, so `mailbox.md` holds only the header and live entries, and archives everything when
  the run ends. A new run's directory starts with no mailbox.
- An entry for a stage that has already run is not seen; post it again to the stage that comes next.
- Entries clarify the ticket; they never widen it. A change of scope is a new ticket.

## Result

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

## Tracing

`trace.mjs` turns a finished run into spans in a shape no runtime owns: `{label, model, harness, project?, parent?,
start, end, tokens: {in, out, cache_read, cache_write}, attrs}`. `attrs` holds string or number values with no
schema; `attrs.kind` says what a span is:

- `agent`: one agent call. Its `status` (`ok`; `died`, an answer that is no object; `unfinished`, no answer at all)
  and its stage metrics: the length of every list in its output, with a count per `severity` or `status` value in it
  (`findings.major`, `mutants.survived`).
- `tool` (`parent` the call, `attrs.tool` its name): a tool call, from its request to its result. Not the agent's own
  work: tests, builds and searches run here.
- `model` (`parent` the call): the call's time no tool covers, the model reading and writing; it carries the tokens
  of the messages that end in it, so a call's model spans add up to its tokens.
- `core`: the run's time between agent calls, when the script alone works.

The core and its prompts know nothing of it. No money: tokens and the model only.

```
node trace.mjs <wf dir> [--project NAME]             # spans as JSONL
node trace.mjs <wf dir> [--project NAME] --table     # calls, tokens and seconds per block and round, core time, the total
node trace.mjs <wf dir> [--project NAME] --chrome      # a timeline: open it in ui.perfetto.dev
node trace.mjs <wf dir> [--project NAME] --speedscope  # a flame chart and graph: open it in speedscope.app
```

A block's seconds add its calls' durations, so parallel lenses can sum past the run; the total's are its wall time.
The Chrome trace has one track per agent call with its tool and model spans nested in it, a `core` track, and one
counter per token kind that steps at each model span; in Perfetto, click a span for its tokens, `f` zooms to it,
`w`/`s` and `a`/`d` zoom and pan. The speedscope file holds the whole run as three profiles, weighted by seconds,
input tokens (`in` + `cache_read` + `cache_write`) and output tokens, each a stack block > call > `model`, a tool or
`core`: Time Order is the flame chart, Left Heavy the flame graph, a click zooms. Both read the file in the browser;
nothing is uploaded.

The one adapter so far reads a Claude Code Workflow run (`harness` `claude-code-workflow`):
`~/.claude/projects/<project>/<session>/subagents/workflows/wf_<id>/`, its `journal.jsonl` (each agent's label and
result) and the `agent-<id>.jsonl` beside it (times, model, usage counted once per API message, each `tool_use`
paired with its `tool_result`). `project` is the
directory the session was launched in, unless `--project` names it. Another runtime gets its own adapter returning
the same spans. `test_trace.mjs` runs it on `trace-fixture/`, a real run with its text cut.

## Testing the core

`test_ticket_tdd.mjs` (beside this file; run by hand with `node --test`, no dependency) evaluates
`ticket-tdd.js` as an async function with a stub `agent()` that returns recorded results keyed by label,
and checks what the script does with them: `tidy`, mutation survivors, checklist statuses, the
deduplicated leftover, the run status, and that the lenses start after the gates step and get its
rows. A change to the core's control flow gets a case there. Its V tests run the core's validator on every
agent schema, a valid sample and an invalid one per keyword the schema uses. `skills/test_mutate.mjs` (`node --test
skills/test_mutate.mjs`) runs the mutant runner on a throwaway git repository.

## Template

`template/` renders this core from `template/core/`, the Markdown defaults in `template/defaults/` (§ Blocks) and a
config, for the ablation study. The core
stays hand-written; the template follows it, and `test_render.mjs` fails when the default config does
not render the core byte for byte, so a change to `ticket-tdd.js` is made in the template too.
`fixtures.json` holds the sha256 of the render of every config variant; `test_render.mjs` checks each, and a
change that alters the render re-records them.

`template/core/` holds one file per block, the files they share and an orchestrator:

| File | Holds |
| --- | --- |
| `orchestrator.js` | `meta`, the args, the round loop, findings, failures, the result |
| `proofs.js` | the proofs and strays bookkeeping: `proven`, `reconcile`, the stray sweep at the end |
| `shared.js` | text helpers, `validate`, `mergeBlocks`, the preambles and the contract part, `idOf` |
| `mailbox.js` | the mailbox and `ask()` |
| `registry.js` | the schema shorthands, `REGISTRY` and `INPUTS` assembled from the blocks' `inputs` parts with the paths several blocks share, `fill()` and `call()` |
| `gates.js` | gates discovery (schema, call), the gates step (schema, `runGates`) |
| `research.js` | its schema, the call, the checks that build the `research` value |
| `plan.js` | the case and cases schemas, the plan call, the coverage and duplicate checks, the replan |
| `implement.js` | its schema, the call and its retry |
| `review.js` | the review schemas and `LENSES`, `SEVERITY`, `CHECKED`, the lens call |
| `mutation.js` | its schema, `runMutation` |
| `fix.js` | its schema, `runFix` |
| `fix-review.js` | `fixReview` |
| `minor-fix.js` | the minor fix pass |

Each block file also has an `inputs` part: its `INPUTS` entry (the paths its instructions may name) and the registry
paths only it reads, with their schemas.

A file is a header comment, then parts, each opened by a `// @part <name>` line and running to the
next. The orchestrator's `main` part is the script: render replaces each of its
`// @include <file> <part>` lines by that part, then fills the two render-time slots: `{{blocks}}` with the merged
block defaults, `{{defaults}}` with every part of `template/defaults/` as `{<block>: {<part>: text}}`, its includes
resolved (every other `{{path}}` is a run-time template variable, § Blocks). A missing part, or one included
never or twice, is an error. The parts sit where the single script needs them, so a block's schema
and its call can be far apart in the render.

Adding a block takes:

1. a new `template/core/<block>.js`, and an `// @include <block> <part>` line in `orchestrator.js` for each of
   its parts (render reads every file in `template/core/` but the orchestrator as a set of parts, so no list in
   `render.mjs` changes);
2. its `inputs` part: `INPUTS.<block>`, every path in it a `REGISTRY` path, and a new path only it reads added to
   `BLOCK_PATHS` with its schema (a path several blocks read goes in `registry.js`); and its
   `template/defaults/<block>.md`, a part per call it makes;
3. a `blocks.<name>` entry in `default.json` with at least `model` and `effort`; a `model` of `null` also needs
   the block it follows in `FOLLOWS` (`orchestrator.js`);
4. its row in the file table above, and its block table in its § Stages section.

A config is JSON with one key, `blocks`, in the shape of `profile.blocks` (§ Blocks); it names only what it
changes and merges over `default.json` the way `profile.blocks` merges at run time. The variant dimensions
the ablation study uses:

- `blocks.<name>.model`, `.effort`: per block.
- `blocks.review.lenses`: the review lenses, a list from `checklist` and `code`; a config's list replaces the default's.
- `blocks.review.duties`: `test_case_review` (on: the weakened-test sentence in the code lens and the fix review) and
  `order` (off; on adds a draft sentence to the code lens, marked "experiment draft" for the experiments
  to settle: any two paths that change one piece of state within one unit of processing, in both orders
  and repeated).

A key, block, field or duty the default does not name, or a value off its registry schema (an unknown lens
included), is an error.

```
node template/render.mjs [config.json]                                    # the workflow, on stdout
node template/render.mjs [config.json] --case case.json --prompt <label>  # one stage's prompt
node template/render.mjs [config.json] --case case.json --prompt <label> --json
```

`--prompt` runs the rendered script with stub agents and prints the prompt, mailbox note included, that
the agent labelled `<label>` (`review:r1:code`, `fix:r1`, ...) receives. The case is
`{ args, gate_lines, results }`: `args` override stub args (`target` is the ticket path, `base` the
commit the diff starts from: the prompt names both, the agent reads them; the stub args declare one gate,
`gates`; a case whose profile declares none gets a stub discovery step that finds that same gate), `gate_lines` are the lines of the declared gates, in order, in every gates step's rows (all `green`), and `results[label]` is an earlier stage's recorded result. Research, plan and implement
have stubs (one requirement); a stage behind a review round, such as a fix, needs the
round's results in the case. The replay passes `args.replay: true` (§ Parameters), so a recorded research is not re-checked: a plan step over 600 characters recorded before that limit reaches later prompts verbatim. A run that fails before the label (`config`, a `<label> input:` failure, a dead stage) is an error naming its stage and failures. `--json` prints `{ prompt, schema, model, effort }`: the call that agent
gets, which the ablation suite (`ablation/README.md` in the wf-ablation repo) hands to headless Claude Code.

### Adding a config field

1. Add the field to its block in `default.json` with the value that renders today's behaviour; a new duty
   is off by default.
2. Give it a schema in the registry as `config.<field>` (a new duty: its boolean in `config.duties`), and read it
   in the core as `CONFIG.<block>.<field>`. A value an instruction names also goes in the block's `INPUTS` entry (its `inputs` part); a
   duty's sentence is a note in `template/defaults/review.md` named `duty.<name>`, its value the boolean.
3. Add a stub test that the field moves the behaviour, and a render test beside T03-T06 (it changes only
   the block defaults line). Record a variant in `fixtures.json` when the ablation study varies it (T13).

A new lens is its entry in `template/core/review.js`'s `LENSES` and its part in `template/defaults/review.md`; its
key is the name `blocks.review.lenses` takes and the part's name.

## Changing the prompts

**Prompts are code.** Every word in a stage prompt or a skill is paid on every call of that stage; a block's how-to
is its part in `template/defaults/`, its contract part is in its `template/core/` file. A commit that edits one
states the size change in bytes. When an agent keeps making the wrong move, fix
the schema, the check or the input it is given — the thing that let it make that move — before adding
one more sentence telling it not to.

**Discipline is not a fix.** After a fix, ask: had it existed six months ago, could today's failure
still have arrived by another path? If a class of defect already has two written rules and comes back,
a third rule is not the answer: the fix is a check, a schema field or a deleted duplicate. Prefer
removing the surface the defect lives on to adding a gate over it. The same question is put to the fix
stage about the code.

## Dependencies

`workflow-doctor.sh` checks them and exits 1 on anything missing; `--help` says why each is needed.
