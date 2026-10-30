# ticket-tdd: research, TDD, review loop

A Claude Code Workflow that takes one ticket or spec and hands back commits on a branch: implemented test-first,
reviewed and fixed. Each step is a separate agent whose output the script checks, so a run cannot quietly skip tests,
drop a requirement or finish with red gates.

- **Tests planned before code.** Research lists the ticket's requirements; the planner turns each into test cases, and
  a requirement no case covers sends the plan back, then shows up in the result instead of vanishing.
- **Reviewed until clean.** Two review lenses, one against the ticket and one on the code, run for at least two rounds;
  a fix agent answers every finding, and mutation testing checks the new tests actually catch broken code.
- **Any project, one shared copy.** Your gates, rules and models come in a profile; nothing is copied into the project,
  and every run can leave a trace of time and tokens per stage.

## Install

1. Clone this repository anywhere; its absolute path is `<core>`. Nothing is copied into a project. Pin a version by
   checking out a tag or commit.
2. Run `<core>/.claude/workflows/ticket-tdd/workflow-doctor.sh`: it checks `claude` and `git`, and lists what to confirm
   by hand (the Workflow tool on the account, the opus, sonnet and haiku models).
3. Node runs the mutant runner `skills/mutate.mjs` during a run, and `trace.mjs` after one; the doctor does not
   check it.

## Getting started

1. Write the ticket or spec in the project, a markdown file; its path is `args.target`. It works best with tickets
   from [mattpocock/skills](https://github.com/mattpocock/skills): `grill-me`, then `to-spec`, then `to-tickets`.
   Any other task statement works too.
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
3. In the project's Claude Code chat, ask: "run ticket-tdd from `<core>` on `<ticket path>`". The agent does the
   rest ([`launch.md`](docs/ticket-tdd/launch.md)): a worktree, the gates' baseline, the run, its checks, the branch
   fast-forward. You read what it reports: the commits and any finding left over.

## Shape

Numbered as in [`stages.md`](docs/ticket-tdd/stages.md): 0 gates discovery (no declared gates), 1 research, 2
planning, 3 implementation, then rounds of 4 gates, 5 review and 6 fix, the last round's fix reviewed once more when it
moved HEAD. 6a mutation runs inside the loop, after the first clean round at or past `blocks.review.min`; survivors get
one more round (a loop that ran out of rounds runs it after the loop). 6b minor fix comes last.

## Docs

- [`launch.md`](docs/ticket-tdd/launch.md): the agent's steps around a run.
- [`args-and-profile.md`](docs/ticket-tdd/args-and-profile.md): `args`, `profile`, model presets.
- [`stages.md`](docs/ticket-tdd/stages.md): what the script does with each stage's output.
- [`blocks.md`](docs/ticket-tdd/blocks.md): block contract, plug-ins, conformance check.
- [`mailbox.md`](docs/ticket-tdd/mailbox.md): clarifying a live run.
- [`result.md`](docs/ticket-tdd/result.md): the result's fields.
- [`tracing.md`](docs/ticket-tdd/tracing.md): `trace.mjs`.
- [`maintaining.md`](docs/ticket-tdd/maintaining.md): tests, template, new blocks and fields, prompts.

The workflow is measured in the separate `~/projects/wf-ablation` repository, which runs against this checkout through
`TICKET_TDD_CORE`.
