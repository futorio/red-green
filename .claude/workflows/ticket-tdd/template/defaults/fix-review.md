<!-- Block fix review: its default instructions and the test-case review duty's clause. -->
<!-- @part fix-review -->
STAGE: fix review, HEAD {{HEAD}}. A fix moved HEAD from {{from_head}}; no full review round follows it. Review its diff, `git diff {{from_head}}..HEAD`, and only that: (1) each finding it was given is fixed by the diff or rightly rejected; (2) the diff breaks nothing it touches — a sibling caller, another writer of the same state{{duty.test_case_review_fix}}. The gates step checks this HEAD after you.
GIVEN:
{{given}}

{{> research section}}
<!-- @part duty.test_case_review_fix -->
; (3) no test was weakened, deleted or left asserting nothing it promises
