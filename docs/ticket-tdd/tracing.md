# Tracing

`trace.mjs` turns a finished run into spans in a shape no runtime owns: `{label, model, harness, project?, parent?,
start, end, tokens: {in, out, cache_read, cache_write}, attrs}`. `attrs` holds string or number values with no
schema; `attrs.kind` says what a span is:

- `agent`: one agent call. Its `status` (`ok`; `died`, an answer that is no object; `unfinished`, no answer at all)
  and its stage metrics: the length of every list in its output, with a count per `severity` or `status` value in it
  (`findings.major`, `mutants.survived`).
- `tool` (`parent` the call, `attrs.tool` its name): a tool call, from its request to its result. Not the agent's own
  work: tests, builds and searches run here.
- `model` (`parent` the call): the call's time no tool covers, the model reading and writing; it carries the tokens
  of the messages that end in it, so a call's model spans add up to its tokens.
- `core`: the run's time between agent calls, when the script alone works.

The core and its prompts know nothing of it. No money: tokens and the model only.

```
node trace.mjs <wf dir> [--project NAME]             # spans as JSONL
node trace.mjs <wf dir> [--project NAME] --table     # calls, tokens and seconds per block and round, core time, the total
node trace.mjs <wf dir> [--project NAME] --chrome      # a timeline: open it in ui.perfetto.dev
node trace.mjs <wf dir> [--project NAME] --speedscope  # a flame chart and graph: open it in speedscope.app
```

A block's seconds add its calls' durations, so parallel lenses can sum past the run; the total's are its wall time.
The Chrome trace has one track per agent call with its tool and model spans nested in it, a `core` track, and one
counter per token kind that steps at each model span; in Perfetto, click a span for its tokens, `f` zooms to it,
`w`/`s` and `a`/`d` zoom and pan. The speedscope file holds the whole run as three profiles, weighted by seconds,
input tokens (`in` + `cache_read` + `cache_write`) and output tokens, each a stack block > call > `model`, a tool or
`core`: Time Order is the flame chart, Left Heavy the flame graph, a click zooms. Both read the file in the browser;
nothing is uploaded.

The one adapter so far reads a Claude Code Workflow run (`harness` `claude-code-workflow`):
`~/.claude/projects/<project>/<session>/subagents/workflows/wf_<id>/`, its `journal.jsonl` (each agent's label and
result) and the `agent-<id>.jsonl` beside it (times, model, usage counted once per API message, each `tool_use`
paired with its `tool_result`). `project` is the
directory the session was launched in, unless `--project` names it. Another runtime gets its own adapter returning
the same spans. `test_trace.mjs` runs it on `trace-fixture/`, a real run with its text cut.
