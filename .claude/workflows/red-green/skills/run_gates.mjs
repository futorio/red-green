// Runs the gates of a tier in the working directory and prints one JSON row per gate: name, status (green, red,
// known_red, or not_run when a signal or the timeout ended it), line, log, seconds, cached. Exit 0 the report is complete, whatever the
// gates did; 2 it could not run, or the tier selects no gate (stderr says why); 3 gates are still running, call again.
//
// A call only waits: the gates run in a detached process of this script holding a lock per worktree, so they outlive the
// call, and another call joins them instead of starting its own. Its report stays in the run directory for a later call.
// The run directory must be outside the tree or ignored, or its logs change the cache key on every run.
//
//     node run_gates.mjs --gates <json> --dir <run dir> [--tier fast|round|acceptance] [--baseline <json>] [--no-cache] [--wait <s>] [--timeout <s>]
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, rmSync, copyFileSync, existsSync, linkSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

const die = why => { process.stderr.write(`run_gates: ${why}\n`); process.exit(2) }
let o
try {
  o = parseArgs({ options: { gates: { type: 'string' }, tier: { type: 'string' }, dir: { type: 'string' }, baseline: { type: 'string' },
    'no-cache': { type: 'boolean' }, wait: { type: 'string' }, timeout: { type: 'string' }, supervise: { type: 'string' } } }).values
} catch (e) { die(e.message) }
for (const k of ['gates', 'dir']) if (!o[k]) die(`--${k} is required`)
const json = (k, s) => { try { return JSON.parse(s) } catch (e) { die(`--${k}: ${e.message}`) } }

const TIERS = ['fast', 'round', 'acceptance']
const tier = o.tier ?? 'round'
if (!TIERS.includes(tier)) die(`--tier ${tier}: not one of ${TIERS.join(', ')}`)
const all = json('gates', o.gates)
if (!Array.isArray(all)) die('--gates: not a list')
for (const g of all) {
  if (!g?.name || !g.command) die(`--gates: a gate needs a name and a command: ${JSON.stringify(g)}`)
  if (!TIERS.includes(g.tier ?? 'round')) die(`--gates: ${g.name}: tier ${g.tier} is not one of ${TIERS.join(', ')}`)
  if (all.filter(x => x.name === g.name).length > 1) die(`--gates: ${g.name} is named twice`)
}
const gates = all.filter(g => TIERS.indexOf(g.tier ?? 'round') <= TIERS.indexOf(tier))
if (!gates.length) die(`--tier ${tier}: no gates in it`)
const baseline = o.baseline ? json('baseline', o.baseline) : {}
if (baseline === null || typeof baseline !== 'object') die('--baseline: not an object')
const waitSeconds = o.wait === undefined ? 540 : Number(o.wait)
if (!Number.isFinite(waitSeconds)) die(`--wait ${o.wait}: not a number`)
const timeoutSeconds = o.timeout === undefined ? 7200 : Number(o.timeout)
if (!(timeoutSeconds > 0)) die(`--timeout ${o.timeout}: not a positive number`)

const git = (args, env) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }).trim()
let GIT_DIR
try {
  GIT_DIR = git(['rev-parse', '--absolute-git-dir'])
  mkdirSync(o.dir, { recursive: true })
} catch (e) { die(e.message) }
const LOCK = join(GIT_DIR, 'red-green-gates.lock')
const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null } }
const writeJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(`${file}.${process.pid}`, JSON.stringify(value))
  renameSync(`${file}.${process.pid}`, file)
}

// HEAD and the tree of tracked and untracked non-ignored files, from a temporary index.
const treeState = () => {
  const index = join(GIT_DIR, `red-green-gates.index.${process.pid}`)
  try {
    const real = git(['rev-parse', '--git-path', 'index'])
    if (existsSync(real)) copyFileSync(real, index)
    git(['add', '-A', ':/'], { GIT_INDEX_FILE: index })
    return `${git(['rev-parse', 'HEAD'])} ${git(['write-tree'], { GIT_INDEX_FILE: index })}`
  } finally { rmSync(index, { force: true }) }
}
const sha = s => createHash('sha256').update(s).digest('hex')

// The request a call and a run must share for the call to report that run; the baseline is applied per report.
const request = JSON.stringify({ gates, noCache: !!o['no-cache'] })
const REPORT = join(o.dir, 'gate-runs', `${sha(request)}.json`)

