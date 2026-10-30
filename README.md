# ticket-tdd: research, TDD, review loop

A Workflow run that implements one ticket or one spec in any git repository. The script is
`.claude/workflows/ticket-tdd.js`; `.claude/workflows/ticket-tdd/` holds what its agents read and run (`skills/`,
the mutant runner [`skills/mutate.mjs`](.claude/workflows/ticket-tdd/skills/mutate.mjs)) and `workflow-doctor.sh`.
This repository is the one shared copy: projects run it in place, never copy it. Pin a version by checking out a tag or
commit; a project's `docs/agents/ticket-workflow.md` records the commit its profile was rendered against.

The core knows nothing about any one project. What a project adds (gates, rules, mutant commands) arrives in
`args.profile`. Two callers, `<core>` being this repository's absolute path:

- the main thread, from the chat: `Workflow({scriptPath: '<core>/.claude/workflows/ticket-tdd.js', args})`;
- the project's profile workflow, which holds only the profile and calls
  `workflow({ scriptPath: '<core>/.claude/workflows/ticket-tdd.js' }, {...args, tools: '<core>', profile})`.

## Install

1. Clone this repository anywhere; its absolute path is `<core>`. Nothing is copied into a project.
2. Run `<core>/.claude/workflows/ticket-tdd/workflow-doctor.sh`: it checks `claude` and `git`, and lists what to confirm
   by hand (the Workflow tool on the account, the opus, sonnet and haiku models).
3. Node runs the mutant runner `skills/mutate.mjs` during a run, and `trace.mjs` after one; the doctor does not
   check it.

## Getting started

1. Write the ticket or spec in the project, a markdown file; its path is `args.target`.
2. Optional, once per project: a profile workflow `.claude/workflows/ticket-tdd-<project>.js` with the project's
   gates and rules ([`args-and-profile.md`](docs/ticket-tdd/args-and-profile.md)):

   ```js
   export const meta = {
     name: 'ticket-tdd-<project>',
     description: 'ticket-tdd with this repository\'s profile',
     whenToUse: 'Implement a ticket or spec of this repository',
   }
   const PROFILE = {
     commit: 'follow docs/agents/commits.md',
     blocks: { gates: { gates: [{ name: 'tests', command: 'npm test' }] } },
   }
   // scriptPath, not a call by name: the core is read from disk, not from the session-start snapshot.
   return await workflow({ scriptPath: args.tools + '/.claude/workflows/ticket-tdd.js' }, { ...args, profile: PROFILE })
   ```

   Without it, the main thread passes `profile` in the args itself, and a run with no declared gates discovers them.
3. Ask the main thread in the project's chat to run the ticket per [How to launch](#how-to-launch), naming `<core>`
   and the ticket path.

## Shape

Numbered as in [`stages.md`](docs/ticket-tdd/stages.md): 0 gates discovery (no declared gates), 1 research, 2
planning, 3 implementation, then rounds of 4 gates, 5 review and 6 fix, the last round's fix reviewed once more when it
moved HEAD. 6a mutation runs inside the loop, after the first clean round at or past `blocks.review.min`; survivors get
one more round (a loop that ran out of rounds runs it after the loop). 6b minor fix comes last.

## How to launch

1. **Worktree**: `git worktree add ../wt-<name> -b wf/<name> <branch>`, when another session may commit to the branch.
2. **Baseline**: run each gate of `profile.blocks.gates.gates` in the worktree; its summary line, and any failure
   already there with its cause, becomes `args.baseline[<its name>]`. Without declared gates the run discovers them and
   the baseline; copy the result's `gates` into the profile.
3. **Run**: by either caller above, with the args ([`args-and-profile.md`](docs/ticket-tdd/args-and-profile.md)). A
   launch by `name` runs the scripts as they were at session start.
4. **After**: save the spans, `node <core>/.claude/workflows/ticket-tdd/trace.mjs <wf dir> > <run>/trace.jsonl`
   ([`tracing.md`](docs/ticket-tdd/tracing.md)); `verdicts` holds no `DIED` or `SILENT` and `failures` is empty; read
   `leftover_findings` and `verify_launch`, then the commits; re-run the gates; fast-forward `<branch>` to `wf/<name>`;
   free the run directory (`git worktree prune`, then delete every directory under `run`, keeping its top-level files);
   remove the worktree.

Clarifications: [`mailbox.md`](docs/ticket-tdd/mailbox.md).

## Docs

- [`args-and-profile.md`](docs/ticket-tdd/args-and-profile.md): `args`, `profile`, model presets.
- [`stages.md`](docs/ticket-tdd/stages.md): what the script does with each stage's output.
- [`blocks.md`](docs/ticket-tdd/blocks.md): block contract, plug-ins, conformance check.
- [`mailbox.md`](docs/ticket-tdd/mailbox.md): clarifying a live run.
- [`result.md`](docs/ticket-tdd/result.md): the result's fields.
- [`tracing.md`](docs/ticket-tdd/tracing.md): `trace.mjs`.
- [`maintaining.md`](docs/ticket-tdd/maintaining.md): tests, template, new blocks and fields, prompts.

The workflow is measured in the separate `~/projects/wf-ablation` repository, which runs against this checkout through
`TICKET_TDD_CORE`.
