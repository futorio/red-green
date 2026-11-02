// Property contracts: reads the `contract: <id>: <statement>` markers in the files under the working directory that git
// tracks or does not ignore, as text in any language. A marker is a line holding only a comment opener (// # -- ; % /* *
// <!-- (*), in a Markdown file <!-- alone, then `contract:`; a closer (*/ --> *)) at its end is dropped. A `contract:`
// line with no opener is prose. An id is dot-separated segments of letters, digits, _ and -; contracts are grouped by
// its first segment. A statement is 255 characters at most.
//
// doc writes the contract doc to <path>. Exit 0 done; 1 an over-limit statement, a duplicate id or a malformed marker,
// nothing written (stderr names each); 2 it could not run. With --check it writes nothing and also exits 1 when <path>
// differs from what it would write. A `domain:` marker that does not parse or that run would reject is malformed.
//
// run is the property runner for a project with no framework. A contract whose next line is a `domain: <json>` marker
// gets --examples examples (100 by default) generated from --seed (1 by default) and its id, written as a JSON array to
// $PROPERTY_DIR/<id>.json; the example id is its index. It runs <test command> once, with PROPERTY_DIR, PROPERTY_SEED and
// PROPERTY_EXAMPLES set. A test reads its contract's file and, when the file is absent, does nothing; before running an
// example it prints `property: <id> <example id>` and flushes; at the end it writes the ids of the failed examples, one per
// line, to $PROPERTY_DIR/<id>.failed, empty when all passed. Exit 0 all passed; 1 red: a failed example, a non-zero
// exit, or no <id>.failed after one (red on the last example printed); 2 an error: a bad marker or domain, no <id>.failed
// after a clean exit, an id in <id>.failed not in <id>.json, or the command could not start. stderr names the seed and
// the first 3 failed examples of each contract, then counts the rest.
//
// A red contract's first failed example is then reduced: each rerun writes only that contract's file, holding the
// examples one step smaller by the domain (shorter lists, byte strings and strings, integers and characters toward the
// lower bound, earlier oneof choices, a tuple or record one element or field at a time), runs the command again and
// // keeps the first that fails, until none does or 100 reruns. stderr then names `<id>: example <example id> reduced in
// <n> reruns: <json>`, with `, stopped at the cap` after `reruns` when the 100 ran out.
//
// The domain language, by key: {"int": [lo, hi]}; {"bytes": [min, max]}, a list of byte values that long;
// {"string": [min, max], "chars"?: "<alphabet>"}, printable ASCII by default; {"list": <domain>, "len": [min, max]};
// {"tuple": [<domain>, ...]}; {"record": {"<name>": <domain>, ...}}, an object with those keys in that order, no name an
// integer; {"oneof": [<domain>, ...]}; {"const": <json>}. Bounds are integers, inclusive. A `domain:` may continue over
// the following comment lines with the same opener until its JSON is complete.
//
//     node contracts.mjs doc <path> [--check]
//     node contracts.mjs run [--seed <n>] [--examples <n>] -- <test command>
//
// Imported, it runs nothing: render.mjs inlines LIMIT, ID, KINDS and compile (with int and ASCII) into the core's plan
// check, and seq and least for implement's example of each domain.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const die = why => { process.stderr.write(`contracts: ${why}\n`); process.exit(2) }
export const LIMIT = 255
const SHOWN = 3
// A contract id: dot-separated segments of letters, digits, _ and -.
export const ID = /[\w-]+(?:\.[\w-]+)*/
const CONTRACT = new RegExp(String.raw`^\s*(${ID.source}):\s+(.*?)\s*(?:\*\/|-->|\*\))?\s*$`)
// A comment line in a file: its opener, then its text with any closer dropped. A Markdown file's only opener is <!--,
// since its bullets and headings start with * and #.
const OPENER = String.raw`\/\/+|#+|--|;+|%+|\/\*+|\*|<!--|\(\*`
const comment = opener => new RegExp(String.raw`^\s*(${opener})(.*?)\s*(?:\*\/|-->|\*\))?\s*$`)
const COMMENT = comment(OPENER), MD_COMMENT = comment('<!--')
// The raw text of a `domain:` marker at lines[i], or null. It continues over the following comment lines with the same
// opener until it parses as JSON; one that never does is returned whole, for scan to reject.
const domainAt = (lines, i, re) => {
  const m = re.exec(lines[i] ?? ''), d = m && /^\s*domain:(.*)$/.exec(m[2])
  if (!d) return null
  let text = d[1].trim()
  for (let j = i + 1; ; j++) {
    try { JSON.parse(text); return text } catch {}
    const c = re.exec(lines[j] ?? '')
    if (!c || c[1] !== m[1]) return text
    text += '\n' + c[2]
  }
}

