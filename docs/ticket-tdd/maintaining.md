# Maintaining the core

## Testing the core

`test_ticket_tdd.mjs` (beside this file; run by hand with `node --test`, no dependency) evaluates
`ticket-tdd.js` as an async function with a stub `agent()` that returns recorded results keyed by label,
and checks what the script does with them: `tidy`, mutation survivors, checklist statuses, the
deduplicated leftover, the run status, and that the lenses start after the gates step and get its
rows. A change to the core's control flow gets a case there. Its V tests run the core's validator on every
agent schema, a valid sample and an invalid one per keyword the schema uses. `skills/test_mutate.mjs` (`node --test
skills/test_mutate.mjs`) runs the mutant runner on a throwaway git repository.

## Template

`template/` renders this core from `template/core/`, the Markdown defaults in `template/defaults/` (`blocks.md`) and a
config, for the ablation study. The core
stays hand-written; the template follows it, and `test_render.mjs` fails when the default config does
not render the core byte for byte, so a change to `ticket-tdd.js` is made in the template too.
`fixtures.json` holds the sha256 of the render of every config variant; `test_render.mjs` checks each, and a
change that alters the render re-records them.

`template/core/` holds one file per block, the files they share and an orchestrator:

| File | Holds |
| --- | --- |
| `orchestrator.js` | `meta`, the args, the round loop, findings, failures, the result |
| `proofs.js` | the proofs and strays bookkeeping: `proven`, `reconcile`, the stray sweep at the end |
| `shared.js` | text helpers, `validate`, `mergeBlocks`, the preambles and the contract part, `idOf` |
| `mailbox.js` | the mailbox and `ask()` |
| `registry.js` | the schema shorthands, `REGISTRY` and `INPUTS` assembled from the blocks' `inputs` parts with the paths several blocks share, `fill()` and `call()` |
| `gates.js` | gates discovery (schema, call), the gates step (schema, `runGates`) |
| `research.js` | its schema, the call, the checks that build the `research` value |
| `plan.js` | the case and cases schemas, the plan call, the coverage and duplicate checks, the replan |
| `implement.js` | its schema, the call and its retry |
| `review.js` | the review schemas and `LENSES`, `SEVERITY`, `CHECKED`, the lens call |
| `mutation.js` | its schema, `runMutation` |
| `fix.js` | its schema, `runFix` |
| `fix-review.js` | `fixReview` |
| `minor-fix.js` | the minor fix pass |

Each block file also has an `inputs` part: its `INPUTS` entry (the paths its instructions may name) and the registry
paths only it reads, with their schemas.

A file is a header comment, then parts, each opened by a `// @part <name>` line and running to the
next. The orchestrator's `main` part is the script: render replaces each of its
`// @include <file> <part>` lines by that part, then fills the two render-time slots: `{{blocks}}` with the merged
block defaults, `{{defaults}}` with every part of `template/defaults/` as `{<block>: {<part>: text}}`, its includes
resolved (every other `{{path}}` is a run-time template variable, `blocks.md`). A missing part, or one included
never or twice, is an error. The parts sit where the single script needs them, so a block's schema
and its call can be far apart in the render.

Adding a block takes:

1. a new `template/core/<block>.js`, and an `// @include <block> <part>` line in `orchestrator.js` for each of
   its parts (render reads every file in `template/core/` but the orchestrator as a set of parts, so no list in
   `render.mjs` changes);
2. its `inputs` part: `INPUTS.<block>`, every path in it a `REGISTRY` path, and a new path only it reads added to
   `BLOCK_PATHS` with its schema (a path several blocks read goes in `registry.js`); and its
   `template/defaults/<block>.md`, a part per call it makes;
3. a `blocks.<name>` entry in `default.json` with at least `model` and `effort`; a `model` of `null` also needs
   the block it follows in `FOLLOWS` (`orchestrator.js`);
