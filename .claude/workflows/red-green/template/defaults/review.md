<!-- Block review: one default per lens (a part named by its key in LENSES), the head and frame both include, the
lenses' notes, the duties' sentences and the words for a weakened test they share. A part keeps its
whitespace: some notes start with a space or a blank line, the test-case review duty ends with a space. -->
<!-- @part checklist -->
{{> review head}} checklist. Review the change against its statement. For each requirement id — {{check_ids}} — the promise is the sentence of the statement it rests on, whatever the code, its docs or its tests say. Then find a counterexample: the input or path most likely to make the promise false on the diff `git diff {{BASE}}..HEAD` — a boundary, an empty or malformed input, an error path, an exit code, a second caller.{{verify_review_note}} Scope: a change the statement does not call for is a finding.{{unverified_note}}
{{> review frame}}
<!-- @part code -->
{{> review head}} code. Read the code as code: would every new branch execute as intended{{runtime_note}}, is every new assertion falsifiable. For each check, guard, clamp or documented promise the diff adds, name one input on which it passes while the property it promises is false. Also the rules of {{IMPLEMENT_SKILL}} § Code rules. Over-built code is a finding.{{duty.order}}{{code_rules}}
{{> plan limit}} A test in the diff that breaks this is a major whose `trigger` is that test.{{property_note}}
{{duty.test_case_review}}If the diff holds no production source (only tests, docs, data or config), check one row saying so, review only the tests, and stop.
{{> review frame}}
<!-- @part head -->
STAGE: review, round {{round}} of at most {{rounds}}. Lens:
<!-- @part frame -->
The gates step ran the fast and round gates at this HEAD, not the acceptance gates; review the diff and its rows below.{{red_gates_note}}
GATES:
{{gate_rows}}
Compare against the statement ({{TARGET}} and every document it points to, as written before the code) and the research plan below.
{{earlier_findings}}{{last_fix_note}}{{duty.test_case_review_fix}}
{{> research section}}
<!-- @part verify_review_note -->
 These have no test and are checked only by you: {{verify_review}}.
<!-- @part unverified_note -->
 Implementation said it did not test: {{unverified}}; weigh each against the requirement it touches.
<!-- @part red_gates_note -->
 Still red after {{attempts_made}} attempts at a fix: {{red_gates}}. Weigh the code knowing that.
<!-- @part earlier_findings -->

EARLIER FINDINGS (a fixed one stays closed, also as a broader future risk; re-raise a rejected one only as a finding whose `problem` answers its `argument`):
{{history}}

<!-- @part last_fix_note -->
THE LAST FIX: on `git diff {{from_head}}..HEAD`, verify that each `fixed` finding below is fixed and that each `rejected` one's `argument` holds against the code; a claim that fails is a new major.
OUTCOMES:
{{last_fix}}
<!-- @part duty.test_case_review_fix -->

A test that diff {{> review weakened}} is a new major too.
<!-- @part duty.order -->
 ORDER RULE (experiment draft): for each piece of state the diff adds or writes, list every path that changes it (handlers, callbacks, requests, retries, timers). For any two that can land in one unit of processing (tick, frame, event-loop turn, request, transaction, the span between two awaits), check the result in both orders and with one of them repeated; a result that depends on order or repetition is a finding whose trigger names both events.
<!-- @part property_note -->
 A property test (one with a `contract:` marker) lacking the check that its property rejects each named wrong output is a major whose `trigger` is that test.
<!-- @part runtime_note -->
 in {{config.runtime}}
<!-- @part duty.test_case_review -->
A test the diff {{> review weakened}} is a finding. 
<!-- @part weakened -->
weakened, deleted or left asserting nothing it promises
