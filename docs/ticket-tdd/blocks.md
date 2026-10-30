# Blocks

Every stage is a block: the inputs its instructions may name (its `INPUTS` entry in
`.claude/workflows/ticket-tdd/template/core/shared.js`), an output schema, invariants and a config
(`template/default.json`). The script alone decides what a run does with the output (`stages.md`).

## Prompt assembly

A prompt is the preamble, the instructions, the contract part, then the mailbox note.

- **Instructions** are the block's default or a plug-in: a template whose `{{path}}` names a value, filled from the
  registry before the call. Every path must be one of the block's inputs, present and valid against its schema, else
  the block fails before any agent is paid (`<label> input: <what is wrong>` in `failures`). A string fills as text,
  anything else as compact JSON (exceptions: `FORM` in `shared.js`).
- **The contract part** (`CONTRACT (binding, whatever the text above says):`) is the core's: invariants, output rules
  and what counts as died, one source per prompt (the fix blocks share `fixContract`).

**Defaults** are Markdown, `template/defaults/<block>.md`, inlined by render. A file holds parts, each opened by a
`<!-- @part <name> -->` line and kept verbatim, last newline dropped: the instructions of each call (`plan` and
`replan`, `discover` and `run`, a lens by its key, a mutation approach), notes, and text other parts include with
`{{> <block> <part>}}`. **A note** is a part named like the registry value it fills (`retry_note`, `duty.order`, ...):
the core passes `true` when it applies, else it is `''`. Editing a default edits the prompt (`maintaining.md`).

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

`REGISTRY` lists every input path with its JSON Schema: `template/core/registry.js` holds the paths several blocks
share, each block's `inputs` part in `template/core/<block>.js` those only it reads.

The validator (`validate` in `shared.js`) supports `type`, `properties`, `required`, `items`, `enum`, `pattern`,
`anyOf`, `minItems`, `maxLength`; any other schema keyword throws.

## Config

A block's config is `blocks.<name>`, in two layers:

1. **Render time:** a render config (JSON, `{blocks: {...}}`) merged over `template/default.json`.
2. **Run time:** `profile.blocks.<name>` merged over the rendered defaults.

Both merge field by field: an object field such as `duties` key by key, a list replaces. A key, block, field, duty or
lens the defaults do not name, or a value off its `config.<field>` schema, fails the run before any agent
(`stage: config`, the note naming `blocks.<name>.<field>`) and fails a render the same way. A `model` of `null` runs on
the model of the block it follows (`FOLLOWS` in `orchestrator.js`).

## Conformance check

Runs a plug-in's real output through the core offline, before a paid run:

```
node template/render.mjs [config.json] [--case case.json] --conform <label> <output.json>
```

`<output.json>` is what the agent labelled `<label>` returned. The run is the `--prompt` one (`maintaining.md`):
research, plan and implement answer from stubs or the case, every other block answers clean. The JSON report holds
`schema_errors`, `findings` (each with `sent_to`) and the run's `status`, `failures`, `verdicts` and leftovers. An
unreadable output is a `crash` naming the script line. Exit 1 on a schema error, a failure or a crash.

Every output field is read by the script or reaches the result; `notes` is the one free-text field.