// Every marker in the tracked and unignored files: {contracts: [{id, statement, file, line, domain}], problems: [string]}. `domain` is
// the parsed `domain:` marker on the next line, or null; one that does not parse or compile is a problem.
const scan = () => {
  const contracts = [], problems = []
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean)
  for (const file of files) {
    let text
    try { text = readFileSync(file, 'utf8') } catch { continue } // deleted in the tree, or a submodule
    if (text.includes('\0')) continue
    const lines = text.split(/\r?\n/), re = file.endsWith('.md') ? MD_COMMENT : COMMENT
    lines.forEach((l, i) => {
      const m = re.exec(l), body = m && /^\s*contract:(.*)$/.exec(m[2])
      if (!body) return
      const where = `${file}:${i + 1}`
      const c = CONTRACT.exec(body[1])
      if (!c || !c[2]) return problems.push(`${where}: malformed marker, want contract: <id>: <statement>`)
      const [, id, statement] = c
      if ([...statement].length > LIMIT) problems.push(`${where}: ${id}: statement is ${[...statement].length} characters, over ${LIMIT}`)
      const twin = contracts.find(x => x.id === id)
      if (twin) problems.push(`${where}: ${id}: duplicate id, also at ${twin.file}:${twin.line}`)
      let domain = domainAt(lines, i + 1, re)
      if (domain !== null) {
        try { domain = JSON.parse(domain); compile(domain) } catch (e) { problems.push(`${file}:${i + 2}: ${id}: domain: malformed marker: ${e.message}`) }
      }
      contracts.push({ id, statement, file, line: i + 1, domain })
    })
  }
  return { contracts, problems }
}

const render = contracts => {
  const out = ['# Property contracts', '', 'Generated by contracts.mjs doc from the contract markers; do not edit.']
  let group
  for (const c of [...contracts].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const g = c.id.split('.')[0]
    if (g !== group) out.push('', `## ${(group = g)}`, '')
    out.push(`- \`${c.id}\`: ${c.statement} (${c.file})`)
  }
  return out.join('\n') + '\n'
}

const doc = (path, check) => {
  const { contracts, problems } = scan()
  const text = render(contracts)
  if (check) {
    let old = null
    try { old = readFileSync(path, 'utf8') } catch {}
    if (old !== text) problems.push(`${path}: ${old === null ? 'missing' : 'stale'}, run contracts.mjs doc ${path}`)
  }
  if (problems.length) { process.stderr.write(problems.join('\n') + '\n'); process.exit(1) }
  if (!check) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
}

