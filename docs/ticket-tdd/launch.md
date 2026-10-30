# Launching a run

The main thread's steps, the agent in the user's chat; the user only names the ticket.

1. **Worktree**: `git worktree add ../wt-<name> -b wf/<name> <branch>`, when another session may commit to the branch.
2. **Baseline**: run each gate of `profile.blocks.gates.gates` in the worktree; its summary line, and any failure
   already there with its cause, becomes `args.baseline[<its name>]`. Without declared gates the run discovers them and
   the baseline; copy the result's `gates` into the profile.
3. **Run**, with the args ([`args-and-profile.md`](args-and-profile.md)), by one of two callers, `<core>` being the
   ticket-tdd checkout's absolute path:
   - the main thread itself: `Workflow({scriptPath: '<core>/.claude/workflows/ticket-tdd.js', args})`;
   - the project's profile workflow, which holds only the profile and calls
     `workflow({ scriptPath: '<core>/.claude/workflows/ticket-tdd.js' }, {...args, tools: '<core>', profile})`.

   A launch by `name` runs the scripts as they were at session start.
4. **After**: save the spans, `node <core>/.claude/workflows/ticket-tdd/trace.mjs <wf dir> > <run>/trace.jsonl`
   ([`tracing.md`](tracing.md)); `verdicts` holds no `DIED` or `SILENT` and `failures` is empty; read
   `leftover_findings` and `verify_launch`, then the commits; re-run the gates; fast-forward `<branch>` to `wf/<name>`;
   free the run directory (`git worktree prune`, then delete every directory under `run`, keeping its top-level files);
   remove the worktree.

A clarification mid-run: [`mailbox.md`](mailbox.md).
