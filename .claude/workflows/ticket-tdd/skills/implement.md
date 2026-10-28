# Implement

Where these rules come from: README § Stages › Implementation.

Implement the work described by the ticket, using the research output and the test cases the
workflow hands you. Follow `tdd/SKILL.md` at the seams the test cases name.

Every rule below binds the code the ticket changes; code it does not touch is left as it is.

## In the loop

- Ship the smallest edit that solves the problem. Take complexity out before you add anything.
- One decision lives in one place.
- Check data where it enters; inside, trust it. Parse outside data once, where it comes in.
- Type errors are fixed at their cause.
- An operation run twice, or after a crash halfway through, ends in the same state.

Architecture comes from the research plan. A redesign, or any question of architecture, is reported,
not acted on.

## Fix

A failure you hit: reproduce it, then fix its cause. A fix removes the cause; a guard that only hides
the crash leaves it.

## Code rules — hard, not preferences

The repository's own code rules (its `AGENTS.md`, `CLAUDE.md` or equivalent), plus any project code
rules the workflow hands you in the prompt.

A size limit the project sets — lines per file, per function — is paid down by simplifying in place.
Splitting out a helper with one caller to get under it is a defect, not a paydown.
