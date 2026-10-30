# ticket-tdd: research, TDD, review loop

A Workflow run that implements one ticket or one spec in any git repository. The script is
`.claude/workflows/ticket-tdd.js`; `.claude/workflows/ticket-tdd/` holds what its agents read and run (`skills/`,
the mutant runner [`skills/mutate.mjs`](../../.claude/workflows/ticket-tdd/skills/mutate.mjs)) and `workflow-doctor.sh`. This repository is the one shared copy: projects run
it in place, never copy it.

The core knows nothing about any one project. What a project adds (gates, rules, mutant commands) arrives in
`args.profile`. The project's profile workflow is the only caller: it holds `args.profile` and nothing else, and calls
`workflow({ scriptPath: '<core>/.claude/workflows/ticket-tdd.js' }, {...args, tools: '<core>', profile})`, `<core>`
being this repository's absolute path.

## Shape

Numbered as in [`stages.md`](stages.md): 0 gates discovery (no declared gates), 1 research, 2 planning, 3
implementation, then rounds of 4 gates, 5 review and 6 fix, the last round's fix reviewed once more when it moved HEAD.
6a mutation runs inside the loop, after the first clean round at or past `blocks.review.min`; survivors get one more
round (a loop that ran out of rounds runs it after the loop). 6b minor fix comes last.

## How to launch

1. **Worktree**: `git worktree add ../wt-<name> -b wf/<name> <branch>`, when another session may commit to the branch.
2. **Baseline**: run each gate of `profile.blocks.gates.gates` in the worktree; its summary line, and any failure
   already there with its cause, becomes `args.baseline[<its name>]`. Without declared gates the run discovers them and
   the baseline; copy the result's `gates` into the profile.
3. **Run**: start the profile workflow with the args ([`args-and-profile.md`](args-and-profile.md)). A launch by `name`
   runs the scripts as they were at session start.
4. **After**: `verdicts` holds no `DIED` or `SILENT` and `failures` is empty; read `leftover_findings` and
   `verify_launch`, then the commits; re-run the gates; fast-forward `<branch>` to `wf/<name>`; free the run directory
   (`git worktree prune`, then delete every directory under `run`, keeping its top-level files); remove the worktree.

Clarifications: [`mailbox.md`](mailbox.md).

## Chapters

- [`args-and-profile.md`](args-and-profile.md): `args`, `profile`, model presets.
- [`stages.md`](stages.md): what the script does with each stage's output.
- [`blocks.md`](blocks.md): block contract, plug-ins, conformance check.
- [`mailbox.md`](mailbox.md): clarifying a live run.
- [`result.md`](result.md): the result's fields.
- [`tracing.md`](tracing.md): `trace.mjs`.
- [`maintaining.md`](maintaining.md): tests, template, new blocks and fields, prompts.