// A seeded generator (mulberry32): next() is uniform in [0, 1). random seeds it from a key.
const mulberry32 = s => () => {
  s = (s + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
}
const random = key => mulberry32(createHash('sha256').update(key).digest().readUInt32LE(0))
// An integer in [lo, hi], each bound one time in 16.
export const int = (next, lo, hi) => {
  const x = next()
  if (x < 1 / 16) return lo
  if (x < 1 / 8) return hi
  return Math.min(hi, lo + Math.floor((next() + next() / 2 ** 32) * (hi - lo + 1)))
}
export const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))
// Each domain kind: the other keys it takes, and its form as the plan prompt shows it.
export const KINDS = {
  int: [[], '{"int":[lo,hi]}'], bytes: [[], '{"bytes":[min,max]}'], string: [['chars'], '{"string":[min,max],"chars":"<alphabet>"}'],
  list: [['len'], '{"list":<domain>,"len":[min,max]}'], tuple: [[], '{"tuple":[<domain>,...]}'], record: [[], '{"record":{"<name>":<domain>,...}}'],
  oneof: [[], '{"oneof":[<domain>,...]}'], const: [[], '{"const":<json>}'],
}

// A domain to a generator: next => example. Throws on what the language cannot state.
export const compile = d => {
  const bad = why => { throw new Error(`${why}: ${JSON.stringify(d)}`) }
  const kind = d && typeof d === 'object' && !Array.isArray(d) && Object.keys(KINDS).find(k => k in d)
  if (!kind || Object.keys(d).some(k => k !== kind && !KINDS[kind][0].includes(k))) bad(`want one of ${Object.keys(KINDS).join(', ')}`)
  const range = (r, min) => Array.isArray(r) && r.length === 2 && r.every(Number.isSafeInteger) && min <= r[0] && r[0] <= r[1]
    ? r : bad(`want [lo, hi], integers with ${min === 0 ? '0 <= ' : ''}lo <= hi`)
  const many = (len, one) => { const [a, b] = range(len, 0); return next => Array.from({ length: int(next, a, b) }, () => one(next)) }
  const domains = () => Array.isArray(d[kind]) && (kind === 'tuple' || d[kind].length) ? d[kind].map(compile) : bad(`want a list of domains`)
  switch (kind) {
    case 'int': { const [lo, hi] = range(d.int, -Infinity); return next => int(next, lo, hi) }
    case 'bytes': return many(d.bytes, next => int(next, 0, 255))
    case 'string': {
      const cs = d.chars === undefined ? ASCII : typeof d.chars === 'string' && d.chars ? [...d.chars] : bad('chars: want a non-empty string')
      const g = many(d.string, next => cs[int(next, 0, cs.length - 1)])
      return next => g(next).join('')
    }
    case 'list': return many(d.len, compile(d.list))
    case 'tuple': { const gs = domains(); return next => gs.map(g => g(next)) }
    case 'record': {
      // An integer-like name would lose its place: JSON objects put those keys first.
      const r = d.record, ok = r && typeof r === 'object' && !Array.isArray(r) && !Object.keys(r).some(k => /^\d+$/.test(k))
      const gs = ok ? Object.entries(r).map(([k, e]) => [k, compile(e)]) : bad('want an object of field names, none an integer, to domains')
      return next => Object.fromEntries(gs.map(([k, g]) => [k, g(next)]))
    }
    case 'oneof': { const gs = domains(); return next => gs[int(next, 0, gs.length - 1)](next) }
    case 'const': return () => d.const
  }
}

