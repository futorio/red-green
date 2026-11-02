// The by-hand mutation command: runs mutants [{target, patch}] at the end of a commit range, one at a time, in one
// detached worktree reset between them, so a project's incremental build holds. It writes no patch: they come from an
// agent session or the project's own generator. It creates no ticket.
//
// The `mutation` section of the profile file (default <repo>/.claude/red-green/profile.json, absent: none) drops a
// mutant before the budget is counted when each line it changes is in a file the range did not change, in a file
// outside `include` (globs; absent: every file) or inside `exclude` (globs), or matches a `skip_lines` regex.
// First a control run, the worktree with no patch: a failed or timed-out build or test there is exit 2 and tries no
// mutant. An empty list makes no control run.
//
// stdout is the list with `at` (file:line at the range's end of the first changed line) and a status each: dropped,
// over_budget (past --budget), not_run (the patch does not apply), invalid (build non-zero or past the timeout), killed
// (test non-zero or past the timeout), survived. stderr counts them. Build and test each get the full timeout.
// --seed sets PROPERTY_SEED for build and test (`random`: one drawn and named on stderr). Exit 0 a completed run, 2 did
// not run or the worktree could not be removed (stderr says why). docs/red-green/args-and-profile.md.
//
//     node mutate.mjs --mutants <file.json> --repo <repo> --range <from>..<to> --dir <run dir> --test <cmd> [--build <cmd>]
//       [--timeout <s>] [--budget <n>] [--profile <file>] [--seed <n>|random]
import { readFileSync, existsSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { join, matchesGlob } from 'node:path'
import { parseArgs } from 'node:util'

const { values: o } = parseArgs({ options: Object.fromEntries(['mutants', 'repo', 'range', 'dir', 'build', 'test', 'timeout', 'budget', 'profile', 'seed'].map(k => [k, { type: 'string' }])) })
const die = why => { process.stderr.write(`mutate: ${why}\n`); process.exit(2) }
for (const k of ['mutants', 'repo', 'range', 'dir', 'test']) if (!o[k]) die(`--${k} is required`)
const git = (...a) => execFileSync('git', ['-C', o.repo, ...a], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
const [from, to, ...more] = o.range.split('..')
if (!from || !to || more.length) die(`--range ${o.range}: not <from>..<to>`)
let mutants, head, changed, section
try {
  head = git('rev-parse', '--verify', `${to}^{commit}`).trim()
  git('rev-parse', '--verify', `${from}^{commit}`)
} catch (e) { die(`--range ${o.range} in ${o.repo}: ${e.message}`) }
try {
  mutants = JSON.parse(readFileSync(o.mutants, 'utf8'))
  changed = new Set(git('diff', '--name-only', from, head).split('\n').filter(Boolean))
  const profile = o.profile || join(o.repo, '.claude', 'red-green', 'profile.json')
  section = (o.profile || existsSync(profile)) && JSON.parse(readFileSync(profile, 'utf8')).mutation || {}
} catch (e) { die(e.message) }
const timeout = (Number(o.timeout) || 300) * 1000
const budget = o.budget === undefined ? Infinity : Number(o.budget)
const seed = o.seed === 'random' ? String(Math.floor(Math.random() * 2 ** 31)) : o.seed
const env = seed === undefined ? process.env : { ...process.env, PROPERTY_SEED: seed }
const skip = (section.skip_lines || []).map(p => new RegExp(p))
const kept = file => changed.has(file) && (!section.include || section.include.some(g => matchesGlob(file, g)))
  && !(section.exclude || []).some(g => matchesGlob(file, g))

// The patch's changed lines as [file, text], and the file:line at head of the first one.
const parse = patch => {
  const out = []
  let file, line, at
  for (const l of patch.split('\n')) {
    const name = /^(?:---|\+\+\+) (?:a|b)\/(.*)$/.exec(l)
    const hunk = /^@@ -(\d+)/.exec(l)
    if (name) file = name[1]
    else if (/^(---|\+\+\+) /.test(l)) continue
    else if (hunk) line = Number(hunk[1])
    else if (l[0] === ' ') line++
    else if (file && (l[0] === '-' || l[0] === '+')) {
      out.push([file, l.slice(1)])
      at = at || `${file}:${line}`
      if (l[0] === '-') line++
    }
  }
  return { lines: out, at }
}

// Exit code of a shell command, or null past the timeout; its process group is killed so a looping child dies too.
const sh = (cmd, cwd, ms) => new Promise(resolve => {
  const p = spawn(cmd, { cwd, env, shell: true, stdio: ['ignore', 'ignore', 'ignore'], detached: true })
  const t = ms && setTimeout(() => { try { process.kill(-p.pid, 'SIGKILL') } catch {} resolve(null) }, ms)
  p.on('exit', code => { clearTimeout(t); resolve(code) })
})

const wt = join(o.dir, 'worktree')
const wgit = (...a) => execFileSync('git', ['-C', wt, ...a], { stdio: 'pipe' })
// A status for the worktree with `patch` applied (none: as it is), reset to head after.
const attempt = async patch => {
  try {
    const applied = patch === undefined || await new Promise(resolve => {
      const p = spawn('git', ['apply', '-'], { cwd: wt, stdio: ['pipe', 'ignore', 'ignore'] })
      p.on('error', e => die(`git apply in ${wt}: ${e.message}`))
      p.stdin.on('error', e => die(`git apply in ${wt}: ${e.message}`))
      p.on('exit', code => resolve(code === 0))
      p.stdin.end(patch)
    })
    return !applied ? 'not_run'
      : o.build && await sh(o.build, wt, timeout) !== 0 ? 'invalid'
      : await sh(o.test, wt, timeout) !== 0 ? 'killed' : 'survived'
  } finally {
    // Untracked files go, ignored ones (the build's output) stay.
    try { wgit('reset', '-q', '--hard', head); wgit('clean', '-fdq') } catch (e) { die(`reset ${wt}: ${e.message}`) }
  }
}

let ran = 0
const out = mutants.map(m => {
  const { lines, at } = parse(m.patch || '')
  const status = lines.every(([f, text]) => !kept(f) || skip.some(r => r.test(text))) ? 'dropped' : ran++ < budget ? undefined : 'over_budget'
  return Object.assign({}, m, { at, status })
})
if (ran) {
  try { git('worktree', 'add', '-q', '--detach', '--force', wt, head) } catch (e) { die(`worktree ${wt}: ${e.message}`) }
  const remove = () => { try { git('worktree', 'remove', '--force', wt) } catch (e) { die(`remove ${wt}: ${e.message}`) } }
  const control = await attempt()
  if (control !== 'survived') { remove(); die(`control run at ${head}: ${control === 'invalid' ? 'build' : 'test'} failed or timed out`) }
  for (const m of out) if (!m.status) m.status = await attempt(m.patch)
  report()
  remove()
} else report()

function report () {
  process.stdout.write(JSON.stringify(out, null, 1) + '\n')
  const n = s => `${out.filter(m => m.status === s).length} ${s}`
  process.stderr.write(`mutate: ${o.range}${seed === undefined ? '' : ` seed ${seed}`}: ${['killed', 'survived', 'invalid', 'not_run', 'dropped', 'over_budget'].map(n).join(', ')}\n`)
}
