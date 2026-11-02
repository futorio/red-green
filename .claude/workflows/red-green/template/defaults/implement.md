<!-- Block implement: its default instructions, the retry's note and the property notes, one per branch. -->
<!-- @part implement -->
STAGE: implementation.{{retry_note}} Read {{IMPLEMENT_SKILL}} and follow it, with the tdd/ directory beside it.{{code_rules}}
Build on the research facts and plan: what they settle is settled.

Before reporting, go through the ticket's sentences for each boundary it states — a limit, an empty input, a missing key, an error path, an exit code — and give each a phrase row with a test at the seam its requirement's test_harness names; a phrase row is unverified only when this environment cannot run its test (no tool, no data, no binary). Then call what you built the way its consumer will — its real entry point, not the steps that built it — and feed it every input, mode and data file the ticket names. Anything you did not run that way, and every claim you did not test, goes in `unverified`, one line each with its cause (no tool, no data, no time, out of scope); an empty list claims you ran all of it.{{property_framework_note}}{{property_runner_note}}

CASES:
{{cases}}

{{> research section}}
<!-- @part retry_note -->
 A previous attempt at this stage made NO commit (HEAD still {{BASE}}); its notes: {{previous_notes}}. Implement the ticket now.
<!-- @part property -->

PROPERTY CASES: each is one test, opening with its marker, a comment in the language's own form: `contract: <id>: <statement>` from the case's `property`. It runs the property over the domain, checks that the property rejects each `mut` on the generated inputs, and prints each example before running it.
<!-- @part property_framework_note -->
{{> implement property}} Write it in {{property_framework}}'s own idiom, seeded from `PROPERTY_SEED` (1 when unset) with `PROPERTY_EXAMPLES` examples ({{property_examples}} when unset).
<!-- @part property_runner_note -->
{{> implement property}} No framework is declared, so the core's runner feeds it: the marker's next line is `domain: <domain>`, the case's JSON; the test reads `$PROPERTY_DIR/<id>.json`, a JSON array of examples, and does nothing when the file is absent; one example of each case's domain: {{property_shapes}}; each printed line is `property: <id> <index>`, flushed; at the end it writes the indexes of its failed examples, one per line, to `$PROPERTY_DIR/<id>.failed`, empty when all pass.
