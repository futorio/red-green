# Maintaining the core

Run commands from `.claude/workflows/red-green/`; the rendered script is `.claude/workflows/red-green.js`, one level up.

## Local checkout

To work on the plugin, add a checkout as the marketplace instead of the GitHub repository:

```sh
claude plugin marketplace add --scope project /path/to/red-green
claude plugin install --scope project red-green@red-green
```

It loads in place. A run launched by name uses the scripts as they were at session start, so an edit reaches it from
the next session. The path is committed with the project's settings and means nothing on another machine, so keep it
to yourself.

## Testing

```
node --test test_red_green.mjs template/test_render.mjs skills/test_mutate.mjs skills/test_run_gates.mjs skills/test_contracts.mjs test_trace.mjs
```

A change to the core's control flow gets a case in `test_red_green.mjs`; one to the gate runner, in `skills/test_run_gates.mjs`; one to the contract CLI, in `skills/test_contracts.mjs`. A change that alters the render re-records the
sha256 values in [`template/fixtures.json`](../../.claude/workflows/red-green/template/fixtures.json) and the prompt hashes in `template/test_render.mjs`.

## Template

`template/` renders the core from `template/core/` (one file per block, shared files, an orchestrator), the defaults in
`template/defaults/` and a config. `red-green.js` is the render's output: change the template, then re-render and check
the copy:

```
node template/render.mjs > ../red-green.js
node template/render.mjs | diff - ../red-green.js
node template/render.mjs [config.json] --case case.json --prompt <label> [--json]  # one stage's prompt
node template/render.mjs [config.json] --check profile.json  # a profile through the config stage
```

The `// @part` and `// @include` mechanics are in [`render.mjs`](../../.claude/workflows/red-green/template/render.mjs); a missing part, or one included never or twice, is an error.

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
   [`template/defaults/review.md`](../../.claude/workflows/red-green/template/defaults/review.md); a new lens is also
   its entry in `LENSES` ([`template/core/review.js`](../../.claude/workflows/red-green/template/core/review.js)) and a part named by its key.
3. Add a stub test that the field moves the behaviour and a render test beside T03-T06; record a fixture variant when
   the ablation study varies it.


## Changing the prompts

An agent's how-to is the block's default, `template/defaults/<block>.md`; the contract part is in `template/core/<block>.js`.
New prompt text follows the `writing-for-agents` skill and the rules below. Each holds for any stage.

- **Prompts are code.** Every word in a stage prompt or a skill is paid on every call of that stage. A commit that edits
  one states the size change in bytes.
- **Fix the cause, not the agent.** When an agent keeps making a wrong move, fix the schema, the check or the input that
  let it before adding a sentence. A defect class that comes back after two written rules needs a check, a schema field
  or a deleted duplicate, not a third rule: a sentence forbidding a kind of evidence holds only once the script drops
  that kind.
- **Derive by code.** What the script can compute from earlier output (a list, a route, a copy of a statement), the
  script computes; an agent asked to restate it drifts. An id the agent must cite is an enum built per run, and the
  script expands it to its full text after the call.
- **Check what the schema states.** A limit or form the schema declares is also checked by the script. A failure gets
  one retry carrying the errors; an item the check cannot repair is dropped and reported, never passed on.
- **Tie output to the target.** Each item of output names what it serves, or says it is general; the script drops the
  rest and reports what nothing serves.
- **Only the branch the stage takes.** A stage gets the rules of its own branch: one that writes no code gets the no-code
  preamble and no commit or gate rules.
- **Gaps go to the result.** What a stage cannot settle is a typed question that goes to the result for a human, never
  into a later prompt. A free list nothing reads becomes a parking lot: delete it rather than narrow its wording.
- **Take the reading the source supports.** Where the ticket and the spec leave a choice open, the stage takes the
  reading their words support and states it, rather than leaving it unspecified.
- **One source per rule.** A rule lives in one part. A sentence several stages include holds for each of them.
- **Trim, then smoke.** Deleting a sentence changes behaviour: a smoke run follows every trim, since a line that looks
  redundant can be the one that holds an output's form.
- **Guardrails stay prohibitions.** State the target behaviour; a hard limit that positive wording did not hold keeps
  its prohibition, paired with the target.
- **Measure wording, not mechanics.** Mechanics ship under stub tests. A wording change is measured on the failing cases
  it names, and the budget is asked before a paid run.
- **Unmeasured rules stay out.** A design rule with no field of its own and no failing case to measure it on is not
  added; neither is a check that does not catch its target, or a branch whose output nothing reads.

## Dependencies

`workflow-doctor.sh` exits 1 on anything missing; `--help` says why each is needed.
