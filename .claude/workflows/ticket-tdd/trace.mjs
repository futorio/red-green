// Spans of a workflow run, one per agent call, in a shape no runtime owns. README § Tracing.
//
//     node trace.mjs <wf dir> [--project NAME] [--table]    spans as JSONL, or the table per block and round
import { readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOKENS = ['in', 'out', 'cache_read', 'cache_write']
const jsonl = path => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))

// The stage metrics of one answer: each list's length, and per item field severity or status its values' counts.
function metrics(answer) {
  const out = {}
  for (const [k, v] of Object.entries(answer)) {
    if (!Array.isArray(v)) continue
    out[k] = v.length
    for (const x of v) for (const f of ['severity', 'status']) {
      const key = `${k}.${x && x[f]}`
      if (x && typeof x[f] === 'string') out[key] = (out[key] || 0) + 1
    }
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

// The Claude Code Workflow adapter: journal.jsonl gives each agent's label and answer, agent-<id>.jsonl its times,
// model and usage. An answer that is no object (text, null) is a died call; no answer at all, an unfinished one.
export function claudeCodeSpans(dir, project = sessionProject(dir)) {
  const journal = jsonl(join(dir, 'journal.jsonl'))
  const answers = new Map(journal.filter(e => e.type === 'result').map(e => [e.agentId, e.result]))
  return journal.filter(e => e.type === 'started').map(({ agentId, label }) => {
    const events = jsonl(join(dir, `agent-${agentId}.jsonl`))
    // A streamed answer is written as several events of one message: its last one carries the final usage.
    const messages = [...new Map(events.filter(e => e.type === 'assistant').map(e => [e.message.id, e.message])).values()]
    const sum = k => messages.reduce((n, m) => n + (m.usage[k] || 0), 0)
    const timed = events.filter(e => e.timestamp)
    const answer = answers.get(agentId)
    const answered = answer !== null && typeof answer === 'object'
    return Object.assign({ label, model: messages.length ? messages.at(-1).model : null, harness: 'claude-code-workflow' },
      project && { project }, {
        start: timed[0]?.timestamp, end: timed.at(-1)?.timestamp,
        tokens: { in: sum('input_tokens'), out: sum('output_tokens'), cache_read: sum('cache_read_input_tokens'), cache_write: sum('cache_creation_input_tokens') },
        attrs: Object.assign({ status: answered ? 'ok' : answers.has(agentId) ? 'died' : 'unfinished' }, answered && metrics(answer)),
      })
  })
}

// A label's block, with its round when it has one. Labels whose first segment is not their block's name:
const ALIAS = { 'review:fix': 'fix-review', 'fix:minor': 'minor-fix', replan: 'plan' }
export function blockOf(label) {
  const [first, second] = label.split(':')
  const block = ALIAS[`${first}:${second}`] || ALIAS[first] || first
  const round = label.match(/:r(\d+)/)
  return round ? `${block} r${round[1]}` : block
}

// Calls, tokens and seconds summed per block and round, in order of first call. A block's seconds add its calls'
// durations, so parallel lenses can sum past the run; the total's seconds are the run's wall time.
export function table(spans) {
  const secs = s => (Date.parse(s.end) - Date.parse(s.start)) / 1000 || 0
  const sumOf = group => Object.assign({ calls: group.length }, ...TOKENS.map(k => ({ [k]: group.reduce((n, s) => n + s.tokens[k], 0) })))
  const blocks = new Map()
  spans.forEach(s => blocks.set(blockOf(s.label), (blocks.get(blockOf(s.label)) || []).concat(s)))
  const rows = [...blocks].map(([k, group]) => [k, Object.assign(sumOf(group), { seconds: group.reduce((n, s) => n + secs(s), 0) })])
  const wall = (Math.max(...spans.map(s => Date.parse(s.end))) - Math.min(...spans.map(s => Date.parse(s.start)))) / 1000
  rows.push(['total', Object.assign(sumOf(spans), { seconds: wall })])
  const cols = ['calls', ...TOKENS, 'seconds']
  const line = (key, cells) => key.padEnd(16) + cells.map(c => String(c).padStart(12)).join('')
  return [line('block', cols), ...rows.map(([k, r]) => line(k, cols.map(c => Math.round(r[c]))))].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const take = (name, n) => args.includes(name) ? args.splice(args.indexOf(name), n) : []
  const tabled = take('--table', 1).length
  const [, project] = take('--project', 2)
  const spans = claudeCodeSpans(args[0], project)
  console.log(tabled ? table(spans) : spans.map(s => JSON.stringify(s)).join('\n'))
}
