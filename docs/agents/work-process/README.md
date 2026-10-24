# Development process

How an idea becomes merged code in this repository. Each step names the skill that runs it, what it
leaves behind, and when a change skips it.

```
grilling -> draft spec -> prototype -> /to-spec -> /to-tickets -> a session per ticket -> acceptance
            (optional, together)
```

## Steps

1. **Grilling** (`grilling`; the `grill` MCP keeps the session record). The user and the main thread
   settle the decisions the idea hangs on. Output: the decisions, carried into the next step. Skipped
   when the decisions are already written down.
2. **Draft spec** ([prototype.md](prototype.md#draft-spec)). The grilling session ends by writing
   `.scratch/<feature>/draft-spec.md`: decisions, starting points, the prototype question. The
   prototype runs in a fresh session from it, since grilling fills the context. Written only when a
   prototype follows.
3. **Prototype** ([prototype.md](prototype.md)). A spike in the session that lets the user try the
   grilling decisions before they are specified. Output: the draft spec with notes and a verdict, and
   a `proto/` branch that is never merged. Skipped when the user does not need to see it.
4. **Spec** (`/to-spec`). Output: `.scratch/<feature>/spec.md`; after a prototype, built from its
   draft spec. Skipped when an existing spec already covers the change.
5. **Tickets** (`/to-tickets`). Output: one file per ticket under `.scratch/<feature>/issues/`
   (`../issue-tracker.md`), set to `ready-for-agent` once its questions are answered.
6. **Implementation.** The main thread implements one ticket per session, in ticket order, test first.
   The `Blocked by:` lines are real. The workflow core is never run on itself: a change to it is made
   in the session with the user. After a prototype, a ticket names the `proto/` code of its part as
   reference; the session writes its own.
7. **Acceptance** (the main thread). It re-runs the checks, verifies every claim against the diff,
   closes the ticket's `Status:` and commits.

## Which steps a change takes

- **A new feature**: every step; one draft spec and one prototype for the whole idea is the usual case.
- **A design question alone**: grilling, draft spec and prototype; the verdict decides whether steps
  4-7 follow. `invalidated` sends the idea back to grilling.
- **A bug or a scoped change with a clear fix**: a ticket (step 5), then steps 6-7.
- **A docs-only or one-line change**: the main thread makes it in the session and commits it.

## Choosing checks

A check answers one question. A doubt is answered by the smallest check that answers it, never by running
everything at once. Start with the cheapest check that can answer the question; go up only when it cannot.
Say the expected time before starting a check that takes over 5 minutes.
