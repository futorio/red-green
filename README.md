# ticket-tdd: research, TDD, review loop

A Claude Code Workflow that takes one ticket or spec and hands back commits on a branch: implemented test-first,
reviewed and fixed. Each step is a separate agent whose output the script checks, so a run cannot quietly skip tests,
drop a requirement or finish with red gates.

- **Tests planned before code.** Research lists the ticket's requirements; the planner turns each into test cases, and
  a requirement no case covers sends the plan back, then shows up in the result instead of vanishing.
- **Reviewed until clean.** Two review lenses, one against the ticket and one on the code, run for at least two rounds;
  a fix agent answers every finding, and mutation testing checks the new tests actually catch broken code.
- **Configurable down to each prompt.** Every stage is a block you tune (model, rounds, gates, mutation tool) or replace
  with your own prompt or skill, or start from a ready preset: `standard`, `hard`, `cheap`. Nothing is copied into the
  project, and every run can leave a trace of time and tokens per stage.

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
2. Open Claude Code in the project and say:

   ```
   Run the ticket-tdd workflow from <core> on <ticket path>; follow <core>/docs/ticket-tdd/launch.md.
   ```

   The agent makes a worktree, measures the project's gates, starts the run and waits for it. Something to add while
   it runs: tell the agent, it passes it on ([`mailbox.md`](docs/ticket-tdd/mailbox.md)).
3. When the run ends, the agent reports the commits, any finding left over and the checks only a person can make
   (launching the app, say). It fast-forwards your branch once its own checks pass; anything you do not like, ask it
   to fix in the same chat.

To fit the run to the project, configure its stages (model, rounds, gates, mutation tool, your own prompt or skill)
or pick a model preset: [`args-and-profile.md`](docs/ticket-tdd/args-and-profile.md),
[`blocks.md`](docs/ticket-tdd/blocks.md). Without any of it the run discovers the project's gates itself.

## Shape

In the order a run takes them ([`stages.md`](docs/ticket-tdd/stages.md) has each in detail):

1. **Gates discovery**, only when the profile declares no gates.
2. **Research**: the ticket's requirements and the facts of the code.
3. **Planning**: test cases for each requirement, then the coverage check.
4. **Implementation**, test-first.
5. **Review rounds**, `blocks.review.rounds` of them (2 by default). Each round: gates (when HEAD changed), both review
   lenses, then a fix.
   - **Mutation** runs after the first clean round at or past `blocks.review.min`; its survivors get one more round. A
     run that ran out of rounds first does it after the loop.
   - The last round's fix gets a review of its own diff, when it moved HEAD.
6. **Minor fix**.

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
