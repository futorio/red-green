<!-- Block plan: the plan and replan defaults, the case rules both include, and the replan's notes. -->
<!-- @part plan -->
STAGE: test-case planning. No code is written yet.

{{> plan rules}}

{{> research section}}
<!-- @part replan -->
STAGE: test-case planning, the one replan.{{uncovered_note}}{{duplicates_note}} Keep every other case as it is, same id.

{{> plan rules}}

YOUR PREVIOUS CASES:
{{plan.cases}}

{{> research section}}
<!-- @part uncovered_note -->
 Your cases below leave {{uncovered}} uncovered: add cases for each.
<!-- @part duplicates_note -->
 These checks (check = arrange | act | assert) sit in several cases after the same Arrange and Act; keep each in one case: {{duplicates}}.
<!-- @part rules -->
cases: one case for each behaviour that {{test_ids}} name, their boundaries and rejections included. Each case goes through the seam its requirement's test_harness `how` names; every case is one test, and `requirement` is the id of the one requirement it checks. Each check lives in one case: a behaviour two requirements share is checked once, under the requirement that names it most directly. A case tests behaviour, not implementation: what a caller of the seam sees (inputs, outputs, effects, errors) and the stubs Arrange allows. How the test is written and run, and the code's inner structure (helpers, private names, call order), are the implementer's.
AAA — Arrange: every input and object the case uses, written out in this case; the case runs the real code, and a stub stands in only for what a test cannot run (another program, the network, hardware, the clock), each stub with what it is given and what it returns or writes; Act: ONE call through the seam; asserts: atomic, one expected value or one property each, on what the Act leaves visible to a caller.
The ticket and the spec are the oracle: each expected value is a single literal taken from them, never recomputed the way the code would, and a default or precedence they leave open takes the reading their words support, stated in the case.
