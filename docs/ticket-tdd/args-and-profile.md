# Args and profile

## Parameters (`args`)

| arg | meaning | default |
|---|---|---|
| `target` | path of the ticket or spec | required |
| `repo`, `branch` | worktree the agents work in, and its branch | required |
| `tools` | checkout of this repository | required |
| `run` | scratch directory for state files | required |
| `base` | the commit the run starts from; reviews diff against it | required |
| `baseline` | `{<gate name>: <summary line at base, with the cause of any failure already there>}`, one entry per declared gate; a missing entry fails the run before research | required with declared gates |
| `one_commit` | the ticket pins exactly one commit: later stages `--amend` it | `false` |
| `profile` | the project's additions, below | `{}` |
| `replay` | harness-only, set by `render.mjs`: research's recorded output is taken as given, without the plan-step check. A real run never sets it | `false` |

The removed `models`, `rounds`, `extra_rounds`, `min_rounds`, `profile.gates`, `profile.mutation`, `profile.runtime`
and `profile.research` fail the run before any agent (`stage: config`); the note names where each went.

## Model presets

Values for `profile.blocks`, from the wf-ablation stage tournament. Unmeasured: a lighter research model, fix on haiku.

| preset | for | `profile.blocks` | why |
|---|---|---|---|
| standard | most | `{"implement": {"model": "haiku"}, "fix": {"model": "sonnet"}}` | models tie on implement; haiku is cheapest |
| hard | concurrency, determinism, cross-cutting | `{}` (sonnet implement and fix) | insurance |
| cheap | docs, config, small edits | `{"research": {"model": "sonnet"}, "plan": {"model": "opus"}, "implement": {"model": "haiku"}, "fix": {"model": "haiku"}}` | research costs most (opus ~$4.3, sonnet ~$1.2 a case); sonnet unmeasured |

## `profile`

Every field is optional.

| field | type | where it lands |
|---|---|---|
| `commit` | string | every agent: commit-message rule appended to the core's |
| `context` | string[] | every agent: extra preamble lines |
| `code_rules` | string[] | implement, fix, code lens: code rules |
| `blocks` | `{<block>: {<field>: value}}` | each block's config over the defaults (`blocks.md`): model, knobs, approach, instructions. An unknown block, field, duty or lens, or a value off its schema (`rounds: 'auto'`), fails the run before any agent |

Approach fields, for a block with more than one way to work:

| field | type | approach |
|---|---|---|
| `blocks.gates.gates` | `{name, command}[]`, names unique | declared: the code-writing agents' preamble and the gates step; absent: gates discovery finds them |
| `blocks.mutation.build`, `.test`, `.timeout` | string, string, seconds | generated mutants, run under these commands; `timeout` 300 by default |
| `blocks.mutation.tool` | string | the project's own tool, in words, instead of `build` and `test` (both given: a config error) |

Without `profile.blocks.mutation` the step is skipped with a log line. A `mutation` with neither `test` nor `tool`, or
`build` without `test`: a config error.

