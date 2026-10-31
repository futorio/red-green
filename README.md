# red-green: research, TDD, review loop

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

1. Clone this repository anywhere; its absolute path is `<core>`. The repository is a plugin marketplace, and the
   plugin loads in place from it. Pin a version by checking out a tag or commit.
2. In the project, add the marketplace and install the plugin with project scope:

   ```sh
   claude plugin marketplace add --scope project <core>
   claude plugin install --scope project red-green@red-green
   ```

   The project's sessions then have the workflow `/red-green:red-green` and the skills `/red-green:setup` and `/red-green:start`.
3. Run `<core>/.claude/workflows/red-green/workflow-doctor.sh`: it checks `claude` and `git`, and lists what to confirm
   by hand (the Workflow tool on the account, the opus, sonnet and haiku models).
4. Node runs the mutant runner `skills/mutate.mjs` during a run, and `trace.mjs` after one; the doctor does not
   check it.

## Getting started

1. Write the ticket or spec in the project, a markdown file; its path is `args.target`. It works best with tickets
   from [mattpocock/skills](https://github.com/mattpocock/skills): `grill-me`, then `to-spec`, then `to-tickets`.
   Any other task statement works too.
2. Once per project, run `/red-green:setup` ([`SKILL.md`](skills/setup/SKILL.md)): it reads the project's CI, build
   and rule files, lets you pick the gates, code rules and model preset, and writes `.claude/red-green/profile.json`.
   It runs none of the project's commands; run it again to change the profile.
3. Open Claude Code in the project and run `/red-green:start <ticket path>`
   ([`SKILL.md`](skills/start/SKILL.md)). The agent checks the profile file, makes a worktree, measures the project's
   gates and their seconds, starts the run and waits for it. Something to add while
   it runs: tell the agent, it passes it on ([`mailbox.md`](docs/red-green/mailbox.md)).
4. When the run ends, the agent reports the commits, any finding left over and the checks only a person can make
   (launching the app, say). It fast-forwards your branch once its own checks pass; anything you do not like, ask it
   to fix in the same chat.

To fit the run to the project, configure its stages (model, rounds, gates, mutation tool, your own prompt or skill)
or pick a model preset: [`args-and-profile.md`](docs/red-green/args-and-profile.md),
[`blocks.md`](docs/red-green/blocks.md). Without any of it the run discovers the project's gates itself.

## Shape

In the order a run takes them ([`stages.md`](docs/red-green/stages.md) has each in detail):

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

- [`args-and-profile.md`](docs/red-green/args-and-profile.md): `args`, `profile`, model presets.
- [`stages.md`](docs/red-green/stages.md): what the script does with each stage's output.
- [`blocks.md`](docs/red-green/blocks.md): block contract, plug-ins, conformance check.
- [`mailbox.md`](docs/red-green/mailbox.md): clarifying a live run.
- [`result.md`](docs/red-green/result.md): the result's fields.
- [`tracing.md`](docs/red-green/tracing.md): `trace.mjs`.
- [`maintaining.md`](docs/red-green/maintaining.md): tests, template, new blocks and fields, prompts.

The workflow is measured in the separate `~/projects/wf-ablation` repository, which runs against this checkout through
`TICKET_TDD_CORE`.
