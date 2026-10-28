# Implement

Built from `mattpocock-skills` 1.2.3, `skills/engineering/implement/SKILL.md` (vendored because upstream
sets `disable-model-invocation: true` and a workflow agent cannot load it), and from the rules of
[ub-mode](https://github.com/unclebob/ub-mode) for the TDD loop, in-loop code rules and fixing. The
`tdd` skill beside it (`tdd/`) is vendored; its `SKILL.md` takes the seams the cases name with no
confirmation from a user, gains three ub-mode loop rules, and no longer points refactoring at the
`code-review` skill. Changes against upstream implement:

- `/tdd` points at `tdd/SKILL.md` here; the seams and cases come from the test-case planning stage,
  not from the user; "use /code-review" is dropped: review is its own stage of the workflow;
- the in-loop and fix sections are ub-mode's, bound to the code the ticket changes; not taken: its
  architecture and design rules (data shape first, Redesign From First Principles, Model the Domain,
  pure business logic, separate shared state), Attack the Premise, Build the Lever, Crapper, Dryer,
  Mutator, Refactoring, Keep a Log, Guard the Context Window, Worktree Cleanup, Commit and Push;
- the code rules section points at the repository's rules and the workflow's `profile.code_rules`,
  and adds the size-paydown rule.

Every rule below binds only the code the ticket changes; code it does not touch is left as it is.

## The work

Implement the work described by the ticket, using the research output and the test cases the
workflow hands you.

Follow `tdd/SKILL.md` at the seams the test cases name. The cases are a plan, not a batch: take them
one at a time, red then green, one test → one minimal implementation per cycle.

Run the static gates and single test files regularly, and the full test suite once at the end.

Commit your work to the current branch as you go, as the workflow's commit rule says.

## In the loop

- Ship the smallest edit that solves the problem. Take complexity out before you add anything.
- One decision lives in one place.
- Check data where it enters; inside, trust it. Parse outside data once, where it comes in.
- Do not silence the compiler.
- An operation run twice, or after a crash halfway through, ends in the same state.

You make no architecture decision. A redesign, or any question of architecture, goes in `questions`
and is not acted on.

## Fix

A failure you hit: reproduce it, then fix its cause. A guard that only hides the crash is not a fix.

## Code rules — hard, not preferences

The repository's own code rules (its `AGENTS.md`, `CLAUDE.md` or equivalent), plus any project code
rules the workflow hands you in the prompt. They bind the code you write or change; code you do not
touch is not rewritten to meet them.

A size limit the project sets — lines per file, per function — is paid down by simplifying in place.
Splitting out a helper with one caller to get under it is a defect, not a paydown.
