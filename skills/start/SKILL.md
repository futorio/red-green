---
name: start
description: Run red-green on one ticket or spec of this project, from worktree to fast-forward.
disable-model-invocation: true
---

# Start a red-green run

You are the main thread: you prepare the run, launch it, accept it and report. The user names only the ticket.

`<tools>` is `${CLAUDE_PLUGIN_ROOT}`, the core's checkout.

## 1. Inputs

- `target`: the ticket or spec path the user named. No path given: ask for it.
- `<name>`: a short slug of the ticket's file name.
- `<branch>`: the branch the user is on; `base`: its HEAD.
- `run`: a fresh scratchpad directory.
- `profile`: the contents of the project's profile file `.claude/red-green/profile.json`, else `{}`; the run then
  discovers the gates itself ([`args-and-profile.md`](../../docs/red-green/args-and-profile.md)).

With a profile file, check it: `node <tools>/.claude/workflows/red-green/template/render.mjs --check
.claude/red-green/profile.json`. Exit 1: stop here and give the user the check's stderr and the file's path; the
worktree and the run wait for a profile that passes.

Done when the check exits 0 (or there is no profile file) and every arg in `args-and-profile.md`'s required rows has a
value or a step below that gives it.

## 2. Worktree

`git worktree add ../wt-<name> -b wf/<name> <branch>`. `repo` is its absolute path, `branch` is `wf/<name>`. Copy or
symlink into it any gitignored file the project's gates need.

Done when `repo` has `wf/<name>` checked out at `base` and every gitignored file the gates read is in it.

## 3. Baseline

Run each declared gate (`profile.blocks.gates.gates`) in the worktree, its command's placeholders filled from the args
([`args-and-profile.md`](../../docs/red-green/args-and-profile.md)), and time it. Its summary line, and any failure
already there with its cause, becomes `args.baseline[<gate name>]`. Write `<run>/gates.json` as
`{<gate name>: {seconds, line}}` and give the user a line per gate: name, seconds, summary line. No declared gates:
skip; the run discovers them and their baseline.

Done when `baseline` and `gates.json` have an entry per declared gate, each with its seconds in the report.

## 4. Run

Launch by `scriptPath`, which reads the scripts from disk (a launch by `name` runs them as they were at session
start):

`Workflow({scriptPath: '<tools>/.claude/workflows/red-green.js', args: {target, repo, branch, tools: '<tools>', run, base, baseline, profile}})`

The run goes on in the background. A detail the user adds meanwhile goes to the run's mailbox
([`mailbox.md`](../../docs/red-green/mailbox.md)), and the run keeps going.

Done when the run's result is in.

## 5. Accept

1. Save the spans: `node <tools>/.claude/workflows/red-green/trace.mjs <wf dir> > <run>/trace.jsonl`
   ([`tracing.md`](../../docs/red-green/tracing.md)).
2. Read the result ([`result.md`](../../docs/red-green/result.md)): `verdicts` holds no `DIED` or `SILENT`, and
   `failures` is empty.
3. Read every commit on `wf/<name>` and re-run the gates in the worktree.
4. Green (2 and 3 pass), and the user did not ask to hold: fast-forward `<branch>` to `wf/<name>`. Otherwise leave
   both branches and say why.
5. Remove the worktree (`git worktree remove <repo>`), delete every directory under `run` (keeping its top-level files,
   `trace.jsonl` and `gates.json` among them), then `git worktree prune`.

Done when `trace.jsonl` and `gates.json` are in `run`, `run` holds no directory, the worktree is removed, and the
branch is fast-forwarded or the reason it is not is in the report.

## 6. Report

To the user: `status`, the commits, `leftover_findings`, `verify_launch` (checks only a person can make), the open
questions per stage, and the tokens per block from `trace.mjs --table`.

Done when the report names each of them, `none` where one is empty.