4. its row in the file table above, and its block table in its `stages.md` section.

A config is JSON with one key, `blocks`, in the shape of `profile.blocks` (`blocks.md`); it names only what it
changes and merges over `default.json` the way `profile.blocks` merges at run time. The variant dimensions
the ablation study uses:

- `blocks.<name>.model`, `.effort`: per block.
- `blocks.review.lenses`: the review lenses, a list from `checklist` and `code`; a config's list replaces the default's.
- `blocks.review.duties`: `test_case_review` (on: the weakened-test sentence in the code lens and the fix review) and
  `order` (off; on adds a draft sentence to the code lens, marked "experiment draft" for the experiments
  to settle: any two paths that change one piece of state within one unit of processing, in both orders
  and repeated).

A key, block, field or duty the default does not name, or a value off its registry schema (an unknown lens
included), is an error.

```
node template/render.mjs [config.json]                                    # the workflow, on stdout
node template/render.mjs [config.json] --case case.json --prompt <label>  # one stage's prompt
node template/render.mjs [config.json] --case case.json --prompt <label> --json
```

`--prompt` runs the rendered script with stub agents and prints the prompt, mailbox note included, that
the agent labelled `<label>` (`review:r1:code`, `fix:r1`, ...) receives. The case is
`{ args, gate_lines, results }`: `args` override stub args (`target` is the ticket path, `base` the
commit the diff starts from: the prompt names both, the agent reads them; the stub args declare one gate,
`gates`; a case whose profile declares none gets a stub discovery step that finds that same gate), `gate_lines` are the lines of the declared gates, in order, in every gates step's rows (all `green`), and `results[label]` is an earlier stage's recorded result. Research, plan and implement
have stubs (one requirement); a stage behind a review round, such as a fix, needs the
round's results in the case. The replay passes `args.replay: true` (`args-and-profile.md`), so a recorded research is not re-checked: a plan step over 600 characters recorded before that limit reaches later prompts verbatim. A run that fails before the label (`config`, a `<label> input:` failure, a dead stage) is an error naming its stage and failures. `--json` prints `{ prompt, schema, model, effort }`: the call that agent
gets, which the ablation suite (`ablation/README.md` in the wf-ablation repo) hands to headless Claude Code.

## Adding a config field

1. Add the field to its block in `default.json` with the value that renders today's behaviour; a new duty
   is off by default.
2. Give it a schema in the registry as `config.<field>` (a new duty: its boolean in `config.duties`), and read it
   in the core as `CONFIG.<block>.<field>`. A value an instruction names also goes in the block's `INPUTS` entry (its `inputs` part); a
   duty's sentence is a note in `template/defaults/review.md` named `duty.<name>`, its value the boolean.
3. Add a stub test that the field moves the behaviour, and a render test beside T03-T06 (it changes only
   the block defaults line). Record a variant in `fixtures.json` when the ablation study varies it (T13).

A new lens is its entry in `template/core/review.js`'s `LENSES` and its part in `template/defaults/review.md`; its
key is the name `blocks.review.lenses` takes and the part's name.

## Changing the prompts

**Prompts are code.** Every word in a stage prompt or a skill is paid on every call of that stage; a block's how-to
is its part in `template/defaults/`, its contract part is in its `template/core/` file. A commit that edits one
states the size change in bytes. When an agent keeps making the wrong move, fix
the schema, the check or the input it is given — the thing that let it make that move — before adding
one more sentence telling it not to.

**Discipline is not a fix.** After a fix, ask: had it existed six months ago, could today's failure
still have arrived by another path? If a class of defect already has two written rules and comes back,
a third rule is not the answer: the fix is a check, a schema field or a deleted duplicate. Prefer
removing the surface the defect lives on to adding a gate over it. The same question is put to the fix
stage about the code.

## Dependencies

`workflow-doctor.sh` checks them and exits 1 on anything missing; `--help` says why each is needed.
