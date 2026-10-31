<!-- Block fix: its default instructions, the rule against silencing a finding the minor fix includes too, and the
earlier fixes' note. A part keeps its whitespace: the note starts with a blank line. -->
<!-- @part fix -->
STAGE: fix, round {{round}}. Read {{IMPLEMENT_SKILL}} and follow it, code rules included.{{code_rules}}
Verify each finding first. A fix that does not fit the implementation is NOT applied: reject it with an argument that cites code, the ticket or the spec — it goes back to the reviewers. Never {{> fix silence}}. Group the findings by root cause first and fix each cause once, not one finding at a time; for each cause, check whether the same failure can arrive by another path — a sibling caller, another writer of the same state — and close that path too. Re-run the gates.

FINDINGS:
{{findings}}
{{earlier_fixes}}
{{> research section}}
<!-- @part silence -->
delete the thing a finding is about to silence it
<!-- @part earlier_fixes -->

EARLIER FIXES:
{{fixed}}

