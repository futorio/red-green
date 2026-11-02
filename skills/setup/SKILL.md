---
name: setup
description: Set this project up for red-green, or change its setup: profile file (gates, code rules, models, block prompts) and the agent instructions section.
disable-model-invocation: true
---

# Set a project up for red-green

You write the project's profile file, `.claude/red-green/profile.json`, from what the project's own files say and what
the user picks. The profile's shape is `${CLAUDE_PLUGIN_ROOT}/docs/red-green/args-and-profile.md`; read it first.

Every candidate command stays unrun, so the table holds only what the files and CI history say. The user's picks
alone decide the gates.

## 1. Machine

Run `${CLAUDE_PLUGIN_ROOT}/.claude/workflows/red-green/workflow-doctor.sh`. Each `MISSING` line is a tool the user
installs before going on; give the user the doctor's "confirm by hand" list from its `--help`.

Done when the doctor exits 0 and the user has the hand-check list.

## 2. Current profile

Read `.claude/red-green/profile.json` when it exists; step 6 merges into it.

Done when you hold the current profile, or know the file is new.

## 3. Gate candidates

Read in this order, each source adding the commands the earlier ones lack:

1. CI config, of whatever CI tool the project uses.
2. Build and test files: package scripts, `Makefile`, `pyproject.toml`, `Cargo.toml` and their kin.

For a CI tool whose history is reachable (`gh run list` and `gh run view --json jobs` for GitHub Actions, the
equivalent for others), take each job's recent duration from it.

Build one table, a row per candidate:

| command | source | kind | CI duration |
|---|---|---|---|
| the command as the project runs it | file and line | lint, type check, test or build | recent duration, or `-` |

A current gate the profile already declares joins the table with `profile` as its source.

Done when every CI step and build-file target that checks code has a row, and every row has all four columns.

## 4. Rule candidates

Read the rule files: `AGENTS.md`, `CLAUDE.md`, contributing and style guides, linter and formatter configs, leaving
out the `## red-green` section step 8 writes. Draft:

- `code_rules`: one line per convention the code must follow that no gate in the table already enforces.
- `commit`: the commit-message rule, when a file states one.

The current profile's `code_rules` and `commit` join the drafts, marked as current.

Done when every rule file is read and each draft names the file it came from.

## 5. Picks

Show the user the table and the drafts, then ask one question at a time, in this order, each led by your recommended
answer:

1. The gates: which rows, a short unique `name` for each, and a tier for each. Recommend `fast` for a static check that
   reads the source without building it (lint, format check, type check), `round` for a build, a test suite or a row you
   are unsure of, and `acceptance` for one too heavy to run each iteration. A run needs at least one `fast` or `round`
   gate.
2. The code rules and the commit rule to keep.
3. The model preset, from the presets table in `args-and-profile.md` with what each is for, or keep the current models.
4. Any block's own `prompt` or `skill` (the Plug-ins section of `${CLAUDE_PLUGIN_ROOT}/docs/red-green/blocks.md`), one
   per block.

Done when every table row is kept or dropped, each kept row has a name and a tier, and the user has answered the other
three; "none" and "keep" are answers.

## 6. Write

Start from the current profile and set only what the user decided in step 5:

- `blocks.gates.gates`: the picked gates as `{name, command, tier}`.
- `blocks.mutation`: remove it, since a run fails on it.
- `code_rules`, `commit`: the kept rules.
- A preset: set each `model` its row gives, and remove `model` from every other block that any preset row names.
- A block's `prompt` or `skill`: set it, and remove the other of the two on that block.

Every other key, block and field stays exactly as it was. Write the result to `.claude/red-green/profile.json` as
JSON with two-space indent.

Done when the file holds every decision and every key the user did not decide is unchanged.

## 7. Check

```sh
node ${CLAUDE_PLUGIN_ROOT}/.claude/workflows/red-green/template/render.mjs --check .claude/red-green/profile.json
```

Exit 1 prints the run's config error, naming the key: fix that key with the user, write the file again, re-run.

Done when the check exits 0.

## 8. Agent instructions

Edit `CLAUDE.md` at the project root when it exists, else `AGENTS.md`; with neither, ask the user which one to create.
Give it this section, replacing an existing `## red-green` section in place:

```markdown
## red-green

To implement a ticket or spec, offer the user `/red-green:start <path>`. Gates, rules and models live in
`.claude/red-green/profile.json`; `/red-green:setup` changes them.
```

Done when the file has exactly one `## red-green` section with this text and the rest of the file is unchanged.

## 9. Report

Tell the user the paths of the profile and the instructions file, what changed in each, that both are meant to be
committed, and that `/red-green:start <ticket path>` now runs with the profile.

Done when the user has all four.
