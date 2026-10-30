# Maintaining the core

Paths are under `.claude/workflows/ticket-tdd/`.

## Testing

`node --test` on `test_ticket_tdd.mjs`, `template/test_render.mjs`, `skills/test_mutate.mjs`, `test_trace.mjs`.
`test_ticket_tdd.mjs` runs `ticket-tdd.js` with a stub `agent()` returning recorded results by label; a change to the
core's control flow gets a case there. `test_render.mjs` fails when the default config does not render
`ticket-tdd.js` byte for byte, and checks the sha256 of every variant in `template/fixtures.json`; a change that
alters the render re-records them.

## Template

`template/` renders the core from `template/core/` (one file per block, shared files, an orchestrator), the defaults in
`template/defaults/` and a config. `ticket-tdd.js` is the render's output: change the template and re-render.

A core file is a header comment, then parts, each opened by a `// @part <name>` line. The orchestrator's `main` part is
the script: render replaces each of its `// @include <file> <part>` lines by that part, then fills `{{blocks}}` (the
merged block defaults) and `{{defaults}}` (every part of `template/defaults/`). Every other `{{path}}` is a run-time
variable. A missing part, or one included never or twice, is an error.

```
node template/render.mjs [config.json]                                    # the workflow, on stdout
node template/render.mjs [config.json] --case case.json --prompt <label> [--json]  # one stage's prompt
```

`--prompt` runs the rendered script with stub agents and prints the prompt the agent labelled `<label>` receives. The
case is `{ args, gate_lines, results }`: `args` override the stub args (one declared gate, `gates`), `gate_lines` are
the declared gates' lines in every gates step (all `green`), `results[label]` an earlier stage's recorded result.
Research, plan and implement have stubs; a stage behind a review round needs the round's results. A run that fails
before the label is an error naming its stage and failures. `--json` prints `{ prompt, schema, model, effort }`.

### Adding a block

1. `template/core/<block>.js`, and an `// @include <block> <part>` line in `orchestrator.js` for each part.
2. Its `inputs` part: `INPUTS.<block>`, every path a `REGISTRY` path (a new path only it reads goes in `BLOCK_PATHS`,
   one several blocks read in `registry.js`), and `template/defaults/<block>.md`, a part per call.
3. A `blocks.<name>` entry in `default.json` with at least `model` and `effort`; a `null` model also needs `FOLLOWS`.
4. Its row in `stages.md`.

### Adding a config field

1. Add it to its block in `default.json` with the value that renders today's behaviour (a new duty: off).
2. Give it a schema in the registry as `config.<field>`, and read it as `CONFIG.<block>.<field>`. A value an
   instruction names also goes in the block's `INPUTS` entry; a duty's sentence is a note `duty.<name>` in
   `template/defaults/review.md`.
3. Add a stub test that the field moves the behaviour and a render test beside T03-T06; record a fixture variant when
   the ablation study varies it.

A new lens is its entry in `LENSES` (`template/core/review.js`) and a part of that key's name in
`template/defaults/review.md`.

## Changing the prompts

**Prompts are code.** Every word in a stage prompt or a skill is paid on every call of that stage. A commit that edits
one states the size change in bytes. When an agent keeps making the wrong move, fix the schema, the check or the input
that let it before adding a sentence telling it not to.

**Discipline is not a fix.** A defect class that already has two written rules and comes back needs a check, a schema
field or a deleted duplicate, not a third rule.

## Dependencies

`workflow-doctor.sh` exits 1 on anything missing; `--help` says why each is needed.
