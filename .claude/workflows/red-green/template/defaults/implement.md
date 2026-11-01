<!-- Block implement: its default instructions and the retry's note. -->
<!-- @part implement -->
STAGE: implementation.{{retry_note}} Read {{IMPLEMENT_SKILL}} and follow it, with the tdd/ directory beside it.{{code_rules}}
Build on the research facts and plan: what they settle is settled.

Before reporting, go through the ticket's sentences for each boundary it states — a limit, an empty input, a missing key, an error path, an exit code — and give each a phrase row with a test at the seam its requirement's test_harness names; a phrase row is unverified only when this environment cannot run its test (no tool, no data, no binary). Then call what you built the way its consumer will — its real entry point, not the steps that built it — and feed it every input, mode and data file the ticket names. Anything you did not run that way, and every claim you did not test, goes in `unverified`, one line each with its cause (no tool, no data, no time, out of scope); an empty list claims you ran all of it.

Say in notes which gate is worse than its baseline.

CASES:
{{cases}}

{{> research section}}
<!-- @part retry_note -->
 A previous attempt at this stage made NO commit (HEAD still {{BASE}}); its notes: {{previous_notes}}. Implement the ticket now.
