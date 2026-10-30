# ticket-tdd

The ticket-tdd Workflow core: `docs/ticket-tdd/README.md`, the workflow script and its template.

A project's profile workflow loads the core from this checkout by absolute path (`args.core`), so a project needs the
checkout to run the workflow. Pin a version by checking out a tag or commit; a project's `docs/agents/ticket-workflow.md`
records the commit its profile was rendered against.

## Tests

    node --test .claude/workflows/ticket-tdd/test_ticket_tdd.mjs

The workflow is measured in the separate `~/projects/wf-ablation` repository, which runs against this checkout through
`TICKET_TDD_CORE`.
