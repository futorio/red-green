# ticket-tdd — research → TDD → review loop

A Workflow run that implements **one ticket or one spec** in any git repository. The script is
`.claude/workflows/ticket-tdd.js`; this directory holds what its agents read (`skills/`) and
`workflow-doctor.sh`. This repository is the one shared copy: projects run it in place, never copy it.
The core knows nothing about any one project: what a project adds — its gates, its rules, a mutation
tool if it has one — arrives in `args.profile`, from a small profile workflow in the project that calls
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
when the profile names a tool. `n` is 2 unless `args.rounds` is given. The gates step runs only when HEAD changed since the last
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
| `baseline` | `{<gate name>: <summary line at base, with the cause of any failure already there>}`, one entry per gate in `profile.gates`; a missing entry fails the run before research; ignored when `profile.gates` is absent | required with `profile.gates` |
| `rounds` | max review rounds `n`, or `auto` | `2` |
| `min_rounds` | rounds that run even when a round comes back clean | `min(n, 2)` |
| `extra_rounds` | full rounds added when the last planned round has majors to fix | `0` (the fix-diff review sees the fix) |
| `one_commit` | the ticket pins exactly one commit: later stages `--amend` it | `false` |
| `models` | per stage: `research`, `planner`, `implement`, `gates`, `review`, `fix` | `opus`, research, `sonnet`, `sonnet`, `opus`, implement |
| `profile` | the project's additions, below | `{}` |

### `models` presets

Three `args.models` sets from the stage tournament (`.scratch/wf-ablation/tournament-report.md` in the wf-ablation repo). Effort stays
`high` for research, plan and implement (the core fixes it). Measured: plan opus beats sonnet, haiku and no plan;
implement models tie on the hidden verifiers; review opus leads lighter reviewers by 0.2-0.3 F2. Not measured: a
lighter research model (its stage was stopped) and the fix model (it defaults to the implement model).

| preset | for | `models` | why |
|---|---|---|---|
| standard | most tickets | `{"implement": "haiku", "fix": "sonnet"}` | plan and review keep opus; implement tied, haiku is the cheapest; fix stays on sonnet, unmeasured on haiku |
| hard | concurrency, determinism, cross-cutting changes | `{}` (the default: sonnet implement and fix) | same measured stages; sonnet costs a little more as insurance on cases the tournament had too few of to split |
| cheap | docs, config, small local edits | `{"research": "sonnet", "planner": "opus", "implement": "haiku", "fix": "haiku"}` | research is the costliest stage (opus ~$4.3, sonnet ~$1.2 a case); its quality on sonnet is unmeasured, so only where a miss is cheap |

### `profile`

Every field is optional; an absent one leaves the core's neutral wording.

| field | type | where it lands |
|---|---|---|
| `gates` | `{name, command}[]`, names unique | the code-writing agents' preamble (name, command, baseline) and the gates step; absent: the gates discovery step finds them |
| `commit` | string | every agent: commit-message rule appended to the core's |
| `context` | string[] | every agent: extra preamble lines (search traps, what not to touch, gate guidance such as tiers that never run in a run or one heavy check at a time) |
| `research` | string | research: where decisions live, which harnesses exist |
| `runtime` | string | code lens: what the new code must execute in |
| `code_rules` | string[] | implement, fix, code lens: hard code rules |
| `mutation` | string | mutation step: when and how to run the project's own mutation tool, if it has one |

