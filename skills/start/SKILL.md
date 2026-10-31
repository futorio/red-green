---
name: start
description: Run the red-green workflow on a ticket or spec file of the current project, from worktree to fast-forward. Use when the user asks to implement, run or start a ticket or spec with red-green.
---

# Start a red-green run

You are the main thread: you prepare the run, launch it, accept it and report. The user names only the ticket.

`<core>` is the red-green checkout: `readlink -f` of this skill's base directory, two levels up. The core's docs are
`<core>/docs/red-green/`; read a chapter when a step names it.

## 1. Inputs

- `target`: the ticket or spec path the user named. No path given: ask for it.
- `<name>`: a short slug of the ticket's file name.
- `<branch>`: the branch the user is on; `base`: its HEAD.
- `run`: a fresh scratchpad directory.
- The caller: the project's profile workflow `.claude/workflows/red-green-*.js` when the project has one, else the
  core itself with `profile` built from what the user asked for (default `{}`;
  [`args-and-profile.md`](../../docs/red-green/args-and-profile.md)).

Done when every arg in `args-and-profile.md`'s required rows has a value or a step below that gives it.

## 2. Worktree

`git worktree add ../wt-<name> -b wf/<name> <branch>`. `repo` is its absolute path, `branch` is `wf/<name>`. Copy or
symlink into it any gitignored file the project's gates need.

## 3. Baseline

Run each declared gate (`profile.blocks.gates.gates`) in the worktree. Its summary line, and any failure already there
with its cause, becomes `args.baseline[<gate name>]`. No declared gates: skip; the run discovers them and their
baseline.

Done when `baseline` has an entry per declared gate.

## 4. Run

Launch by `scriptPath`, which reads the scripts from disk (a launch by `name` runs them as they were at session
start):

- core: `Workflow({scriptPath: '<core>/.claude/workflows/red-green.js', args: {target, repo, branch, tools: '<core>', run, base, baseline, profile}})`;
- profile workflow: `Workflow({scriptPath: '<project>/.claude/workflows/red-green-<x>.js', args: {...the same, without profile}})`.

The run goes on in the background. A detail the user adds meanwhile goes to the run's mailbox
([`mailbox.md`](../../docs/red-green/mailbox.md)); the run is never stopped to add one.

## 5. Accept

1. Save the spans: `node <core>/.claude/workflows/red-green/trace.mjs <wf dir> > <run>/trace.jsonl`
   ([`tracing.md`](../../docs/red-green/tracing.md)).
2. Read the result ([`result.md`](../../docs/red-green/result.md)): `verdicts` holds no `DIED` or `SILENT`, and
   `failures` is empty.
3. Read every commit on `wf/<name>` and re-run the gates in the worktree.
4. Green, and the user did not ask to hold: fast-forward `<branch>` to `wf/<name>`. Otherwise leave both branches and
   say why.
5. Free the run directory (`git worktree prune`, then delete every directory under `run`, keeping its top-level files,
   `trace.jsonl` among them) and remove the worktree.

Done when the branch is fast-forwarded or the reason it is not is in the report.

## 6. Report

To the user: `status`, the commits, `leftover_findings`, `verify_launch` (checks only a person can make), the open
questions per stage, and the tokens per block from `trace.mjs --table`.
