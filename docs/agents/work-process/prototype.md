# Prototype mode

A prototype is a **spike**: quick code that lets the user try a design before it is specified. The main thread
builds it in the session with the user, starting from the feature's **draft spec**. It ends on a verdict, and a
validated verdict is carried into a spec and tickets whose sessions implement it anew, with the spike's code as the
description of what to do and how it works (**stabilize**). This page builds on the `prototype` skill's shared
rules.

## Draft spec

Grilling fills the context, so the spike starts in a fresh session. The grilling session ends by writing
`.scratch/<feature>/draft-spec.md`, the only hand-over between the two. It is not a `/to-spec` spec: no user
stories, no test seams. It holds:

- `Status: draft` near the top, `Type: prototype`, and the grilling session id.
- **Question** and the **deciding observation**. By default the question is "does it work the way grilling
  decided?" and the observation is the user's judgement after trying it; a sharper one replaces it when grilling
  named one.
- **Decisions**: every grilling decision, one line each.
- **Starting points**: the files, symbols and docs the spike begins from.
- **Open**: questions grilling deferred, and what was assumed for them.
- **Notes**: appended during the spike (step 4); what was tried, observed and changed, with the commit it is in.

## Steps

1. **Question.** Read the draft spec; without one, run `grilling` first. Set `Status: claimed`. Done when the draft
   spec holds the question and the deciding observation.
2. **Branch.** `git switch -c proto/<feature> main`. Commit as often as is useful; messages start with
   `prototype:`. Done when the branch exists.
3. **Spike.** Write the least code that lets the user observe the answer. Everything else is skipped on purpose:
   tests, docs, error handling beyond what keeps it running, cleanup. One commit per concern where it is cheap, so
   a ticket can point at the code of its part. Done when the user can try it.
4. **Observe.** The user tries it; the main thread surfaces the state that bears on the question after each try
   and appends what was learned to the draft spec's Notes. Loop on steps 3-4 until the deciding observation is
   seen or refuted, or the user stops the spike. A decision the spike changes is edited in Decisions at once;
   Notes keeps the old value, the new one and why.
5. **Verdict.** Append `## Answer` to the draft spec: `validated` (as decided), `partial` (as decided but with the
   changes the user named, which join the decisions) or `invalidated` (back to grilling), what was observed, what
   remains open, and the branch name. Set `Status: resolved`. An invalidated branch is kept as evidence until the
   next grilling closes, then deleted. Done when the draft spec names the verdict and the branch.
6. **Stabilize.** For `validated` or `partial`, `/to-spec` turns the draft spec into `spec.md` (it adds the user
   stories and test seams) and reads the spike's diff for the implementation decisions. `/to-tickets` splits it;
   each ticket names the prototype commits or files of its part as reference. The spike's code is never carried
   over: the ticket is implemented anew, test first. Decisions are the source of truth; where the spike's code
   disagrees with them, the decision wins. The branch is never merged; it is deleted after the last ticket is
   merged.
