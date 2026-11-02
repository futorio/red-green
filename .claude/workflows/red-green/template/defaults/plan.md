<!-- Block plan: the plan and replan defaults, the case rules both include, the limit on tests the code lens includes too,
the replan's notes and the property rule's domain notes. -->
<!-- @part plan -->
STAGE: test-case planning.

{{> plan rules}}

{{> research section}}
<!-- @part replan -->
STAGE: test-case planning, the one replan.{{uncovered_note}}{{duplicates_note}}{{property_issues_note}} Keep every other case as it is, same id.

{{> plan rules}}

YOUR PREVIOUS CASES:
{{plan.cases}}

{{> research section}}
<!-- @part uncovered_note -->
 Your cases below leave {{uncovered}} uncovered: add cases for each.
<!-- @part duplicates_note -->
 These checks sit in several cases after the same Arrange and Act; keep each in one case. Each `check` reads `arrange | act | assert`: {{duplicates}}.
<!-- @part property_issues_note -->
 These property cases fail their checks: {{property_issues}}.
<!-- @part property_framework_note -->
 (in {{property_framework}}'s terms)
<!-- @part property_runner_note -->
 (JSON in the runner's language: {"int":[lo,hi]}, {"bytes":[min,max]}, {"string":[min,max],"chars":"<alphabet>"}, {"list":<domain>,"len":[min,max]}, {"tuple":[<domain>,...]}, {"oneof":[<domain>,...]} or {"const":<json>}, bounds inclusive; a claim over inputs it cannot state, such as objects, callbacks or state, stays a literal case)
<!-- @part limit -->
Test only requirement behaviour, an invariant, a boundary, an error or a regression. Never test doc or message wording, a constant, private structure, the framework itself, a getter, or whether a mock was called; assert an exact message only when a requirement names that message.
<!-- @part rules -->
cases: one case for each behaviour that {{test_ids}} name, their boundaries and rejections included. Each case goes through the seam its requirement's test_harness `how` names; every case is one test, and `requirement` is the id of the one requirement it checks. Each check lives in one case: a behaviour two requirements share is checked once, under the requirement that names it most directly. A case tests behaviour, not implementation: what a caller of the seam sees (inputs, outputs, effects, errors) and the stubs Arrange allows. How the test is written and run, and the code's inner structure (helpers, private names, call order), are the implementer's. {{> plan limit}}
AAA — Arrange: every input and object the case uses, written out in this case; the case runs the real code, and a stub stands in only for what a test cannot run (another program, the network, hardware, the clock), each stub with what it is given and what it returns or writes; Act: ONE call through the seam; asserts: atomic, one expected value or one property each, on what the Act leaves visible to a caller.
The ticket and the spec are the oracle: each expected value is a single literal taken from them, never recomputed the way the code would, and a default or precedence they leave open takes the reading their words support, stated in the case.
PROPERTY: a claim over a domain too large to enumerate gets a property case; a small finite domain is one case asserting a table of literal rows. Its `property`: `id` the contract id (dot-separated, module first), `statement` the claim in at most 255 characters, `source` the id of the requirement or the exact `where` of the listed fact that makes the claim (one location when it lists several), `domain` the inputs the claim covers{{property_framework_note}}{{property_runner_note}}, `mut` one wrong output per input the statement names, each of which the property must reject. Its Act runs over the domain and its asserts hold the property and the rejection of each `mut`; the one-Act and single-literal rules are for the other cases. When the seam `how` names costs too much per example, a property case may go through a lower one, saying so in its Act; a literal case keeps the named seam.
