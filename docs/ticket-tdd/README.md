# ticket-tdd — research → TDD → review loop

A Workflow run that implements **one ticket or one spec** in any git repository. The script is
`.claude/workflows/ticket-tdd.js`; `.claude/workflows/ticket-tdd/` holds what its agents read and run (`skills/`, the mutant
runner `mutate.mjs` among them) and
`workflow-doctor.sh`. This repository is the one shared copy: projects run it in place, never copy it.
The core knows nothing about any one project: what a project adds — its gates, its rules, the commands
its mutants run under — arrives in `args.profile`, from a small profile workflow in the project that calls
`workflow({ scriptPath: <core>/.claude/workflows/ticket-tdd.js }, {...args, tools: <core>, profile})`,
with `<core>` this repository's absolute path, given to the profile as an arg.

Moved out of touhou8-multiplayer at its commit `fac5910` (its ADR 0007); history before that is there.

## Shape

1. Gates discovery (optional).
2. Research.
3. Test-case planning, coverage check, implementation.
4. A round, `n` times: gates, review, fix.
5. Fix-diff review.
6. Mutation (optional).
7. Minor fix.

Every run plans test cases, reviews with both lenses for two full rounds, and runs the mutation step
when `blocks.mutation` has a `test` or a `tool`. `n` is `blocks.review.rounds`, 2 by default. The gates step runs only when HEAD changed since the last
one, and runs before the lenses of its round, which get its rows. The last round's fix, which no full round follows, gets a
review of its own diff. Freeing the run directory is the main thread's step after acceptance.

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

**A clarification mid-run** — create `<run>/mailbox.md` starting with the header in `mailbox.md`, verbatim, then
append entries; agents follow only the rules that header carries.

## Chapters

- `args-and-profile.md`
- `stages.md`
- `blocks.md`
- `mailbox.md`
- `result.md`
- `tracing.md`
- `maintaining.md`
