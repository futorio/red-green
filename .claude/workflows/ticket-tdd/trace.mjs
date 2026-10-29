// Spans of a workflow run, one per agent call, in a runtime-neutral shape (README § Tracing):
// {label, model, harness, project?, start, end, tokens: {in, out, cache_read, cache_write}, attrs}. attrs holds the
// stage metrics, string or number values, untyped: the call's status and a count of every list in its output (and of
// each severity or status in it). The Claude Code Workflow adapter reads a run's directory
// (~/.claude/projects/<project>/<session>/subagents/workflows/wf_<id>/): journal.jsonl and agent-<id>.jsonl beside it.
//
//     node trace.mjs <wf dir> [--project NAME] [--table]    spans as JSONL, or the table per block and round
import { readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const jsonl = path => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))

// The stage metrics of one output: each list's length, and per item field severity or status its values' counts.
function metrics(output) {
  const out = {}
  for (const [k, v] of Object.entries(output || {})) {
    if (!Array.isArray(v)) continue
    out[k] = v.length
    for (const x of v) for (const f of ['severity', 'status']) if (x && typeof x[f] === 'string') out[`${k}.${x[f]}`] = (out[`${k}.${x[f]}`] || 0) + 1
  }
  return out
}

// The session's launch directory names the project: the first cwd in <session>.jsonl, three levels above the run.
function sessionProject(dir) {
  try {
    const e = jsonl(`${resolve(dir, '../../..')}.jsonl`).find(e => e.cwd)
    return e && basename(e.cwd)
  } catch { return undefined }
}

export function claudeCodeSpans(dir, project = sessionProject(dir)) {
  const journal = jsonl(join(dir, 'journal.jsonl'))
  const results = new Map(journal.filter(e => e.type === 'result').map(e => [e.agentId, e.result]))
  return journal.filter(e => e.type === 'started').map(({ agentId, label }) => {
    const events = jsonl(join(dir, `agent-${agentId}.jsonl`))
    // A streamed answer is written as several events of one message: its last one carries the final usage.
    const messages = [...new Map(events.filter(e => e.type === 'assistant').map(e => [e.message.id, e.message])).values()]
    const sum = k => messages.reduce((n, m) => n + (m.usage[k] || 0), 0)
    const timed = events.filter(e => e.timestamp)
    const result = results.get(agentId)
    return Object.assign({ label, model: messages.length ? messages.at(-1).model : null, harness: 'claude-code-workflow' },
      project && { project }, {
        start: timed[0]?.timestamp, end: timed.at(-1)?.timestamp,
        tokens: { in: sum('input_tokens'), out: sum('output_tokens'), cache_read: sum('cache_read_input_tokens'), cache_write: sum('cache_creation_input_tokens') },
        attrs: Object.assign({ status: !results.has(agentId) ? 'unfinished' : result == null ? 'died' : 'ok' }, metrics(result)),
      })
  })
}

// A label's block, with its round when it has one: review:fix:r2 is fix-review's, fix:minor minor-fix's, replan plan's.
export function blockOf(label) {
  const [first, second] = label.split(':')
  const block = first === 'review' && second === 'fix' ? 'fix-review' : label === 'fix:minor' ? 'minor-fix' : first === 'replan' ? 'plan' : first
  const round = label.match(/:r(\d+)/)
  return round ? `${block} r${round[1]}` : block
}

// Calls, tokens and seconds summed per block and round, in order of first call; the total's seconds are the run's
// wall time, since parallel calls overlap.
export function table(spans) {
  const secs = s => (Date.parse(s.end) - Date.parse(s.start)) / 1000 || 0
  const rows = new Map()
  const add = (key, s, seconds) => {
    const r = rows.get(key) || { calls: 0, in: 0, out: 0, cache_read: 0, cache_write: 0, seconds: 0 }
    r.calls += 1
    for (const k of ['in', 'out', 'cache_read', 'cache_write']) r[k] += s.tokens[k]
    r.seconds += seconds
    rows.set(key, r)
  }
  spans.forEach(s => add(blockOf(s.label), s, secs(s)))
  const wall = (Math.max(...spans.map(s => Date.parse(s.end))) - Math.min(...spans.map(s => Date.parse(s.start)))) / 1000
  spans.forEach(s => add('total', s, 0))
  rows.get('total').seconds = wall
  const cols = ['calls', 'in', 'out', 'cache_read', 'cache_write', 'seconds']
  const line = (key, r) => key.padEnd(16) + cols.map(c => String(Math.round(r[c])).padStart(12)).join('')
  return ['block'.padEnd(16) + cols.map(c => c.padStart(12)).join(''), ...[...rows].map(([k, r]) => line(k, r))].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const flag = name => args.includes(name) && args.splice(args.indexOf(name), 1)
  const tabled = flag('--table')
  const p = args.indexOf('--project')
  const project = p >= 0 ? args.splice(p, 2)[1] : undefined
  const spans = claudeCodeSpans(args[0], project)
  console.log(tabled ? table(spans) : spans.map(s => JSON.stringify(s)).join('\n'))
}
