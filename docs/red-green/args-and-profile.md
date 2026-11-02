# Args and profile

## Parameters (`args`)

| arg | meaning | default |
|---|---|---|
| `target` | path of the ticket or spec | required |
| `repo`, `branch` | worktree the agents work in, and its branch | required |
| `tools` | checkout of this repository | required |
| `run` | scratch directory for state files | required |
| `base` | the commit the run starts from; reviews diff against it | required |
| `baseline` | `{<gate name>: {status, line}}` at base, from the gate runner; an entry per `fast` and `round` gate, else the run fails before research. `acceptance` gates are not measured at base | required |
| `one_commit` | the ticket pins exactly one commit: later stages `--amend` it | `false` |
| `profile` | the project's additions, below | `{}` |
| `replay` | harness-only (`render.mjs`): takes research's recorded output as given. A real run never sets it | `false` |

The removed `models`, `rounds`, `extra_rounds`, `min_rounds`, `profile.gates`, `profile.mutation`, `profile.runtime`,
`profile.research`, `blocks.review.extra`, `blocks.mutation`, `blocks.minor-fix`, `blocks.fix-review` and a gate's `fast`
fail the run before any agent (`stage: config`); the note names where each went, `blocks.mutation` the by-hand mutant
runner, `skills/mutate.mjs`.

## Model presets

Values for `profile.blocks`.

| preset | for | `profile.blocks` |
|---|---|---|
| standard | most | `{}` (haiku implement, sonnet fix) |
| hard | concurrency, determinism, cross-cutting | `{"implement": {"model": "sonnet"}, "fix": {"model": "sonnet"}}` |
| cheap | docs, config, small edits | `{"research": {"model": "sonnet"}, "plan": {"model": "opus"}, "implement": {"model": "haiku"}, "fix": {"model": "haiku"}}` |

## `profile`

A project keeps its profile in `.claude/red-green/profile.json`; `/red-green:start` passes it as `args.profile`.
Every field is optional.

| field | type | where it lands |
|---|---|---|
| `commit` | string | implement, fix: commit-message rule appended to the core's |
| `context` | string[] | every agent: extra preamble lines |
| `code_rules` | string[] | implement, fix, code lens: code rules |
| `blocks` | `{<block>: {<field>: value}}` | each block's config over the defaults ([`blocks.md`](blocks.md)): model, knobs, approach, instructions; what fails the run is in the Config section there |

The gates a run declares:

| field | type | approach |
|---|---|---|
| `blocks.gates.gates` | `{name, command, tier?}[]`, names must be unique; `tier` is `fast` (writers and every gates stage), `round` (every gates stage; the default) or `acceptance` (acceptance only) | required with at least one `fast` or `round` gate, else the run fails on config; with a profile declaring none, `/red-green:start` finds them with the user, for that run |

A project that keeps property contracts declares their gate itself; the core adds none. The contract CLI,
[`skills/contracts.mjs`](../../.claude/workflows/red-green/skills/contracts.mjs), reads the `contract: <id>: <statement>`
markers in tracked files; `doc <path>` writes the doc, grouped by id prefix, and `--check` fails on a statement over 255
characters, a duplicate id, a malformed marker or a doc that differs from what it would write:

```json
{"name": "contracts", "command": "node {{tools}}/.claude/workflows/red-green/skills/contracts.mjs doc docs/contracts.md --check", "tier": "fast"}
```

With no property framework declared, property cases run through `run`, the same way for every language, and the project
declares that gate too, with its test command after `--` (a pipeline goes through `sh -c`):

```json
{"name": "properties", "command": "node {{tools}}/.claude/workflows/red-green/skills/contracts.mjs run --examples 100 -- make test"}
```

A property test's marker has a second line, `domain: <json>`, in the runner's domain language: `{"int": [lo, hi]}`,
`{"bytes": [min, max]}` (byte values as a list), `{"string": [min, max], "chars": "<alphabet>"}` (`chars` optional,
printable ASCII by default), `{"list": <domain>, "len": [min, max]}`, `{"tuple": [<domain>, ...]}`,
`{"oneof": [<domain>, ...]}` and `{"const": <json>}`; bounds are inclusive integers. `run` generates the examples from
`--seed` (1 by default, so a gate is stable) and writes each contract's as a JSON array to `$PROPERTY_DIR/<id>.json`,
sets `PROPERTY_SEED` and `PROPERTY_EXAMPLES` (`--examples`, 100 by default) and runs the command once. The test:

- does nothing when its file is absent;
- prints `property: <id> <index>` and flushes before running each example, so an abnormal exit still names it;
- writes the indexes of its failed examples, one per line, to `$PROPERTY_DIR/<id>.failed`, empty when all passed.

`run` exits 0 when all pass; 1 on a failed example, a non-zero exit, or a missing `<id>.failed` after one, red on the
last example printed; 2 on a bad marker or domain, a missing `<id>.failed` after a clean exit, or an index not in
`<id>.json`. stderr names the seed and each failed example.

## Placeholders

Any string in `profile` may name a run value; the core fills it in from `args` before the config merge:

| placeholder | filled with |
|---|---|
| `{{base}}` | `args.base` |
| `{{run}}` | `args.run` |
| `{{repo}}` | `args.repo` |
| `{{tools}}` | `args.tools` |

`"make -C {{repo}} lint"` as a gate command runs in the worktree. A `blocks.<name>.prompt` also keeps its registry paths,
`{{default}}` among them ([`blocks.md`](blocks.md)). Any other `{{...}}` fails the run before any agent (`stage: config`,
the note naming where it is: `profile.code_rules[0]: unknown placeholder {{nope}}`).

## Profile check

```
node ${CLAUDE_PLUGIN_ROOT}/.claude/workflows/red-green/template/render.mjs --check .claude/red-green/profile.json
```

Runs a profile through the run's own placeholder check, merge and validator, with no agent and no cost. It exits 0 when
the run would get past `stage: config`; otherwise it exits 1 and prints that stage's note on stderr. A profile with no
gates passes, so that `/red-green:start` reaches its discovery; only the run refuses it.
