# ticket-tdd: research, TDD, review loop

A Workflow run that implements one ticket or one spec in any git repository. The script is
`.claude/workflows/ticket-tdd.js`; `.claude/workflows/ticket-tdd/` holds what its agents read and run (`skills/`,
the mutant runner `skills/mutate.mjs`) and `workflow-doctor.sh`. This repository is the one shared copy: projects run
it in place, never copy it.

The core knows nothing about any one project. What a project adds (gates, rules, mutant commands) arrives in
`args.profile`, from a small profile workflow in the project that calls
`workflow({ scriptPath: <core>/.claude/workflows/ticket-tdd.js }, {...args, tools: <core>, profile})`, `<core>` being
this repository's absolute path.

## Shape

1. Gates discovery, only when the profile declares no gates.
2. Research.
3. Test-case planning and its coverage check, then implementation.
4. Rounds, `n` times (`blocks.review.rounds`, 2 by default): gates, both review lenses, fix. The gates step runs only
   when HEAD changed, and the lenses get its rows.
5. Review of the last round's fix diff, which no full round follows.
6. Mutation, when `blocks.mutation` has a `test` or a `tool`.
7. Minor fix.

## How to launch

1. **Worktree**: `git worktree add ../wt-<name> -b wf/<name> <branch>`, when another session may commit to the branch.
2. **Baseline**: run each gate of `profile.blocks.gates.gates` in the worktree; its summary line, and any failure
   already there with its cause, becomes `args.baseline[<its name>]`. Without declared gates the run discovers them and
   the baseline; copy the result's `gates` into the profile.
3. **Run**: `Workflow({scriptPath: '<tools>/.claude/workflows/ticket-tdd.js', args})`, the project's specifics in
   `args.profile`, never in a wrapper script. A launch by `name` runs the scripts as they were at session start.
4. **After**: check every lens returned a verdict and `failures` is empty; read the commits; re-run the gates;
   fast-forward the branch; free the run directory (`git worktree prune`, then delete every directory under `run`,
   keeping its top-level files); remove the worktree.

A clarification mid-run goes in `<run>/mailbox.md`, started with the header in `mailbox.md`, verbatim.

## Chapters

- `args-and-profile.md`: `args`, `profile`, model presets.
- `stages.md`: what the script does with each stage's output.
- `blocks.md`: block contract, plug-ins, conformance check.
- `mailbox.md`: clarifying a live run.
- `result.md`: the result's fields.
- `tracing.md`: `trace.mjs`.
- `maintaining.md`: tests, template, new blocks and fields, prompts.
