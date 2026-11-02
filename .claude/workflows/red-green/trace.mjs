// Spans of a workflow run in a shape no runtime owns: agent calls, the tool calls and model time inside each, and the
// core's time between calls. docs/red-green/tracing.md.
//
//     node trace.mjs <wf dir> [--project NAME]                  spans as JSONL
//     node trace.mjs <wf dir> [--project NAME] --table          the table per block and round
//     node trace.mjs <wf dir> [--project NAME] --chrome         a Chrome trace for Perfetto's timeline
//     node trace.mjs <wf dir> [--project NAME] --speedscope     a speedscope file: flame chart and flame graph
import { readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOKENS = { in: 'input_tokens', out: 'output_tokens', cache_read: 'cache_read_input_tokens', cache_write: 'cache_creation_input_tokens' }
const KEYS = Object.keys(TOKENS)
const t = Date.parse
const jsonl = path => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const tokensOf = messages => Object.fromEntries(KEYS.map(k => [k, messages.reduce((n, m) => n + (m.usage[TOKENS[k]] || 0), 0)]))

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

// The stretches of [start, end] no interval covers.
function gaps(start, end, intervals) {
  const out = []
  let at = start
  for (const [a, b] of intervals.slice().sort((x, y) => t(x[0]) - t(y[0]))) {
    if (t(a) > t(at)) out.push([at, a])
    if (t(b) > t(at)) at = b
  }
  if (t(end) > t(at)) out.push([at, end])
  return out
}

// The session's launch directory names the project: the first cwd in <session>.jsonl, three levels above the run.
function sessionProject(dir) {
  try {
    const e = jsonl(`${resolve(dir, '../../..')}.jsonl`).find(e => e.cwd)
    return e && basename(e.cwd)
  } catch { return undefined }
}

// The Claude Code Workflow adapter. journal.jsonl gives each agent's label and answer, agent-<id>.jsonl its times,
// model, usage and tool calls. An answer that is no object (text, null) is a died call; no answer at all, an
// unfinished one. Inside a call, a tool span runs from its tool_use to its tool_result, and the time no tool covers is
// model time, carrying the usage of the messages that end in it. Between calls, the time no call covers is core time.
export function claudeCodeSpans(dir, project = sessionProject(dir)) {
  const journal = jsonl(join(dir, 'journal.jsonl'))
  const answers = new Map(journal.filter(e => e.type === 'result').map(e => [e.agentId, e.result]))
  const zero = tokensOf([])
  const span = (label, model, start, end, tokens, attrs, parent) =>
    Object.assign({ label, model, harness: 'claude-code-workflow' }, project && { project }, parent && { parent }, { start, end, tokens, attrs })
  const out = []
  for (const { agentId, label } of journal.filter(e => e.type === 'started')) {
    const events = jsonl(join(dir, `agent-${agentId}.jsonl`))
    // A streamed answer is written as several events of one message: its last one carries the final usage.
    const last = [...new Map(events.filter(e => e.type === 'assistant').map(e => [e.message.id, e])).values()]
    const model = last.length ? last.at(-1).message.model : null
    const timed = events.filter(e => e.timestamp)
    const [start, end] = [timed[0]?.timestamp, timed.at(-1)?.timestamp]
    const answer = answers.get(agentId)
    const answered = answer !== null && typeof answer === 'object'
    out.push(span(label, model, start, end, tokensOf(last.map(e => e.message)),
      Object.assign({ kind: 'agent', status: answered ? 'ok' : answers.has(agentId) ? 'died' : 'unfinished' }, answered && metrics(answer))))
    const blocks = events.filter(e => (e.type === 'assistant' || e.type === 'user') && Array.isArray(e.message?.content))
      .flatMap(e => e.message.content.map(b => Object.assign({ at: e.timestamp }, b)))
    const done = new Map(blocks.filter(b => b.type === 'tool_result').map(b => [b.tool_use_id, b.at]))
    const tools = [...new Map(blocks.filter(b => b.type === 'tool_use').map(b => [b.id, b])).values()]
      .map(b => [b.at, done.get(b.id) || end, b.name])
    const thinking = gaps(start, end, tools)
    const owner = e => thinking.findLast(([a]) => t(a) <= t(e.timestamp)) || thinking[0]
    thinking.forEach(g => out.push(span(`${label}/model`, model, g[0], g[1], tokensOf(last.filter(e => owner(e) === g).map(e => e.message)), { kind: 'model' }, label)))
    tools.forEach(([a, b, name]) => out.push(span(`${label}/${name}`, null, a, b, zero, { kind: 'tool', tool: name }, label)))
  }
  const calls = out.filter(s => s.attrs.kind === 'agent' && s.start)
  if (calls.length) {
    const [first, last] = [calls.reduce((a, s) => t(s.start) < t(a) ? s.start : a, calls[0].start), calls.reduce((a, s) => t(s.end) > t(a) ? s.end : a, calls[0].end)]
    gaps(first, last, calls.map(s => [s.start, s.end])).forEach(([a, b]) => out.push(span('core', null, a, b, zero, { kind: 'core' })))
  }
  return out
}

// A label's block, with its round when it has one. Labels whose first segment is not their block's name: replan, and
// review:fix and fix:minor, of blocks a run no longer has, kept so --table can still split the older runs new ones are
// compared against.
const ALIAS = { 'review:fix': 'fix-review', 'fix:minor': 'minor-fix', replan: 'plan' }
export function blockOf(label) {
  const [first, second] = label.split(':')
  const block = ALIAS[`${first}:${second}`] || ALIAS[first] || first
  const round = label.match(/:r(\d+)/)
  return round ? `${block} r${round[1]}` : block
}

// Calls, tokens and seconds summed per block and round, in order of first call, and the core's time between calls.
// A block's seconds add its calls' durations, so parallel lenses can sum past the run; the total's seconds are the
// run's wall time.
export function table(spans) {
  const secs = s => (t(s.end) - t(s.start)) / 1000 || 0
  const sumOf = group => Object.assign({ calls: group.length, seconds: group.reduce((n, s) => n + secs(s), 0) },
    ...KEYS.map(k => ({ [k]: group.reduce((n, s) => n + s.tokens[k], 0) })))
  const top = spans.filter(s => !s.parent)
  const calls = top.filter(s => s.attrs.kind === 'agent')
  const blocks = new Map()
  top.forEach(s => blocks.set(blockOf(s.label), (blocks.get(blockOf(s.label)) || []).concat(s)))
  const wall = (Math.max(...calls.map(s => t(s.end))) - Math.min(...calls.map(s => t(s.start)))) / 1000
  const rows = [...blocks].map(([k, group]) => [k, sumOf(group)]).concat([['total', Object.assign(sumOf(calls), { seconds: wall })]])
  const cols = ['calls', ...KEYS, 'seconds']
  const line = (key, cells) => key.padEnd(16) + cells.map(c => String(c).padStart(12)).join('')
  return [line('block', cols), ...rows.map(([k, r]) => line(k, cols.map(c => Math.round(r[c]))))].join('\n')
}

const nameOf = s => s.attrs.kind === 'agent' ? s.label : s.attrs.kind === 'tool' ? s.attrs.tool : s.attrs.kind

// A Chrome trace for Perfetto's timeline: one track per agent call, its tool calls and model time nested in it, the
// core's time on a track of its own, and each token kind as a counter that steps at each stretch of model time. Track
// ids start at 2: Perfetto marks the track whose id equals the process's as its main thread.
export function chrome(spans) {
  const t0 = Math.min(...spans.map(s => t(s.start)))
  const us = at => Math.round((t(at) - t0) * 1000)
  const tracks = [...new Set(spans.map(s => s.parent || s.label))]
  const events = tracks.map((n, i) => ({ ph: 'M', name: 'thread_name', pid: 1, tid: i + 2, args: { name: n } }))
  for (const s of spans) events.push({ ph: 'X', name: nameOf(s), cat: s.attrs.kind, pid: 1, tid: tracks.indexOf(s.parent || s.label) + 2,
    ts: us(s.start), dur: Math.max(us(s.end) - us(s.start), 1), args: Object.assign({ model: s.model, parent: s.parent }, s.tokens, s.attrs) })
  const total = tokensOf([])
  for (const s of spans.filter(s => s.attrs.kind === 'model').sort((a, b) => t(a.end) - t(b.end)))
    KEYS.forEach(k => { total[k] += s.tokens[k]; events.push({ ph: 'C', name: `tokens.${k}`, pid: 1, ts: us(s.end), args: { [k]: total[k] } }) })
  return { traceEvents: events }
}

// A speedscope file for its flame chart and flame graph: the whole run as one profile per weight (seconds, input
// tokens, output tokens), each tool, model and core span a sample whose stack is block > call > work, in start order.
export function speedscope(spans) {
  const frames = []
  const frame = name => (frames.findIndex(f => f.name === name) + 1 || frames.push({ name })) - 1
  const leaves = spans.filter(s => s.attrs.kind !== 'agent').sort((a, b) => t(a.start) - t(b.start))
  const samples = leaves.map(s => (s.parent ? [blockOf(s.parent), s.parent, nameOf(s)] : [nameOf(s)]).map(frame))
  const profile = (name, unit, weigh) => {
    const weights = leaves.map(weigh)
    return { type: 'sampled', name, unit, startValue: 0, endValue: weights.reduce((n, w) => n + w, 0), samples, weights }
  }
  return {
    $schema: 'https://www.speedscope.app/file-format-schema.json', exporter: 'red-green trace.mjs', shared: { frames },
    profiles: [profile('seconds', 'seconds', s => (t(s.end) - t(s.start)) / 1000),
      profile('input tokens', 'none', s => s.tokens.in + s.tokens.cache_read + s.tokens.cache_write),
      profile('output tokens', 'none', s => s.tokens.out)],
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const take = (name, n) => args.includes(name) ? args.splice(args.indexOf(name), n) : []
  const [tabled, chromed, scoped] = ['--table', '--chrome', '--speedscope'].map(f => take(f, 1).length)
  const [, project] = take('--project', 2)
  const spans = claudeCodeSpans(args[0], project)
  console.log(tabled ? table(spans) : chromed ? JSON.stringify(chrome(spans)) : scoped ? JSON.stringify(speedscope(spans))
    : spans.map(s => JSON.stringify(s)).join('\n'))
}
