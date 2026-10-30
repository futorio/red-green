# Tracing

`.claude/workflows/ticket-tdd/trace.mjs` turns a finished run into spans in a shape no runtime owns: `{label, model,
harness, project?, parent?, start, end, tokens: {in, out, cache_read, cache_write}, attrs}`. `attrs.kind` says what a
span is:

- `agent`: one agent call, with `status` (`ok`; `died`, an answer that is no object; `unfinished`, no answer) and the
  length of every list in its output, counted per `severity` or `status` (`findings.major`).
- `tool` (`parent` the call, `attrs.tool` its name): a tool call, so tests, builds and searches.
- `model` (`parent` the call): the call's time no tool covers. It carries the tokens of the messages that end in it, so
  a call's model spans add up to its tokens.
- `core`: the run's time between calls, when the script alone works.

```
cd .claude/workflows/ticket-tdd
node trace.mjs <wf dir> [--project NAME]               # spans as JSONL
node trace.mjs <wf dir> [--project NAME] --table       # calls, tokens, seconds per block and round
node trace.mjs <wf dir> [--project NAME] --chrome      # a timeline: open it in ui.perfetto.dev
node trace.mjs <wf dir> [--project NAME] --speedscope  # a flame chart and graph: open it in speedscope.app
```

A block's seconds sum its calls' durations, so parallel lenses can exceed wall time.

The one adapter reads a Claude Code Workflow run (`harness` `claude-code-workflow`) from
`~/.claude/projects/<project>/<session>/subagents/workflows/wf_<id>/`; `project` is the launch directory unless
`--project` names it. Claude Code deletes those files after a while, so the main thread saves the spans to
`<run>/trace.jsonl` right after the run ([`README.md`](README.md), step 4).
