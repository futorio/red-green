# ticket-tdd

The ticket-tdd Workflow core (`.claude/workflows/ticket-tdd/README.md`) plus a Claude Code plugin that ships its
skills (`skills/`; today `review-rules`).

## Install

    /plugin marketplace add ~/projects/ticket-tdd
    /plugin install ticket-tdd@ticket-tdd

Skills then resolve as `ticket-tdd:<skill>`. Do not link the core's skills into `~/.claude/skills/`.

The plugin carries only skills. The workflow script and its template are not in it: a project's profile workflow
loads them from the core checkout by absolute path (`args.core`), so a project needs the checkout, not the plugin
cache, to run the workflow.

## Update

    /plugin marketplace update ticket-tdd

then `/plugin update ticket-tdd@ticket-tdd`. For a local-path marketplace this reads the checkout's current state.

## Version pinning

`version` in `.claude-plugin/plugin.json` is the core version. Bump it (semver) on any change a project's rendered
profile or the skills depend on: the `args.profile` contract, prompts, skill behaviour. Docs-only changes need no bump.

A project pins a version by adding the marketplace at a tag or commit instead of the moving checkout:

    /plugin marketplace add <repo-url>#v0.1.0

and tags each bump (`git tag v<version>`). A project's `docs/agents/ticket-workflow.md` records the version its profile
was rendered against.

## Review rules: core or project

General review checks are core duties in the template. A narrow check is a project review rule: one file in the
project's `docs/agents/review-rules/` with its status and evidence, appended to its lens through
`profile.review_rules` once active. A candidate becomes active only after a paired suite run with and without it.
A mechanical defect gets a deterministic check, never a rule. The `review-rules` skill runs after Matt Pocock's
`retro` on its coding-standards candidates: evaluate, record, re-check, retire. A rule that pays on two projects
and on the core's general cases becomes a core candidate. A project with `CODING_STANDARDS.md` points it at the
directory. Decided by the user on 2026-10-23, after the order-rule study.

## Tests

    node --test test_plugin.mjs      # manifests and skill frontmatter
    claude plugin validate .