// Reduction by a validated domain. A string is reduced as the list of its characters' places in the alphabet.
export const seq = d => {
  if ('bytes' in d) return { len: d.bytes, el: { int: [0, 255] }, is: Array.isArray, from: v => v, to: a => a }
  if ('list' in d) return { len: d.len, el: d.list, is: Array.isArray, from: v => v, to: a => a }
  if (!('string' in d)) return null
  const cs = d.chars === undefined ? ASCII : [...d.chars]
  return { len: d.string, el: { int: [0, cs.length - 1] }, is: v => typeof v === 'string',
    from: v => [...v].map(c => cs.indexOf(c)), to: a => a.map(i => cs[i]).join('') }
}
const has = (d, v) => {
  const s = seq(d)
  if (s) { const a = s.is(v) && s.from(v); return !!a && a.length >= s.len[0] && a.length <= s.len[1] && a.every(x => has(s.el, x)) }
  if ('int' in d) return Number.isSafeInteger(v) && d.int[0] <= v && v <= d.int[1]
  if ('tuple' in d) return Array.isArray(v) && v.length === d.tuple.length && d.tuple.every((e, i) => has(e, v[i]))
  if ('record' in d) { const ks = Object.keys(d.record); return !!v && typeof v === 'object' && !Array.isArray(v)
    && Object.keys(v).length === ks.length && ks.every(k => Object.hasOwn(v, k) && has(d.record[k], v[k])) }
  if ('oneof' in d) return d.oneof.some(e => has(e, v))
  return JSON.stringify(v) === JSON.stringify(d.const)
}
// The least example of a domain, the one reduction moves toward: its size is the domain's minimums.
export const least = d => {
  const s = seq(d)
  if (s) return s.to(Array(s.len[0]).fill(least(s.el)))
  if ('int' in d) return d.int[0]
  if ('tuple' in d) return d.tuple.map(least)
  if ('record' in d) return Object.fromEntries(Object.entries(d.record).map(([k, e]) => [k, least(e)]))
  if ('oneof' in d) return least(d.oneof[0])
  return d.const
}
// The examples one step smaller than v, biggest steps first.
const smaller = (d, v) => {
  const s = seq(d)
  if (s) {
    const a = s.from(v), min = s.len[0], out = []
    if (a.length > min) out.push(a.slice(0, min))
    for (let k = a.length >> 1; k >= 1; k >>= 1)
      for (let i = 0; i + k <= a.length && a.length - k >= min; i += k) out.push([...a.slice(0, i), ...a.slice(i + k)])
    a.forEach((x, i) => { for (const y of smaller(s.el, x)) out.push(a.with(i, y)) })
    return out.map(s.to)
  }
  if ('int' in d) { const out = []; for (let k = v - d.int[0]; k >= 1; k = Math.floor(k / 2)) out.push(v - k); return out }
  if ('tuple' in d) return d.tuple.flatMap((e, i) => smaller(e, v[i]).map(y => v.with(i, y)))
  if ('record' in d) return Object.entries(d.record).flatMap(([k, e]) => smaller(e, v[k]).map(y => ({ ...v, [k]: y })))
  if ('oneof' in d) { const j = d.oneof.findIndex(e => has(e, v)); return [...d.oneof.slice(0, j).map(least), ...smaller(d.oneof[j], v)] }
  return []
}

const exec = (command, dir, seed, count) => spawnSync(command[0], command.slice(1), { encoding: 'utf8', maxBuffer: 1 << 30,
  env: { ...process.env, PROPERTY_DIR: dir, PROPERTY_SEED: String(seed), PROPERTY_EXAMPLES: String(count) } })

// What a run said of contract `id` with `n` examples: {failed: [example id], unknown: [string]} from its <id>.failed,
// else {failed: null, last}, the last example printed before a non-zero exit.
const outcome = (id, n, dir, r) => {
  let text
  try { text = readFileSync(join(dir, `${id}.failed`), 'utf8') } catch {
    const last = r.status === 0 ? undefined : [...(r.stdout + r.stderr).matchAll(new RegExp(`property: ${id.replace(/[.]/g, '\\.')} (\\d+)`, 'g'))].at(-1)?.[1]
    return { failed: null, last: last !== undefined && Number(last) < n ? Number(last) : undefined }
  }
  const ids = text.split(/\s+/).filter(Boolean), ok = s => /^\d+$/.test(s) && Number(s) < n
  return { failed: ids.filter(ok).map(Number), unknown: ids.filter(s => !ok(s)) }
}

