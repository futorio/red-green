# Args and profile

## Parameters (`args`)

| arg | meaning | default |
|---|---|---|
| `target` | path of the ticket or spec | required |
| `repo`, `branch` | worktree the agents work in, and its branch | required |
| `tools` | checkout of this repository | required |
| `run` | scratch directory for state files | required |
| `base` | the commit the run starts from; reviews diff against it | required |
| `baseline` | `{<gate name>: <summary line at base, with the cause of any failure already there>}`; an entry per declared gate, else the run fails before research | required with declared gates |
| `one_commit` | the ticket pins exactly one commit: later stages `--amend` it | `false` |
| `profile` | the project's additions, below | `{}` |
| `replay` | harness-only (`render.mjs`): takes research's recorded output as given. A real run never sets it | `false` |

The removed `models`, `rounds`, `extra_rounds`, `min_rounds`, `profile.gates`, `profile.mutation`, `profile.runtime`
and `profile.research` fail the run before any agent (`stage: config`); the note names where each went.

## Model presets

Values for `profile.blocks`.

| preset | for | `profile.blocks` |
|---|---|---|
| standard | most | `{"implement": {"model": "haiku"}, "fix": {"model": "sonnet"}}` |
| hard | concurrency, determinism, cross-cutting | `{}` (sonnet implement and fix) |
| cheap | docs, config, small edits | `{"research": {"model": "sonnet"}, "plan": {"model": "opus"}, "implement": {"model": "haiku"}, "fix": {"model": "haiku"}}` |

## `profile`

A project keeps its profile in `.claude/red-green/profile.json`; `/red-green:start` passes it as `args.profile`.
Every field is optional.

| field | type | where it lands |
|---|---|---|
| `commit` | string | implement, fix, minor fix: commit-message rule appended to the core's |
| `context` | string[] | every agent: extra preamble lines |
| `code_rules` | string[] | implement, fix, code lens: code rules |
| `blocks` | `{<block>: {<field>: value}}` | each block's config over the defaults ([`blocks.md`](blocks.md)): model, knobs, approach, instructions; what fails the run is in the Config section there |

Approach fields, for a block with more than one way to work:

| field | type | approach |
|---|---|---|
| `blocks.gates.gates` | `{name, command}[]`, names must be unique (not checked) | declared: the code-writing agents' preamble and the gates step; absent: gates discovery finds them |
| `blocks.mutation.build`, `.test`, `.timeout` | string, string, seconds | generated mutants, run under these commands; `timeout` 300 by default |
| `blocks.mutation.tool` | string | the project's own tool, in words, instead of `build` and `test` (both given: a config error) |

Without `profile.blocks.mutation` the step is skipped with a log line. A `mutation` with neither `test` nor `tool`, or
`build` without `test`, is a config error.

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
cd .claude/workflows/red-green
node template/render.mjs [config.json] --check profile.json
```

Runs a profile through the run's own placeholder check, merge and validator, with no agent and no cost. It exits 0 when
the run would get past `stage: config`; otherwise it exits 1 and prints that stage's note on stderr.
