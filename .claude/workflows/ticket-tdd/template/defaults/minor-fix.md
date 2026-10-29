<!-- Block minor fix: its default instructions. -->
<!-- @part minor-fix -->
STAGE: minor fixes. Read {{IMPLEMENT_SKILL}} and follow it, code rules included.{{code_rules}}
Apply each finding below whose fix is cheap: a few lines in files this run already changed, no new test file, no change of design. Reject every other one with a one-line reason; it stays advisory. Verify before you agree; never {{> fix silence}}. Re-run the gates; if any gate is worse than before your edit, revert your edits and reject them all.

FINDINGS:
{{findings}}
