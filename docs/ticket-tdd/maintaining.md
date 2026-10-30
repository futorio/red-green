# Maintaining the core

Run commands from `.claude/workflows/ticket-tdd/`; the rendered script is `.claude/workflows/ticket-tdd.js`, one level up.

## Testing

```
node --test test_ticket_tdd.mjs template/test_render.mjs skills/test_mutate.mjs test_trace.mjs
```

A change to the core's control flow gets a case in `test_ticket_tdd.mjs`. A change that alters the render re-records the
sha256 values in [`template/fixtures.json`](../../.claude/workflows/ticket-tdd/template/fixtures.json) and the prompt hashes in `template/test_render.mjs`.

## Template

`template/` renders the core from `template/core/` (one file per block, shared files, an orchestrator), the defaults in
`template/defaults/` and a config. `ticket-tdd.js` is the render's output: change the template, then re-render and check
the copy:

```
node template/render.mjs > ../ticket-tdd.js
node template/render.mjs | diff - ../ticket-tdd.js
node template/render.mjs [config.json] --case case.json --prompt <label> [--json]  # one stage's prompt
```

The `// @part` and `// @include` mechanics are in [`render.mjs`](../../.claude/workflows/ticket-tdd/template/render.mjs); a missing part, or one included never or twice, is an error.

`--prompt` runs the rendered script with stub agents and prints the prompt the agent labelled `<label>` receives. The
case is `{ args, gate_lines, results }`: `results[label]` holds an earlier stage's recorded result, which a stage behind a
review round needs. `--json` prints `{ prompt, schema, model, effort }`.

### Adding a block

1. `template/core/<block>.js`, and an `// @include <block> <part>` line in `orchestrator.js` for each part.
2. Its `inputs` part: `INPUTS.<block>`, every path a `REGISTRY` path ([`blocks.md`](blocks.md)), and
   `template/defaults/<block>.md`, a part per call.
3. A `blocks.<name>` entry in `default.json` with at least `model` and `effort`; a `null` model also needs `FOLLOWS`.
4. Its row in [`stages.md`](stages.md).

### Adding a config field

1. Add it to its block in `default.json` with the value that renders today's behaviour (a new duty: off).
2. Give it a schema in the registry as `config.<field>`, and read it as `CONFIG.<block>.<field>`. A value an
   instruction names also goes in the block's `INPUTS` entry; a duty's sentence is a note part `duty.<name>` in
   [`template/defaults/review.md`](../../.claude/workflows/ticket-tdd/template/defaults/review.md); a new lens is also
   its entry in `LENSES` ([`template/core/review.js`](../../.claude/workflows/ticket-tdd/template/core/review.js)) and a part named by its key.
3. Add a stub test that the field moves the behaviour and a render test beside T03-T06; record a fixture variant when
   the ablation study varies it.


## Changing the prompts

An agent's how-to is the block's default, `template/defaults/<block>.md`; the contract part is in `template/core/<block>.js`.


**Prompts are code.** Every word in a stage prompt or a skill is paid on every call of that stage. A commit that edits
one states the size change in bytes. When an agent keeps making the wrong move, fix the schema, the check or the input
that let it before adding a sentence telling it not to.

**Discipline is not a fix.** A defect class that already has two written rules and comes back needs a check, a schema
field or a deleted duplicate, not a third rule.

## Dependencies

`workflow-doctor.sh` exits 1 on anything missing; `--help` says why each is needed.
