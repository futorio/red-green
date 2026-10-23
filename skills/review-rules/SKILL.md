---
name: review-rules
description: After a retro, turn its coding-standards candidates into measured review rules for the ticket-tdd lenses; also re-checks and retires active rules.
disable-model-invocation: true
argument-hint: <project root> [retro candidates, a file of them, or "recheck"]
---

Runs after `mattpocock-skills:retro`. Retro's **Coding standards** category is the mining step: the reviewer missed a mistake, so a rule is proposed. This skill adds what retro leaves out: every rule is **measured** with the ablation suite before a lens sees it, recorded with its numbers, and re-measured until it stops paying.

`$0` is the project root. With "recheck", skip to step 6. `CORE` is `~/projects/ticket-tdd`.

## 1. Gather

Candidates come from:

- retro's Coding standards candidates (this session's retro, or the list or file in the arguments);
- majors only a later review round found (`hard` majors in the suite's cases);
- jury-confirmed unmatched findings (`"real"` verdicts in a batch's `queue*.json`): two of one kind make a candidate;
- episodes from the session pipeline (`~/projects/ticket-tdd-runs/sessions/candidates.md`).

Done when each candidate names the defect, the case or commit it came from, and its source kind.

## 2. Classify

A **mechanical** defect (a fixed pattern, a banned API, an import shape, a file location, a count) gets a deterministic check in the project's own guardrail: its gate command, linter config or CI. Write that as a ticket and drop the candidate. A **judgement** defect (cross-file consistency, the order of events, a contract between two places) goes on.

Done when every candidate is one of the two, with one line why.

## 3. Write the candidate

One file per rule, `$0/docs/agents/review-rules/<id>.md` (format below), `status: candidate`. The rule names a class of defect and the check that finds it: a **principle**, never the file, the line or the fix of the case it came from. A rule whose text fits any codebase keeps `general: true`. If the project keeps a `CODING_STANDARDS.md` (retro's store), it holds one line pointing at this directory, and the rules live only here.

Pick the cases: at least 3 **targets** (cases holding a major of the rule's class; build new ones per `CORE/ablation/README.md` § Case format when the suite has too few) and at least 3 **controls** (the project's cases whose majors lie outside the class). Mark the cases the rule was mined from as `source`: they are reported, never counted toward the bar.

Done when the file lists its targets and controls, and `node CORE/.claude/workflows/ticket-tdd/review-rules.mjs $0/docs/agents/review-rules` accepts it.

## 4. Evaluate

Model runs spend the weekly quota: ask the user before starting one.

1. `uv run --script CORE/ablation/suite.py rule-exp <rule file> --grid 2 --out <exp.json>` writes the paired experiment: the default variant against the same variant with the rule, on its targets and controls.
2. `suite.py batch <exp.json> --pace ~/projects/ticket-tdd-runs/pace.sh`, TMPDIR under `~/projects/ticket-tdd-runs`.
3. `CORE/ablation/jury.py run` on the unmatched findings, so precision is judged.

Done when the report gives the bar's four numbers (below) for the rule.

## 5. Record

Append one `evidence` entry. `status: active` when the bar is met, else it stays `candidate` with the reason in `notes`, or becomes `retired` when a second evaluation fails too. Regenerate the profile's rule block: `node CORE/.claude/workflows/ticket-tdd/review-rules.mjs $0/docs/agents/review-rules --profile <profile.js> --write`. Commit per the project's commit rules.

Done when the file, the profile block and `review-rules.mjs --check` agree.

## 6. Re-check

Due for every active rule whose last evidence is 90 days old or predates a change to the core's review stage (`git -C CORE log --since=<date> -- .claude/workflows/ticket-tdd/template`): rerun steps 4-5. A failed bar retires the rule; so does a cost the user rules too high for its gain.

Done when every active rule has evidence newer than both.

## 7. Core candidate

A `general: true` rule active in two projects that also passes the bar on the core's general cases (`CORE/ablation/cases/order-*` style) is proposed to the core as a template duty, default off until its own grid run. Write that as a ticket in the study that owns the core.

## Bar

Per case, the with-rule run wins, loses or ties on majors found (ties dropped).

1. **Recall**: P(with beats without) ≥ 0.8, from Beta(1 + wins, 1 + losses) over the target cases, source cases excluded.
2. **Controls**: no control major the without-variant found is lost.
3. **Precision**: jury-judged precision of the with-variant at most 0.05 below the without-variant's.
4. **Cost**: mean $ per run of both, recorded; not gated.

## Format

```markdown
---
id: same-frame
lens: code            # checklist | code
status: candidate     # candidate | active | retired
general: false
source: {kind: later-round-major, ref: "p1a-same-frame TH-097"}   # session-episode | later-round-major | jury-finding | retro
targets: [p1a-same-frame]
controls: []
source_cases: [p1a-same-frame]
evidence:
  - {date: 2026-10-23, experiment: exp1, cases: "p1a-same-frame", with: "2/2", without: "1/7", p_better: null, precision_with: 0.98, precision_without: 0.94, cost_with: 1.38, cost_without: 1.70, note: "not paired; the rule was written after seeing TH-097"}
notes: ""
---
SAME-FRAME RULE: the exact text appended to the lens, one paragraph.
```

The body is the text the lens receives, verbatim.
