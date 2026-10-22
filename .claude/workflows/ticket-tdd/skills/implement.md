# Implement

Vendored from `mattpocock-skills` 1.2.3, `skills/engineering/implement/SKILL.md`, because upstream
sets `disable-model-invocation: true` and a workflow agent cannot load it. The `tdd` skill beside it
(`tdd/`) is vendored verbatim. Changes against upstream:

- `/tdd` points at `tdd/SKILL.md` here;
- the seams and cases come from the test-case planning stage, not from the user;
- "use /code-review" is dropped — review is its own stage of the workflow;
- the code rules section points at the repository's rules and the workflow's `profile.code_rules`,
  and adds the size-paydown rule.

## The work

Implement the work described by the ticket, using the research output and the test cases the
workflow hands you.

Follow `tdd/SKILL.md` at the seams the test cases name. The cases are a plan, not a batch: take them
one at a time, one test → one minimal implementation per cycle.

Run the static gates and single test files regularly, and the full test suite once at the end.

Commit your work to the current branch as you go, as the workflow's commit rule says.

## Code rules — hard, not preferences

The repository's own code rules (its `AGENTS.md`, `CLAUDE.md` or equivalent), plus any project code
rules the workflow hands you in the prompt. They bind the code you write or change; code you do not
touch is not rewritten to meet them.

A size limit the project sets — lines per file, per function — is paid down by simplifying in place.
Splitting out a helper with one caller to get under it is a defect, not a paydown.