const RERUNS = 100 // ponytail: a fixed cap on reruns; make it a flag if real reductions stop short of it
const reduce = (command, seed, p, example) => {
  const dir = mkdtempSync(join(tmpdir(), 'contracts-')), file = join(dir, `${p.id}.json`)
  let reruns = 0, capped = false
  try {
    for (;;) {
      const next = smaller(p.domain, example)
      if (!next.length || (capped = reruns === RERUNS)) break
      rmSync(join(dir, `${p.id}.failed`), { force: true })
      writeFileSync(file, JSON.stringify(next))
      const r = exec(command, dir, seed, next.length)
      reruns++
      if (r.error) break
      const o = outcome(p.id, next.length, dir, r), i = o.failed ? o.failed[0] : o.last
      if (i === undefined) break
      example = next[i]
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
  return { example, reruns, capped }
}

const run = (command, seed, count) => {
  const { contracts, problems } = scan()
  const props = []
  if (problems.length) { process.stderr.write(problems.join('\n') + '\n'); process.exit(2) }
  for (const c of contracts.filter(c => c.domain !== null)) {
    const g = compile(c.domain), next = random(`${seed}:${c.id}`)
    props.push({ ...c, examples: Array.from({ length: count }, () => g(next)) })
  }
  const dir = mkdtempSync(join(tmpdir(), 'contracts-'))
  try {
    for (const p of props) writeFileSync(join(dir, `${p.id}.json`), JSON.stringify(p.examples))
    const r = exec(command, dir, seed, count)
    process.stdout.write(r.stdout ?? '')
    process.stderr.write(r.stderr ?? '')
    if (r.error) die(`${command[0]}: ${r.error.message}`)
    const exit = r.status ?? r.signal
    const reds = [], errors = []
    for (const p of props) {
      const { id, examples } = p, o = outcome(id, examples.length, dir, r)
      const show = (i, what = '') => `example ${i}${what}, seed ${seed}: ${JSON.stringify(examples[i])}`
      let first
      if (!o.failed) {
        if (exit === 0) { errors.push(`${id}: no ${id}.failed after a clean exit`); continue }
        reds.push(`${id}: red on ${o.last === undefined ? 'no printed example' : show(o.last)}; the command exited ${exit} with no ${id}.failed`)
        first = o.last
      } else {
        for (const s of o.unknown) errors.push(`${id}: ${id}.failed names example ${s}, not in ${id}.json`)
        for (const i of o.failed.slice(0, SHOWN)) reds.push(`${id}: ${show(i, ' failed')}`)
        if (o.failed.length > SHOWN) reds.push(`${id}: ${o.failed.length - SHOWN} more failed examples`)
        if (!o.unknown.length) first = o.failed[0]
      }
      if (first === undefined) continue
      const { example, reruns, capped } = reduce(command, seed, p, examples[first])
      reds.push(`${id}: example ${first} reduced in ${reruns} reruns${capped ? ', stopped at the cap' : ''}: ${JSON.stringify(example)}`)
    }
    if (exit !== 0 && !reds.length) reds.push(`the command exited ${exit}`)
    process.stderr.write([...errors, ...reds].map(l => `contracts: ${l}\n`).join(''))
    process.exitCode = errors.length ? 2 : reds.length ? 1 : 0
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

const main = () => {
  const argv = process.argv.slice(2), dash = argv.indexOf('--')
  let o
  try {
    o = parseArgs({ args: dash < 0 ? argv : argv.slice(0, dash), allowPositionals: true,
      options: { check: { type: 'boolean' }, seed: { type: 'string' }, examples: { type: 'string' } } })
  } catch (e) { die(e.message) }
  const [cmd, ...rest] = o.positionals
  const number = (k, d) => {
    const n = Number(o.values[k] ?? d)
    return Number.isSafeInteger(n) && n >= 0 ? n : die(`--${k} ${o.values[k]}: not a whole number`)
  }
  try {
    if (cmd === 'doc' && rest.length === 1 && dash < 0) doc(rest[0], o.values.check)
    else if (cmd === 'run' && !rest.length && dash >= 0 && argv.length > dash + 1) run(argv.slice(dash + 1), number('seed', 1), number('examples', 100))
    else die('usage: contracts.mjs doc <path> [--check] | run [--seed <n>] [--examples <n>] -- <test command>')
  } catch (e) { die(e.message) }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main()
