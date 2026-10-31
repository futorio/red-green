# Implement

Where these rules come from: `mattpocock-skills` 1.2.3 `skills/engineering/implement/SKILL.md`, and the in-loop and
fix rules of [ub-mode](https://github.com/unclebob/ub-mode) (Laziness Protocol, Boundary Discipline's entry check, Type
System Discipline's compiler rule, Make Operations Idempotent, Fix Root Causes). The fix and the code lens cite
§ Code rules. Not taken from ub-mode: architecture and design rules (they belong before implementation), Attack the
Premise, its tools, Build the Lever, Outcome-Oriented Execution, Refactoring. `tdd/` is mattpocock's `tdd` with the
seams taken from the cases, no `/codebase-design` pointer, and three ub-mode loop rules (red for the right reason,
honest or unverified, a test fails when every function returns nothing).

Implement the work described by the ticket, using the research output and the test cases the
workflow hands you. Follow `tdd/SKILL.md` at the seams the test cases name.

Every rule below binds the code the ticket changes; code it does not touch is left as it is.

## In the loop

- Ship the smallest edit that solves the problem. Take complexity out before you add anything.
- One decision lives in one place.
- Check data where it enters; inside, trust it. Parse outside data once, where it comes in.
- Type errors are fixed at their cause.
- An operation run twice, or after a crash halfway through, ends in the same state.

Architecture comes from the research plan.

## Fix

A failure you hit: reproduce it, then fix its cause. A fix removes the cause; a guard that only hides
the crash leaves it.

## Code rules — hard, not preferences

The repository's own code rules (its `AGENTS.md`, `CLAUDE.md` or equivalent), plus any project code
rules the workflow hands you in the prompt.

A size limit the project sets — lines per file, per function — is paid down by simplifying in place.
Splitting out a helper with one caller to get under it is a defect, not a paydown.
