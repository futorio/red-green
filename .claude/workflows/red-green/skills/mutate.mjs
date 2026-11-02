// First a control run, a mutant with no patch: a failed or timed-out build or test there is exit 2 and tries no mutant.
// An empty list makes no control run.
// Runs each mutant [{target, patch}] in a detached worktree of its own at HEAD, one at a time, and prints the list
// with a status each: not_run (the patch does not apply), invalid (build non-zero or past the timeout), killed (test
// non-zero or past the timeout), survived. Build and test each get the full timeout. Exit 0 a completed run, 2 did
// not run (stderr says why). docs/red-green/stages.md.
//
//     node mutate.mjs --mutants <file.json> --repo <repo> --head <sha> --dir <run dir> --test <cmd> [--build <cmd>] [--timeout <s>]
import { readFileSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values: o } = parseArgs({ options: Object.fromEntries(['mutants', 'repo', 'head', 'dir', 'build', 'test', 'timeout'].map(k => [k, { type: 'string' }])) })
const die = why => { process.stderr.write(`mutate: ${why}\n`); process.exit(2) }
for (const k of ['mutants', 'repo', 'head', 'dir', 'test']) if (!o[k]) die(`--${k} is required`)
const git = (...a) => execFileSync('git', ['-C', o.repo, ...a], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
let mutants
try { mutants = JSON.parse(readFileSync(o.mutants, 'utf8')); git('rev-parse', '--verify', `${o.head}^{commit}`) } catch (e) { die(`${o.repo}: ${e.message}`) }
const timeout = (Number(o.timeout) || 300) * 1000

// Exit code of a shell command, or null past the timeout; its process group is killed so a looping child dies too.
const sh = (cmd, cwd, ms) => new Promise(resolve => {
  const p = spawn(cmd, { cwd, shell: true, stdio: ['ignore', 'ignore', 'ignore'], detached: true })
  const t = ms && setTimeout(() => { try { process.kill(-p.pid, 'SIGKILL') } catch {} resolve(null) }, ms)
  p.on('exit', code => { clearTimeout(t); resolve(code) })
})

// A status for one mutant in a worktree of its own named `name`; with no patch, nothing is applied.
const attempt = async (name, patch) => {
  const wt = join(o.dir, 'mutants', name)
  try { git('worktree', 'add', '-q', '--detach', '--force', wt, o.head) } catch (e) { die(`worktree ${wt}: ${e.message}`) }
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
  } finally { try { git('worktree', 'remove', '--force', wt) } catch (e) { die(`remove ${wt}: ${e.message}`) } }
}

const control = mutants.length ? await attempt('control') : 'survived'
if (control !== 'survived') die(`control run at ${o.head}: ${control === 'invalid' ? 'build' : 'test'} failed or timed out`)

const out = []
for (const [i, m] of mutants.entries()) out.push(Object.assign({}, m, { status: await attempt(`M-${i + 1}`, m.patch) }))
process.stdout.write(JSON.stringify(out, null, 1) + '\n')
