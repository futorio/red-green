# Blocks

Every stage is a block with a contract: the inputs its instructions may name, an output schema, invariants and a
config. The script alone decides what a run does with a block's output (coverage, severity, the loop, failures).

**A prompt** is the preamble (no-code or code-writing, `stages.md`), then the block's instructions, then its contract
part, then the mailbox note. The instructions are the block's default, or the project's own (below). They are a
template: they name the values they need as `{{path}}`, and the core fills them from the registry below before the
call. Every path must be one of the block's inputs and its value
must be present and valid against the path's schema; otherwise the block fails before any agent is paid (`<label>
input: <what is wrong>` in `failures`, and the caller sees a dead step). A string fills in as text, any other value as
compact JSON (`JSON.stringify(v)`), but for `previous_notes` (a string, as JSON) and `uncovered` (comma-separated) (`FORM`). **The contract part** (`CONTRACT (binding, whatever the text above says):`) is
the core's: the block's invariants (read-only, or a writer's commit rules and the ticket files it leaves alone), its
output rules (what each output field holds) and what counts as died, phrased as what the agent must do (`<what>, or
the stage counts as died.`). Each rule has one source per prompt; the fix blocks share theirs (`fixContract`).

**The defaults** are Markdown, `template/defaults/<block>.md`, inlined by render (`maintaining.md`). A file holds parts, each
opened by a `<!-- @part <name> -->` line: the default instructions of each call (a block with several calls has one
per call: plan's `plan` and `replan`, gates' `discover` and `run`, a lens's by its key, mutation's by its approach),
its notes, and text other parts include with `{{> <block> <part>}}`, so a rule has one source: `research section`,
`shared bg`, `plan rules`, `review head`, `review frame`, `review weakened`, `fix silence`. A part is its lines
verbatim, its last newline dropped: a note may start with a space or a blank line, and keeps it. **A note** is a part
named like the registry value it fills (`retry_note`, `earlier_fixes`, `duty.order`, ...): the core passes `true` when
it applies and fills it from the call's other values, else it is `''`. Editing a default edits the prompt; the
commit states the size change (`maintaining.md`, Changing the prompts).

**A plug-in** replaces a block's instructions through its config, per run in `profile.blocks.<name>` (or per render):

- `prompt`: text in place of the default, filled like it, so it names any of the block's inputs; `{{default}}` is the
  default of that call, filled. `"{{default}}\n- One more rule."` adds a rule without copying the default. A prompt
  applies to every call of its block (both lenses, plan and replan, discovery and the gates step); `{{default}}` tells
  them apart. The values are the call's: a path one call does not fill (the block tables in `stages.md` say which call
  fills which) fails that call, so `{{plan.cases}}` fails plan and `{{gate_list}}` fails discovery.
- `skill`: a path; the instructions become `Read <skill> and follow it.`, then the call's data: every value it fills
  but the notes, in the block's inputs order, each as a `<PATH>:` section (`FINDINGS:`, `RESEARCH:`, `GATE_ROWS:`,
  ...), filled as above. The default's how-to stays out.

Not both: a block given `prompt` and `skill` fails the run before any agent. The contract part, the preamble and the
mailbox note stay the core's whatever the plug-in says, and so do the output schema and what the script does with the
output. The approach fields (`args-and-profile.md`) pick a procedure where a block has more than one.

**The registry** (`REGISTRY`) lists every path with its JSON Schema: `template/core/registry.js` holds the paths
several blocks share, and each block's `inputs` part in `template/core/<block>.js` the ones only it reads:

| kind | paths |
|---|---|
| run args | `REPO`, `BASE`, `TARGET`, `RUN` |
| computed | `HEAD` (the HEAD the step runs on), `from_head` (the HEAD a fix started from), `IMPLEMENT_SKILL`, `round`, `rounds` (planned), `gate_list`, `gate_rows`, `mutate_command`, `test_ids`, `check_ids`, `code_rules` (`profile.code_rules` as a section, `''` without) |
| notes' data | `previous_notes` (string: the attempt before a retry), `uncovered` (test ids), `duplicates` (`{check, cases}[]`: checks in several cases), `verify_review` (requirement lines), `unverified` (implement's claims), `history` (`{id, round, where?, problem, outcome: fixed\|rejected, argument?}[]`: earlier findings) |
| notes | `retry_note`, `uncovered_note`, `duplicates_note`, `verify_review_note`, `unverified_note`, `runtime_note`, `earlier_findings`, `earlier_fixes`, `duty.order`, `duty.test_case_review`, `duty.test_case_review_fix`: the default part of that name, filled, or `''` |
| stage outputs | `research` (the checked research: requirements, facts, plan, test_harness, files), `cases` (requirement lines expanded), `plan.cases` (the planner's, for the replan), `tested_checks` (implement's check rows with a test), `findings` (as sent to a fix), `given` (`{id, where, problem, outcome: fixed\|rejected, argument?}` per finding a fix was given), `fixed` (`{round, id, what}` per applied fix) |
| block config | `config.<field>` for every field of `blocks.<name>`: `model` (string or null), `effort` (string), `rounds`, `extra`, `min`, `minors`, `edges`, `timeout` (integers), `lenses` (`LENSES` keys), `duties` (booleans), `gates` (`{name, command}[]` or null), `build`, `test`, `tool`, `runtime`, `prompt`, `skill` (string or null; every block's `prompt` and `skill` null in `default.json`); instructions name `config.edges`, `config.tool` and `config.runtime` |
| default | `default`: the default instructions of the call, filled, for a project prompt that wraps them; every block takes it |

**The validator** (`shared.js` `validate`) is the core's own: `type`, `properties`, `required`, `items`, `enum`,
`pattern`, `anyOf`, `minItems`, `maxLength`; any other keyword anywhere in a schema throws. `render.mjs` exports the
same code for the tests.

**The config** of each block is `blocks.<name>`: defaults in the render config (`template/default.json`), and
`profile.blocks.<name>` over them per run, field by field (an object field such as `duties` key by key, a list
replaces). A `model` of `null` runs on the model of the block it follows (`FOLLOWS` in `orchestrator.js`): plan on
research's, fix on implement's, fix-review on review's, minor-fix on fix's. Each merged block config is checked
against the registry's `config.<field>` schemas: a value off its schema fails the run before any agent (`stage:
config`, the note naming `blocks.<name>.<field>`), and fails a render the same way.

Each block's table (labels, inputs, default parts, output schema, invariants, config defaults) sits at the end of its
section in `stages.md`.

**The conformance check** runs a plug-in's real output through the core offline, before a paid run:

```
node template/render.mjs [config.json] [--case case.json] --conform <label> <output.json>
```

`<output.json>` is what the agent labelled `<label>` returned (`review:r1:code`, `mutation`, `implement`, ...). The
run is the `--prompt` one (`maintaining.md`): research, plan and implement answer from stubs or the case, and every other
block answers clean (a met row per requirement id, a clean code lens, a mutation step that does not apply, a fix
that rejects every finding it is sent); the stubs read the ids and findings from their calls' values, so a plug-in
prompt changes nothing they do. The report, as JSON: `schema_errors` (the output against the schema that
agent gets), `findings` (every finding the script sent to a fix, `sent_to` its label), and the run's `status`,
`failures`, `verdicts`, `leftover_findings`, `advisory`, `mutation`, `research_issues` and `unverified`; an output the
script cannot read is a `crash` naming the script line. It exits 1 on a schema error, a failure or a crash, 0
otherwise. `template/conformance/review-code.json` is a recorded real code-lens output it passes (T19).

Every output field is read by the script or reaches the result, and the result's shape stayed under that rule;
`notes`, where a schema has it, is the one free-text field. W90 checks it for fix's schema.
