---
name: setup
description: Write or update the current project's red-green profile file (gates, code rules, model preset, block prompts) from its CI, build and rule files. Use when the user asks to set up, configure or re-configure red-green in a project.
---

# Set a project up for red-green

You write the project's profile file, `.claude/red-green/profile.json`, from what the project's own files say and what
the user picks. The profile's shape is `${CLAUDE_PLUGIN_ROOT}/docs/red-green/args-and-profile.md`; read it first.

This is a read-only survey: every candidate command stays unrun, so the table holds only what the files and CI history
say. The user's picks alone decide the gates.

## 1. Current profile

Read `.claude/red-green/profile.json` when it exists. Its keys are the user's: the merge in step 5 replaces only the
keys the user decides in step 4.

Done when you hold the current profile, or know the file is new.

## 2. Gate candidates

Read in this order, each source adding the commands the earlier ones lack:

1. CI config, of whatever CI tool the project uses.
2. Build and test files: package scripts, `Makefile`, `pyproject.toml`, `Cargo.toml` and their kin.

For a CI tool whose history is reachable (`gh run list` and `gh run view --json jobs` for GitHub Actions, the
equivalent for others), take each job's recent duration from it.

Build one table, a row per candidate:

| command | source | kind | CI duration |
|---|---|---|---|
| the command as the project runs it | file and line | lint, type check, test or build | recent duration, or `-` |

A command that needs the project root as its working directory names it as `{{repo}}` (`cd {{repo}} && npm test`); a
current gate the profile already declares joins the table with `profile` as its source.

Done when every CI step and build-file target that checks code has a row, and every row has all four columns.

## 3. Rule candidates

Read the rule files: `AGENTS.md`, `CLAUDE.md`, contributing and style guides, linter and formatter configs. Draft:

- `code_rules`: one line per convention the code must follow that no gate in the table already enforces.
- `commit`: the commit-message rule, when a file states one.

The current profile's `code_rules` and `commit` join the drafts, marked as current.

Done when every rule file is read and each draft names the file it came from.

## 4. Picks

Show the user the table and the drafts, then ask for:

1. The gates: which rows, and a short unique `name` for each.
2. The code rules and the commit rule to keep.
3. The model preset, from the presets table in `args-and-profile.md` with what each is for, or keep the current models.
4. Any block's own `prompt` or `skill` (the Plug-ins section of `${CLAUDE_PLUGIN_ROOT}/docs/red-green/blocks.md`), one
   per block.

Done when the user has answered all four; "none" and "keep" are answers.

## 5. Write

Start from the current profile and set only what the user decided in step 4:

- `blocks.gates.gates`: the picked gates as `{name, command}`.
- `code_rules`, `commit`: the kept rules.
- A preset: `research`, `plan`, `implement` and `fix` each take the preset's `model`, or lose the `model` key where
  the preset gives none.
- A block's `prompt` or `skill`: set it, and remove the other of the two on that block.

Every other key, block and field stays exactly as it was. Write the result to `.claude/red-green/profile.json` as
JSON with two-space indent.

Done when the file holds every decision and every key the user did not decide is unchanged.

## 6. Check

```sh
node ${CLAUDE_PLUGIN_ROOT}/.claude/workflows/red-green/template/render.mjs --check .claude/red-green/profile.json
```

Exit 1 prints the run's config error, naming the key: fix that key with the user, write the file again, re-run.

Done when the check exits 0.

## 7. Report

Tell the user the file's path, what changed in it, that it is meant to be committed, and that
`/red-green:start <ticket path>` now runs with it.