**Mutation testing is the project's tool, never done by hand.** The core names no tool; `profile.mutation`
names it in words: when it applies, its command and what it covers. It runs once per run, in its own
`mutation` step, never in a gates step: after the first round that ends with no finding to fix, on that
HEAD. Its survivors that need a fix get one, then one more review round without the tool, even past the
planned rounds. A run that uses up its rounds without such a round runs the tool once at the end, and its
unruled survivors are left over. The step reports its counts (`generated`, `invalid`, `judged`, `killed`, `timeouts`) and every survivor (file,
line, op, before, after) through its schema; `tool.applies` with `tool.ran` false lands in `failures`. The
profile's command passes the tool the project's test command for the test files the diff adds or changes, so
a mutant that only a test kills is killed. Each survivor is then ruled on by the code lens in a short call of
its own (`review:code:survivors`): `equivalent` (no test could tell it from the original) or
`unreachable` (the mutated code cannot run in the product's use), each with a one-line reason. A ruled
survivor is an `advisory` finding (`M-<n>`; minor, outside the two-minor cap); one with no ruling, or
a ruling without a reason, is a `major` finding (with a trigger and a consequence) that goes to fix.

The repository's own agent instructions (`AGENTS.md`, `CLAUDE.md`) reach every agent anyway; the
profile carries only what a stage prompt must name explicitly.

## How to launch

1. **Worktree** — `git worktree add ../wt-<name> -b wf/<name> <branch>`, when another session may be
   committing to the branch.
2. **Baseline** — run each gate of `profile.gates` in the worktree; its summary line, and any failure
   already there with its cause, becomes `args.baseline[<its name>]`. Without `profile.gates` the run
   discovers the gates and measures the baseline itself; copy the result's `gates` into the profile.
3. **Run** — `Workflow({scriptPath: '<tools>/.claude/workflows/ticket-tdd.js', args})`; the project's specifics come in `args.profile`, never in a wrapper script. A launch by `name` runs the scripts as they were at session start, not as on disk.
4. **After** — check every lens returned a verdict and `failures` is empty; read the commits; re-run the
   gates; fast-forward the branch; free the run directory (`git worktree prune`, then delete every
   directory under `run`, keeping its top-level files); remove the worktree.

## Stages

### 0. Gates discovery

Only when `profile.gates` is absent, before research: one agent (`gates:discover`, `models.gates`, the
no-code preamble plus the long-command rule) finds the project's gates — in the repository's agent instructions, then CI config,
then the task runner; the first source that names gates wins. A gate is a command CI or those
instructions require before a commit; it runs with no human, network or secrets, passes or fails by exit
code and writes nothing to the tree. It runs each one once on the base tree, exactly as its `command`
reads; one that cannot run that way there becomes a question, not a gate. It returns `gates[]`
`{name, command, source, line}` and `questions[]` `{command, source, question}` for the commands it is
unsure of, `source` being the source of the gate a question bears on. The script uses `gates` as the profile's gates and each `line` as that gate's baseline. A
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
  characters, schema-forced) naming the part of the code it acts on and every tool, symbol and file involved,
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
id nor `general` are dropped (`dropped_facts` in the result); requirements no fact cites are listed in
`unresearched_requirements`. `test_harness` keeps the first entry per requirement and drops entries naming
an unknown id. Each repair, and each requirement with no `test_harness` entry, is reported in
`research_issues`, not `failures`: the run goes on, and a requirement with no case still meets the coverage
check. `files[]` is derived from the `where` of the `code` and
`change-site` facts. The checked JSON is pasted into every later prompt, with the rule to start from the
`change-site` facts and read only the lines a stage changes or verifies; no stage edits it.

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
an exit code) gets a phrase row, tested at its requirement's seam when no case covers it; then the
deliverable is called the way its consumer calls it and fed every input, mode and data file the ticket
names; what was not run that way is listed in `unverified`, an empty list being a claim that all of it was.
Report: `head`, `checks`, `unverified`, `questions`, notes.

