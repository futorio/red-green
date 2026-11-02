<p align="center"><img src="docs/assets/logo.svg" width="160" alt="red-green logo"></p>

# red-green

**Give Claude a ticket, get back tested, reviewed commits. A script decides it's done, not the agent.**

Agents say "done" too early: tests skipped, a requirement forgotten, a red build called green. red-green is a Claude Code
plugin that runs one ticket through research, test-first implementation and a review-and-fix loop, with each step a
separate agent whose output a script checks before the next one starts.

> Needs the Workflow tool in Claude Code. It is enabled per account and not on every account yet.

- **Can't fake done.** Gates run by a script, their status is the exit code. A run does not end green on red gates.
- **No requirement vanishes.** Research lists the ticket's requirements; a requirement no test case covers sends the
  plan back, and if it stays uncovered, the result says so.
- **Property tests where examples fall short.** A claim over inputs too many to list becomes a property test, with a
  built-in generator and shrinker for projects without a framework. Based on Anthropic's
  [property-based testing research](https://www.anthropic.com/research/property-based-testing).
- **Reviewed after every fix.** Two lenses, one against the ticket and one on the code, for at least two iterations.
  Findings on one symbol reach the fixer as one group; the next iteration checks the fix.
- **Your branch stays safe.** The run works in its own worktree; your branch is fast-forwarded only when acceptance
  gates pass and no major is left.
- **Asks, doesn't stall.** Open questions from research and planning reach you while the run goes on; your answer goes
  into the live run.
- **Tunable.** Presets `standard`, `hard`, `cheap`; any stage's model, rounds, gates or prompt can be swapped. Every run
  leaves a time and token trace per stage.

## Quick start

```sh
claude plugin marketplace add --scope project futorio/red-green
claude plugin install --scope project red-green@red-green
```

Then, in Claude Code inside the project:

1. Write the ticket as a markdown file. Tickets from [mattpocock/skills](https://github.com/mattpocock/skills)
   (`grill-me` → `to-spec` → `to-tickets`) work best; any task statement works.
2. `/red-green:setup` once per project: picks the gates, code rules and model preset from your CI and build files.
3. `/red-green:start <ticket path>`: starts the run, relays its questions, and reports when it ends.

The settings land in the project's `.claude/settings.json`, so collaborators get the same plugin. Pin a version with
`futorio/red-green#<tag>`.

## What you get

The end-of-run report (illustrative):

```text
status: done
commits: 4 on wf/add-retry, fast-forwarded into main
acceptance: test ✓  lint ✓  typecheck ✓
leftover_findings: none
advisory: 1 minor (retry.ts: backoff constant could be named)
verify_launch: run the CLI against a flaky endpoint and watch the retries
questions: plan: "should a 4xx be retried?" (reading: no)
tokens: research 41k · plan 28k · implement 190k · review 2×96k · fix 54k
```

## How a run goes

```text
research -> plan -> implement
  -> iteration x rounds (3):
       gates <-> fix   (a red gate, up to 2 attempts)
       review          (ticket lens + code lens)
       clean and round >= 2: leave the loop
       fix             (not in the last iteration)
  -> acceptance gates from scratch -> fast-forward
```

Each stage in detail: [`stages.md`](docs/red-green/stages.md).

## Requirements

Claude Code with the Workflow tool and the opus, sonnet and haiku models; `git`; `node`. `/red-green:setup` checks them.

## Docs

- [`args-and-profile.md`](docs/red-green/args-and-profile.md): `args`, `profile`, model presets, property tests.
- [`stages.md`](docs/red-green/stages.md): what the script does with each stage's output.
- [`blocks.md`](docs/red-green/blocks.md): block contract, plug-ins, conformance check.
- [`mailbox.md`](docs/red-green/mailbox.md): clarifying a live run.
- [`result.md`](docs/red-green/result.md): the result's fields.
- [`tracing.md`](docs/red-green/tracing.md): `trace.mjs`.
- [`maintaining.md`](docs/red-green/maintaining.md): working on the plugin, tests, template, prompts.

Outside a run: [by-hand mutation](docs/red-green/args-and-profile.md#by-hand-mutation), a script that applies mutant
patches you supply over a commit range and reports which ones the tests miss.

## License

MIT, see [`LICENSE`](LICENSE).
