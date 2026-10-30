# Args and profile

## Parameters (`args`)

| arg | meaning | default |
|---|---|---|
| `target` | path of the ticket or spec | required |
| `repo`, `branch` | worktree the agents work in, and its branch | required |
| `tools` | checkout of this repository (it holds `.claude/workflows/ticket-tdd/`) | required |
| `run` | scratch directory for state files | required |
| `base` | the commit the run starts from; review diffs against it | required |
| `baseline` | `{<gate name>: <summary line at base, with the cause of any failure already there>}`, one entry per gate in `profile.blocks.gates.gates`; a missing entry fails the run before research; ignored when no gates are declared | required with declared gates |
| `one_commit` | the ticket pins exactly one commit: later stages `--amend` it | `false` |
| `profile` | the project's additions, below | `{}` |
| `replay` | harness-only: `render.mjs` sets it when it replays a case (`maintaining.md`); research's recorded output is taken as given, without the plan-step check and `research:retry`. A real run never sets it | `false` |

`models`, `rounds`, `extra_rounds` and `min_rounds` moved into the block config (`profile.blocks`, `blocks.md`), and so
did `profile.gates`, `profile.mutation` and `profile.runtime` (now `profile.blocks.review.runtime`);
`profile.research` gave way to a research `prompt`: `"{{default}}\n<text>"` renders the prompt it made byte for byte.
A run that still passes one fails before any agent (`status: failed`, `stage: config`, the note naming where it went)
instead of ignoring it.

## Model presets

Three `profile.blocks` model sets from the stage tournament (`.scratch/wf-ablation/tournament-report.md` in the
wf-ablation repo). Effort stays `high` for research, plan and implement (their defaults). Measured: plan opus beats
sonnet, haiku and no plan; implement models tie on the hidden verifiers; review opus leads lighter reviewers by
0.2-0.3 F2. Not measured: a lighter research model (its stage was stopped) and the fix model (it defaults to the
implement model).

| preset | for | `profile.blocks` | why |
|---|---|---|---|
| standard | most tickets | `{"implement": {"model": "haiku"}, "fix": {"model": "sonnet"}}` | plan and review keep opus; implement tied, haiku is the cheapest; fix stays on sonnet, unmeasured on haiku |
| hard | concurrency, determinism, cross-cutting changes | `{}` (the default: sonnet implement and fix) | same measured stages; sonnet costs a little more as insurance on cases the tournament had too few of to split |
| cheap | docs, config, small local edits | `{"research": {"model": "sonnet"}, "plan": {"model": "opus"}, "implement": {"model": "haiku"}, "fix": {"model": "haiku"}}` | research is the costliest stage (opus ~$4.3, sonnet ~$1.2 a case); its quality on sonnet is unmeasured, so only where a miss is cheap |

## `profile`

Every field is optional; an absent one leaves the core's neutral wording.

| field | type | where it lands |
|---|---|---|
| `commit` | string | every agent: commit-message rule appended to the core's |
| `context` | string[] | every agent: extra preamble lines (search traps, what not to touch, gate guidance such as tiers that never run in a run or one heavy check at a time) |
| `code_rules` | string[] | implement, fix, code lens: hard code rules |
| `blocks` | `{<block>: {<field>: value}}` | each block's config over the render config's defaults, field by field (`blocks.md`): its model and knobs, its approach, its own instructions; an unknown block, field, duty or lens, or a value off its schema (`rounds: 'auto'`), fails the run before any agent |

The fields above reach every block that names them; what one block alone needs is that block's config. The approach
fields, where a block has more than one way to work:

| field | type | approach |
|---|---|---|
| `blocks.gates.gates` | `{name, command}[]`, names unique | declared: the code-writing agents' preamble (name, command, baseline) and the gates step; absent: the gates discovery step finds them |
| `blocks.mutation.build`, `.test`, `.timeout` | string, string, seconds | generated mutants, run under these commands; `timeout` 300 by default |
| `blocks.mutation.tool` | string | the project's own tool, in words, instead of `build` and `test` (both: a config error); no `profile.blocks.mutation`: the step is skipped with a log line; one given with neither `test` nor `tool`, or `build` without `test`: a config error |
| `blocks.review.lenses` | lens keys | the review lens set (`blocks.md`) |

The repository's own agent instructions (`AGENTS.md`, `CLAUDE.md`) reach every agent anyway; the
profile carries only what a stage prompt must name explicitly.
