<p align="center"><img src="docs/assets/logo.svg" width="160" alt="red-green logo"></p>

# red-green: research, TDD, review loop

A Claude Code Workflow that takes one ticket or spec and hands back commits on a branch: implemented test-first,
reviewed and fixed. Each step is a separate agent whose output the script checks, so a run cannot quietly skip tests,
drop a requirement or finish with red gates.

- **Tests planned before code.** Research lists the ticket's requirements; the planner turns each into test cases, and
  a requirement no case covers sends the plan back, then shows up in the result instead of vanishing.
- **Reviewed after every fix.** Two review lenses, one against the ticket and one on the code, run for at least two
  iterations; a fix agent answers every major, and the next iteration reviews it.
- **Property tests where examples fall short.** A claim over a domain too large to list becomes a property case: the
  test runs the property over generated inputs and must reject the wrong outputs the plan names. A project with no
  property framework gets one in the box, the contract CLI, which generates, shrinks and checks the
  `contract: <id>: <statement>` markers. The idea follows Anthropic's
  [property-based testing research](https://www.anthropic.com/research/property-based-testing).
- **Configurable down to each prompt.** Every stage is a block you tune (model, rounds, gates) or replace
  with your own prompt or skill, or start from a ready preset: `standard`, `hard`, `cheap`. Nothing is copied into the
  project, and every run can leave a trace of time and tokens per stage.

## Requirements

- Claude Code with the Workflow tool on the account (it is gated per account) and the opus, sonnet and haiku models.
- `git`: a run works and commits in a worktree of its own.
- `node`: setup and start check the profile, a run runs its gates, start saves the trace.
- Optional: `gh`, for the recent GitHub Actions durations setup shows.

`/red-green:setup` checks the tools with `workflow-doctor.sh` and lists the rest to confirm by hand.

## Install

In the project, add this repository as a marketplace (a catalog the plugin is installed from), then install the
plugin with project scope. Both land in the project's `.claude/settings.json`, so collaborators get the same plugin:

```sh
claude plugin marketplace add --scope project futorio/red-green
claude plugin install --scope project red-green@red-green
```

To pin a version, add `#<tag or branch>` to the repository: `futorio/red-green#<tag>`.

The project's sessions then have the workflow `/red-green:red-green-workflow` and the skills `/red-green:setup`
and `/red-green:start`.

To work on the plugin itself, add a local checkout instead (`marketplace add --scope project /path/to/red-green`); it
loads in place, and an edit reaches a run from the next session. The path means nothing on another machine, so keep
that for yourself.

## Getting started

1. Write the ticket or spec in the project, a markdown file; its path is `args.target`. It works best with tickets
   from [mattpocock/skills](https://github.com/mattpocock/skills): `grill-me`, then `to-spec`, then `to-tickets`.
   Any other task statement works too.
2. Once per project, run `/red-green:setup` ([`SKILL.md`](skills/setup/SKILL.md)): it reads the project's CI, build
   and rule files, lets you pick the gates, code rules and model preset, and writes `.claude/red-green/profile.json`.
   It also adds a `## red-green` section to `CLAUDE.md` or `AGENTS.md`, so the project's sessions know to run
   `/red-green:start`. It runs none of the project's commands; run it again to change the profile.
3. Open Claude Code in the project and run `/red-green:start <ticket path>`
   ([`SKILL.md`](skills/start/SKILL.md)). The agent checks the profile file, asks you to pick the gates if it declares
   none, makes a worktree, measures the project's gates and their seconds, starts the run and waits for it. As research
   and planning end, it shows you their open questions; the run does not wait for answers. Something to add while
   it runs, an answer included: tell the agent, it passes it on ([`mailbox.md`](docs/red-green/mailbox.md)).
4. When the run ends, the agent reports the commits, any finding left over and the checks only a person can make
   (launching the app, say). It fast-forwards your branch once its own checks pass and no major is left over; otherwise
   it asks you. Anything you do not like, ask it to fix in the same chat.

To fit the run to the project, configure its stages (model, rounds, gates, your own prompt or skill)
or pick a model preset: [`args-and-profile.md`](docs/red-green/args-and-profile.md),
[`blocks.md`](docs/red-green/blocks.md). A run needs declared gates; without a profile, `/red-green:start` finds them with you.

## Shape

In the order a run takes them ([`stages.md`](docs/red-green/stages.md) has each in detail):

1. **Research**: the ticket's requirements and the facts of the code.
2. **Planning**: test cases for each requirement, property cases for large domains, then the coverage check.
3. **Implementation**, test-first.
4. **Iterations**, at most `blocks.review.rounds` (3 by default), a number fixed at the start. Each one:
   - **Gates**, run by a script, each one's status its exit code. A red gate goes to a fix and the gates again, up to
     `blocks.gates.fix_attempts` (2) times, using up no iteration.
   - **Review**: both lenses. A clean iteration at or past `blocks.review.min` (2) ends the loop.
   - **Fix** of majors and minors together, when there is a major, and not in the last iteration; findings on one
     file and symbol reach it as one group. Every fix is reviewed by the next iteration.
5. **Acceptance**, in the main thread: the `acceptance` gates from scratch, then the fast-forward. A failure or a major left
   over stops it, and the agent asks you.

## Docs

- [`args-and-profile.md`](docs/red-green/args-and-profile.md): `args`, `profile`, model presets.
- [`stages.md`](docs/red-green/stages.md): what the script does with each stage's output.
- [`blocks.md`](docs/red-green/blocks.md): block contract, plug-ins, conformance check.
- [`mailbox.md`](docs/red-green/mailbox.md): clarifying a live run.
- [`result.md`](docs/red-green/result.md): the result's fields.
- [`tracing.md`](docs/red-green/tracing.md): `trace.mjs`.
- [`maintaining.md`](docs/red-green/maintaining.md): tests, template, new blocks and fields, prompts.

## License

MIT, see [`LICENSE`](LICENSE).