const killGroup = pid => { try { process.kill(-pid, 'SIGKILL') } catch {} }

const supervise = async id => {
  const held = `${LOCK}.${process.pid}`
  try {
    writeFileSync(held, JSON.stringify({ pid: process.pid, id, request }))
    linkSync(held, LOCK)
  } catch (e) {
    if (e.code !== 'EEXIST') writeJson(REPORT, { id, rows: [], error: e.message })
    return
  } finally { rmSync(held, { force: true }) }
  const report = { id, rows: [] }
  try {
    report.start = treeState()
    const logs = join(o.dir, 'gate-logs', id)
    mkdirSync(logs, { recursive: true })
    const runGate = (g, i) => new Promise((resolve, reject) => {
      const log = join(logs, `${i}-${encodeURIComponent(g.name)}.log`)
      const fd = openSync(log, 'w')
      const start = Date.now()
      // A group of its own, so its timeout kills what it started and not this process.
      const p = spawn(g.command, { shell: true, stdio: ['ignore', fd, fd], detached: true })
      writeJson(LOCK, { pid: process.pid, id, request, gate: p.pid, until: start + timeoutSeconds * 1000 })
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; killGroup(p.pid) }, timeoutSeconds * 1000)
      p.on('error', reject)
      p.on('exit', code => {
        clearTimeout(timer)
        closeSync(fd)
        const line = timedOut ? `timed out after ${timeoutSeconds}s` : readFileSync(log, 'utf8').split(/\r?\n/).filter(l => l.trim()).at(-1)?.trimEnd() ?? '(no output)'
        resolve({ name: g.name, status: code === null ? 'not_run' : code === 0 ? 'green' : 'red', line, log, seconds: (Date.now() - start) / 1000, cached: false })
      })
    })
    for (const [i, g] of gates.entries()) {
      // Keyed on the tree this gate starts on: a file it generates makes the next call miss once.
      const file = !o['no-cache'] && join(o.dir, 'gate-cache', `${sha(JSON.stringify([g.command, treeState()]))}.json`)
      const hit = file && readJson(file)
      const row = hit ? { ...hit, name: g.name, cached: true } : await runGate(g, i)
      if (file && !hit && row.status !== 'not_run') writeJson(file, row)
      report.rows.push(row)
    }
    report.end = treeState()
  } catch (e) { report.error = e.message }
  writeJson(REPORT, report)
  rmSync(LOCK, { force: true })
}

const alive = pid => { try { process.kill(-pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
// A gate outliving a dead holder holds the lock until its timeout, when the waiter kills it in the holder's place.
const holds = holder => {
  if (alive(holder.pid)) return true
  if (!holder.gate) return false
  if (Date.now() > holder.until) killGroup(holder.gate)
  return alive(holder.gate)
}

const collect = report => {
  writeJson(REPORT, { ...report, collected: true })
  if (report.error) die(report.error)
  for (const row of report.rows) {
    if (row.status === 'red' && ['red', 'known_red'].includes(baseline[row.name]?.status)) row.status = 'known_red'
    process.stdout.write(JSON.stringify(row) + '\n')
  }
  process.exit(0)
}

const wait = async () => {
  const deadline = Date.now() + waitSeconds * 1000
  let child = null, joined = null
  for (;;) {
    const holder = readJson(LOCK)
    if (holder && holds(holder)) joined = holder.request === request ? holder.id : null
    else if (!child) {
      // ponytail: two calls taking over the same dead lock at once can both start; a rename-and-check closes it if that shows up.
      if (holder) rmSync(LOCK, { force: true })
      const report = readJson(REPORT)
      if (report && report.id === joined) collect(report)
      if (report && !report.collected) {
        const now = treeState()
        if (now === report.start || now === report.end) collect(report)
      }
      joined = `${Date.now()}-${process.pid}`
      child = spawn(process.execPath, [...process.execArgv, process.argv[1], ...process.argv.slice(2), '--supervise', joined], { stdio: 'ignore', detached: true })
      child.on('exit', () => { child = null })
      child.unref()
    }
    if (Date.now() >= deadline) {
      process.stderr.write('run_gates: gates are still running; call again\n')
      process.exit(3)
    }
    await new Promise(r => setTimeout(r, 100))
  }
}

if (o.supervise) await supervise(o.supervise)
else await wait().catch(e => die(e.message))
