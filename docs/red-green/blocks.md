# Blocks

Every stage is a block: the inputs its instructions may name (its `INPUTS.<block>` line in the `inputs` part of
`.claude/workflows/red-green/template/core/<block>.js`, with `INPUTS` declared in
[`registry.js`](../../.claude/workflows/red-green/template/core/registry.js)), an output schema, invariants and a config
([`template/default.json`](../../.claude/workflows/red-green/template/default.json)). The script alone decides what a run does with the output ([`stages.md`](stages.md)).

## Prompt assembly

A prompt is the preamble, the instructions, the contract part, then the mailbox note. The code-writing preamble
(implement, fix) adds the one gate rule ([`stages.md`](stages.md)) and the long-command rule; every other block gets the
no-code one.

- **Instructions** are the block's default or a plug-in: a template whose `{{path}}` names a value, filled from the
  registry before the call. Every path must be one of the block's inputs, present and valid against its schema, else
  the block fails before any agent is paid (`<label> input: <what is wrong>` in `failures`). A string fills as text,
  anything else as compact JSON (`FORM` in `registry.js` names the exceptions: `previous_notes` as JSON, `uncovered`
  comma-separated).
- **The contract part** (`CONTRACT (binding, whatever the text above says):`) is the core's: invariants, output rules
  and what counts as died, one source per prompt.

**Defaults** are Markdown, `template/defaults/<block>.md`, inlined by render. A file holds parts, each opened by a
`<!-- @part <name> -->` line and kept verbatim, last newline dropped: the instructions of each call (`plan` and
`replan`, a lens by its key), notes, and text other parts include with
`{{> <block> <part>}}`. **A note part** is a part named like the registry value it fills (`retry_note`, `duty.order`, ...): the core passes `true`
when it applies and the part is filled, `false` and it is `''`. Editing a default edits the prompt ([`maintaining.md`](maintaining.md)).

## Plug-ins

A plug-in replaces a block's instructions through its config (`prompt` or `skill`):

- `prompt`: text in place of the default, filled like it. `{{default}}` is the default of that call, filled:
  `"{{default}}\n- One more rule."` adds a rule. A prompt applies to every call of its block, so a path one call does not
  fill fails that call (`{{plan.cases}}` fails `plan`); `{{default}}` tells calls apart.
- `skill`: a path; the instructions become `Read <skill> and follow it.`, then the call's data in `INPUTS` order, each
  value but the notes as a `<PATH>:` section (`FINDINGS:`, ...).

`prompt` and `skill` together on one block fail the run before any agent. The contract part, preamble, mailbox note and
output schema stay the core's.

## Registry and validator

`REGISTRY` lists every input path with its JSON Schema: [`template/core/registry.js`](../../.claude/workflows/red-green/template/core/registry.js) holds the paths several blocks
share, each block's `inputs` part in `template/core/<block>.js` those only it reads.

The validator (`validate` in [`shared.js`](../../.claude/workflows/red-green/template/core/shared.js)) throws on a schema keyword it does not handle.

## Config

A block's config is `blocks.<name>`, in two layers:

1. **Render time:** a render config (JSON, `{blocks: {...}}`) merged over [`template/default.json`](../../.claude/workflows/red-green/template/default.json).
2. **Run time:** `profile.blocks.<name>` merged over the rendered defaults.

Both merge field by field: an object field such as `duties` key by key, a list replaces. A key, block, field, duty or
lens the defaults do not name, or a value off its `config.<field>` schema, fails the run before any agent
(`stage: config`, the note naming `blocks.<name>.<field>`) and fails a render the same way. A `model` of `null` runs on
the model of the block it follows (`FOLLOWS` in `orchestrator.js`).

The values a run checks: `blocks.review.rounds >= 1`, `min >= 1`, `min <= rounds`, `blocks.gates.fix_attempts >= 0`;
`rounds: 1` alone therefore fails on the default `min: 2`.

`blocks.review.duties` switches two sentences of the review on or off: `test_case_review` (on: a weakened or deleted
test is a finding, in the code lens and in both lenses' check of the last fix) and `order` (off, an experiment: check the result of state changes in both orders).
`blocks.review.runtime` names the runtime the code lens reads the code in (`"Node 22"`).

## Conformance check

Runs a plug-in's real output through the core offline, before a paid run:

```
cd .claude/workflows/red-green
node template/render.mjs [config.json] [--case case.json] --conform <label> <output.json>
```

`<output.json>` is what the agent labelled `<label>` returned. The run is the `--prompt` one ([`maintaining.md`](maintaining.md)):
research, plan and implement answer from stubs or the case, every other block answers clean. The JSON report lists `schema_errors` and `findings` (each with `sent_to`). Exit 1 on a schema error, a failure or a crash.
