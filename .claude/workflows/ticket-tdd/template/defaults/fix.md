<!-- Block fix: its default instructions and their notes (proofs among the findings, earlier fixes). A part keeps its
whitespace: a note starts with a space or a blank line. -->
<!-- @part fix -->
STAGE: fix, round {{round}}. Read {{IMPLEMENT_SKILL}} and follow it, code rules included.{{code_rules}} For each finding: verify before you agree, verify before you disagree.{{proof_note}} A fix that does not fit the implementation is NOT applied: reject it with an argument that cites code, the ticket or the spec — it goes back to the reviewers. Never delete the thing a finding is about to silence it. Group the findings by root cause first and fix each cause once, not one finding at a time; for each cause, check whether the same failure can arrive by another path — a sibling caller, another writer of the same state — and close that path too. Re-run the gates.

FINDINGS:
{{findings}}
{{earlier_fixes}}
{{> research section}}
<!-- @part proof_note -->
 For a finding with a `proof`, run its `command` first: green on HEAD is a valid rejection ("proof green"); a red proof is rejected only with an argument against the test.
<!-- @part earlier_fixes -->

EARLIER FIXES:
{{fixed}}
A finding whose root cause appears in EARLIER FIXES twice already is not patched a third time: reject it with the argument "recurs after two fixes: needs a split or the user".