**Checks.** One row per case (`ref`: its id) and per boundary phrase (`ref`: the ticket's words, quoted),
`{kind: case|phrase, ref, requirement, test?: {file, name}, unverified?}`, each with a `test` or an
`unverified` reason (the schema enforces one). The script adds `case <id>: no check reported` to
`unverified` for each case with no `case` row, and `<ref>: <reason>` for each row with `unverified`; the
checklist lens gets the whole list. Whether every boundary phrase has a row is left to that lens.

**Questions.** `{requirement, question, reading, settles: owner|plan}`: `plan` when the plan contradicts the
ticket and the implementer followed the ticket, `owner` when the ticket leaves it open or it needs a
redesign or an architecture decision, which the implementer reports and leaves. One for an unknown
requirement is dropped with a log line. They go to the result as `implement_questions` and to no stage.

**If implementation made no commit** — `head` still at `base` — the stage runs once more, told that the
previous attempt made no commit and given its notes; a second such result ends the run as `failed`
before any review.

### 4. Gates

One agent, run once per HEAD, before the lenses of its round, and skipped when HEAD has not changed
since the last gates step (implement and every fix report `head`). It only executes, read-only, under the
no-code preamble plus the long-command rule: it runs every gate `profile.gates` declares (listed in its
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

### 5. Review × n

Two lenses in parallel — checklist (every requirement id but the `verify_launch` ones, every `verify_review` requirement) and code
(would it execute, is each assert falsifiable, is any test weakened or vacuous, `profile.code_rules`; it also rules on the mutation survivors, above).
A diff with no production file gets one checked row saying so from the code lens.

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

**Mutation cannot be skipped silently.** The mutation step reports whether the tool applied and ran; one
that applied and did not run, or a dead step, lands in `failures`.

Every review stage (the lenses, the fix-diff review, the mutant ruling) gets the preamble of the stages
that write no code: no commit rules, no gate list. Each round the lenses also receive every finding of
the earlier rounds with its outcome — `fixed`, or `rejected` with the fixer's `argument`; a rejected
finding is raised again only as a finding whose `problem` answers that argument.

**Severity is `major` or `minor`.** `major` is a concrete defect in this diff with a `trigger` (a
reachable input or path) and a `consequence` (what breaks); everything else is `minor`. The script turns a
major with an empty `trigger` into a minor and keeps at most two minors per lens. Minors go to `advisory`: never sent to the round's
fix, never holding a round open; the minor fix after the rounds applies the cheap ones. One root cause is one finding; a closed finding is not restated
as a broader risk; from round 2 a new finding on code the last fix did not change says why it was
missed.

**Proof is optional.** A code-lens major about behaviour may carry `proof: {path, command, red}`: a
test the lens wrote as a new, uncommitted file in the repository's test directory, the command it ran
and the output line that showed it red on HEAD. A proof on any other source's finding is not sent to a
fix and is a stray (below).

**Silence is not clean.** Every reviewer returns `checked` rows — item plus the artifact that settled
it. No rows or a `verdict` that disagrees with the findings reads as `SILENT` in `verdicts` and lands in
`failures`. A round with a dead or silent lens is
not clean and cannot end the loop.

### 6. Fix

Verify before agreeing and before disagreeing; a fix that does not fit is rejected with an argument
citing code, the ticket or the spec, and returns to the next round. Never delete the thing a finding is
about. Findings are grouped by root cause and each cause fixed once, and closed on every other path
the same failure could take. From round 2 the agent sees the
earlier rounds' fixes, and a cause already fixed twice is rejected as "recurs after two fixes: needs a
split or the user" rather than patched a third time. The fix reports its `head` (the script's once-per-HEAD check reads it).

**Proofs.** A finding with a proof reaches the fix with it. The fix runs its command first: green on HEAD
is a valid rejection ("proof green"); a red proof is rejected only with an argument against the test.
Every proof is rewritten into the suite in its style and committed, or deleted, and reported in `proofs`
(`{id, path, outcome: rewritten|deleted}`). A proof on a minor goes to the minor fix, which deletes it. A
sent proof the fix reports by neither id nor path, and a proof no fix was sent (its fix died, the run
stopped), is a stray: a `{id, path}` row in `stray_proofs` and, at the end of the run, one `failures`
entry each (so a stray never skips the minor fix).

**The fix-diff review.** The last round's fix gets one reviewer (`review:fix:r<n>`) on `git diff <head before the fix>..HEAD` only: is each given finding fixed or rightly
rejected, does the diff break a sibling path, is a test weakened, deleted or vacuous. Its majors after the
last round get one more fix (`fix:r<n>:review`) and one more fix-diff review; what is still found is left
over as `unverified`. `extra_rounds` instead adds full rounds.

### 6b. Minor fix

One agent (`models.fix`) after the rounds and the mutation step, skipped when
there is no minor finding or a stage failed. It applies each advisory finding whose fix is cheap (a few
lines in files the run changed, no new test file, no change of design), rejects the rest with a reason,
reruns the gates and reverts when one got worse; no fix-diff review follows it. Ruled survivors are not sent. Applied findings leave
`advisory`; the result's `minor_fixes` lists what it applied and rejected.

### Loop exit

```
loop:
  round += 1
  gates (every gate), if HEAD changed since the last gates step; then in parallel the lenses, given its rows
  findings = gates findings + review(round, earlier findings), minors set aside
  if no findings and every lens answered and round >= min_rounds:
    if the tool ran: break
    mutation step, rule the survivors (ruled ones set aside); none to fix: break
    findings = unruled survivors; if round == n: n += 1
  if findings and round == n and extra rounds left: n += 1
  if findings: fix; a sent proof it does not report is a stray
  if round == n: fix-diff review of the fix (majors: one more fix and review, then leftover);
    gates once more if the fix moved HEAD (its red gates are leftover); break
after the loop: the tool once if it has not run (unless a fix died); unruled survivors are leftover;
minor fix (deletes the proofs on minors); every proof no fix was sent is a stray; strays become failures
```

## Mailbox

The main thread can clarify a running ticket without stopping it. `<run>/mailbox.md` is written by the
main thread only, append-only while the run is live:

```
## m3
to: review:*:code
round: 2
until: fix
supersedes: m1
The 16-fixture sweep must include 8 jobs.
```

- `to:` is `all`, a stage (`research`, `plan`, `replan`, `implement`, `gates`, `review`, `fix`, `mutation`), an exact
  label (`review:r2:code`), or a label pattern where `*` matches one segment. Every agent is told its
  label and reads the entries addressed to it at start, before each long gate run, before committing and
  before returning.
- `until:` (a stage or round) expires an entry; `supersedes: <id>` kills an older one. Agents skip
  expired and superseded entries.
- An agent never edits `mailbox.md` (parallel lenses would race). It appends a receipt line
  `<id> <label> applied|rejected <why>` to `<run>/mailbox-acks.md` and lists the entry in its result's
  `mailbox` field. An entry for one exact label is closed by that label's receipt; entries for `all`, a
  stage or a pattern stay open until the main thread closes them.
- Cleanup is the main thread's: it moves closed, expired and superseded entries to
  `<run>/mailbox-archive.md`, so `mailbox.md` holds only live entries, and archives everything when the
  run ends. A new run's directory starts with no mailbox.
- An entry for a stage that has already run is not seen; post it again to the stage that comes next.
- Entries clarify the ticket; they never widen it. A change of scope is a new ticket.

## Result

`{status, rounds_planned, rounds_run, rounds[] (major/minor, applied, rejected, `gates`: the rows of the gates step that gated the round's HEAD, `recheck`: those of the step after the last fix),
verdicts, mutation (the tool's result, at most one),
gates (the gates used: declared, or discovered with their source and baseline line), gates_questions (the discovery step's questions; empty when the profile declared the gates),
uncovered_requirements (test ids no case covers), dropped_facts, unresearched_requirements, research_issues, research_questions, plan_questions, implement_questions, verify_launch (`{requirement, how}` each, a notice that does not change `status`), verify_review, unverified, leftover_findings, advisory, minor_fixes, stray_proofs (`{id, path}` of each proof no fix accounted for),
implement (`{checks, notes}`), mailbox (every receipt, with its agent label), failures}`. `status` is `done_with_failures`
when `failures` is not empty, else `done_unverified` when `unverified` (implement's list with its check rows folded in) is not empty,
else `done`. `leftover_findings` also holds every requirement not `met` after the last round; `leftover_findings` and `advisory` hold each finding once: a survivor by file, line text and mutated text, any other finding by source, place and problem, not by its positional id. A run that returns no findings has not necessarily been reviewed: a
lens killed by an API error reads as `DIED` in `verdicts`, one that answered without evidence as `SILENT`.

## Testing the core

`test_ticket_tdd.mjs` (beside this file; run by hand with `node --test`, no dependency) evaluates
`ticket-tdd.js` as an async function with a stub `agent()` that returns recorded results keyed by label,
and checks what the script does with them: `tidy`, survivor rulings, checklist statuses, the
deduplicated leftover, the run status, and that the lenses start after the gates step and get its
rows. A change to the core's control flow gets a case there.

## Template

`template/` renders this core from `ticket-tdd.js.tmpl` and a config, for the ablation study. The core
stays hand-written; the template follows it, and `test_render.mjs` fails when the default config does
not render the core byte for byte, so a change to `ticket-tdd.js` is made in the template too.

A config is JSON whose keys are the variant dimensions; it names only what it changes, each key merging
over `default.json`:

- `models`: the default model per stage (`research`, `planner`, `implement`, `gates`, `review`, `fix`).
- `lenses`: the review lenses, a list from `checklist` and `code`; a config's list replaces the default's.
- `duties`: `test_case_review` (on: the weakened-test sentence in the code lens and the fix review) and
  `order` (off; on adds a draft sentence to the code lens, marked "experiment draft" for the experiments
  to settle: any two paths that change one piece of state within one unit of processing, in both orders
  and repeated). A key the default does not name, in `models` or `duties`, is an error.

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
round's results in the case. `--json` prints `{ prompt, schema, model, effort }`: the call that agent
gets, which the ablation suite (`ablation/README.md` in the wf-ablation repo) hands to headless Claude Code.

### Adding a variant dimension

1. Put a `{{name}}` slot in `ticket-tdd.js.tmpl` where the text varies, inside one line when it can,
   so a key changes only the lines it controls.
2. Add the key to `default.json` with the value that renders today's core; a new duty is off by default.
3. Fill the slot in `render()`. Text that goes inside a prompt's template literal passes through
   `literal()`.
4. Add a test beside T03-T06: the key changed alone changes exactly the lines it controls.
   T01 must still pass.

A new lens also needs its entry in the template's `LENSES` and its name in `render.mjs`'s `LENSES`.

## Changing the prompts

**Prompts are code.** Every word in a stage prompt or a skill is paid on every call of that stage. A
commit that edits one states the size change in bytes. When an agent keeps making the wrong move, fix
the schema, the check or the input it is given — the thing that let it make that move — before adding
one more sentence telling it not to.

**Discipline is not a fix.** After a fix, ask: had it existed six months ago, could today's failure
still have arrived by another path? If a class of defect already has two written rules and comes back,
a third rule is not the answer: the fix is a check, a schema field or a deleted duplicate. Prefer
removing the surface the defect lives on to adding a gate over it. The same question is put to the fix
stage about the code.

## Dependencies

`workflow-doctor.sh` checks them and exits 1 on anything missing; `--help` says why each is needed.
