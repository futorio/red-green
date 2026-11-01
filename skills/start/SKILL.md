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
- `profile`: the contents of the project's profile file `.claude/red-green/profile.json`, else `{}`
  ([`args-and-profile.md`](../../docs/red-green/args-and-profile.md)).

With a profile file, check it: `node <tools>/.claude/workflows/red-green/template/render.mjs --check
.claude/red-green/profile.json`. Exit 1: stop here and give the user the check's stderr and the file's path; the
worktree and the run wait for a profile that passes.

With no declared gates (`profile.blocks.gates.gates` absent or empty), find them here; a run refuses to start without:

1. Find candidates: the repo's agent instructions, then CI config, then the task runner; the first source that names
   gates wins. A gate: a command CI or those instructions require before a commit; runs with no human, network or
   secrets; pass/fail by exit code; writes nothing to the tree.
2. Ask the user to pick and name them, proposing a tier per pick: `fast` a static check that reads the source without
   building it (lint, format check, typecheck); `round` a build, a test suite, or a gate you are unsure of; `acceptance`
   one too heavy to run each iteration. A run needs at least one `fast` or `round` gate.
3. Put the picks in `profile.blocks.gates.gates` as `{name, command, tier}`, for this run only: nothing is written to the
   project unless the user asks.
4. No candidate, or none picked: stop here and offer `/red-green:setup`.

Done when the check exits 0 (or there is no profile file), `profile` declares a `fast` or `round` gate, and every arg in
`args-and-profile.md`'s required rows has a value or a step below that gives it.

## 2. Worktree

`git worktree add ../wt-<name> -b wf/<name> <branch>`. `repo` is its absolute path, `branch` is `wf/<name>`. Copy or
symlink into it any gitignored file the project's gates need.

Done when `repo` has `wf/<name>` checked out at `base` and every gitignored file the gates read is in it.

## 3. Baseline

Measure the `fast` and `round` gates with the runner, from the worktree, with a Bash timeout of 10 minutes:

`node <tools>/.claude/workflows/red-green/skills/run_gates.mjs --gates '<gates as JSON>' --dir <run> --tier round --no-cache`

`<gates as JSON>` is `profile.blocks.gates.gates`, its commands' placeholders filled from the args
([`args-and-profile.md`](../../docs/red-green/args-and-profile.md)). Exit 3: run it again. Exit 2 or a `not_run` row: stop
here and give the user the reason. Each printed row's `status` and `line` become `args.baseline[<gate name>]`. Write
`<run>/gates.json` as `{<gate name>: {seconds, line}}` and give the user a line per gate: name, status, seconds, line.
`acceptance` gates are not measured at base.

Done when `baseline` and `gates.json` have an entry per `fast` and `round` gate, each with its seconds in the report.

## 4. Run

Pick the launch before calling. Only the session's working directory counts for a `scriptPath` launch, not `repo` or an
added directory:

- `<tools>` inside the session's working directory: `Workflow({scriptPath: '<tools>/.claude/workflows/red-green.js', args})`,
  which reads the scripts from disk.
- Any other case, a `<tools>` added with `/add-dir` included: `Workflow({name: 'red-green:red-green-workflow', args})`,
  and tell the user the run uses the scripts as they were at session start.

`args` is `{target, repo, branch, tools: '<tools>', run, base, baseline, profile}` in both.

A refused launch is not retried unchanged.

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
