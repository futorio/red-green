# ticket-tdd agent rules

## Language

Every file in this repository is written in English: code, comments, docs, tickets, specs and commit messages. Sessions with the user may be held in any language; the conversation's language never leaks into files.

## Commit messages

See `docs/agents/commits.md`.

## Agent skills

### Issue tracker

Local markdown under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) as `Status:` lines. See `docs/agents/triage-labels.md`.

### Development process

An idea goes grilling → draft spec → prototype → spec → tickets → a session per ticket. Which steps a change takes, and each step's rules: `docs/agents/work-process/README.md`.
