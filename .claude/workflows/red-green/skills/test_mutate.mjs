// Runs mutate.mjs on a throwaway git repository with a tiny build and test command.
//
//     node --test .claude/workflows/red-green/skills/test_mutate.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { spawnSync, execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RUNNER = new URL('./mutate.mjs', import.meta.url).pathname
const SRC = 'const inc = x => x + 1\nconst dec = x => x - 1\nmodule.exports = { inc, dec }\n'
const tmp = mkdtempSync(join(tmpdir(), 'tdd-mutate-'))
const repo = join(tmp, 'repo')
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' })
execFileSync('git', ['init', '-q', repo])
writeFileSync(join(repo, 'a.js'), SRC)
git('add', 'a.js')
git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'a')
const head = git('rev-parse', 'HEAD').trim()
// A patch is the diff of a.js with `from` replaced by `to`, made by git and the tree restored.
const patch = (from, to) => {
  writeFileSync(join(repo, 'a.js'), SRC.replace(from, to))
  const d = git('diff')
  git('checkout', '--', 'a.js')
  return d
}
const MUTANTS = [
  { target: 'C1', patch: patch('x + 1', 'x + 2') },
  { target: 'edge: dec', patch: patch('x - 1', 'x - 2') },
  { target: 'C2', patch: patch('x + 1', 'x +') },
  { target: 'edge: loop', patch: patch('x => x + 1', 'x => { for (;;); }') },
  { target: 'C3', patch: 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-nothing here\n+x\n' },
]
// cmds overrides the build and test commands.
const run = (r, mutants, cmds) => {
  const c = Object.assign({ build: 'node --check a.js', test: 'node -e "process.exit(require(\'./a.js\').inc(1) === 2 ? 0 : 1)"' }, cmds)
  const file = join(tmp, `in-${Math.random()}.json`)
  writeFileSync(file, JSON.stringify(mutants))
  return spawnSync('node', [RUNNER, '--mutants', file, '--repo', r, '--head', head, '--dir', join(tmp, 'run'),
    '--build', c.build, '--test', c.test, '--timeout', '2'], { encoding: 'utf8' })
}

test('M01: each mutant comes back with its status; the repository HEAD and tree are unchanged', () => {
  const before = [git('rev-parse', 'HEAD'), git('status', '--porcelain'), readFileSync(join(repo, 'a.js'), 'utf8')]
  const res = run(repo, MUTANTS)
  assert.equal(res.status, 0, res.stderr)
  assert.deepEqual(JSON.parse(res.stdout), MUTANTS.map((m, i) => Object.assign({}, m, { status: ['killed', 'survived', 'invalid', 'killed', 'not_run'][i] })))
  assert.deepEqual([git('rev-parse', 'HEAD'), git('status', '--porcelain'), readFileSync(join(repo, 'a.js'), 'utf8')], before)
  assert.equal(git('worktree', 'list').trim().split('\n').length, 1)
})

test('M02: a missing repository is exit 2 with the reason on stderr', () => {
  const res = run(join(tmp, 'nope'), MUTANTS.slice(0, 1))
  assert.equal(res.status, 2)
  assert.match(res.stderr, /nope/)
  assert.equal(res.stdout, '')
})

test('M03: a build past the timeout is invalid; the test then never runs', () => {
  const res = run(repo, MUTANTS.slice(0, 1), { build: 'grep -q "x + 2" a.js && node -e "for (;;);"; exit 0', test: 'exit 0' })
  assert.equal(res.status, 0, res.stderr)
  assert.equal(JSON.parse(res.stdout)[0].status, 'invalid')
})

// A log file, and a command that appends `what` and where it ran to the log, then ends with `rest`.
const newLog = () => {
  const log = join(tmp, `log-${Math.random()}`)
  writeFileSync(log, '')
  return log
}
const step = (log, what, rest = 'exit 0') => `echo "${what} $PWD $(git rev-parse HEAD) $(git status --porcelain | wc -l)" >> ${log}; ${rest}`
const lines = log => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => l.split(' '))
const LOOP = 'node -e "for (;;);"'
const assertRefused = (res, why) => {
  assert.equal(res.status, 2)
  assert.match(res.stderr, why)
  assert.equal(res.stdout, '')
  assert.equal(git('worktree', 'list').trim().split('\n').length, 1)
}

test('M05: the control is a mutant with no patch: a detached clean worktree at head, build then test', () => {
  const log = newLog()
  const res = run(repo, MUTANTS.slice(0, 1), { build: step(log, 'build'), test: step(log, 'test') })
  assert.equal(res.status, 0, res.stderr)
  const [[b, bdir, bsha, bdirty], [t, tdir, tsha, tdirty]] = lines(log)
  assert.deepEqual([b, t], ['build', 'test'])
  assert.equal(tdir, bdir)
  assert.ok(bdir.startsWith(join(tmp, 'run', 'mutants')), bdir)
  assert.deepEqual([bsha, tsha, bdirty, tdirty], [head, head, '0', '0'])
  assert.equal(git('worktree', 'list').trim().split('\n').length, 1)
})

test('M09: an empty mutant list makes no control run, on a red tree too', () => {
  const log = newLog()
  const res = run(repo, [], { build: step(log, 'build'), test: step(log, 'test', 'exit 1') })
  assert.equal(res.status, 0, res.stderr)
  assert.deepEqual(JSON.parse(res.stdout), [])
  assert.deepEqual(lines(log), [])
})

test('M06: a failing test in the control is exit 2 and tries no mutant', () => {
  const log = newLog()
  const res = run(repo, MUTANTS.slice(0, 2), { build: 'exit 0', test: step(log, 'test', 'exit 1') })
  assertRefused(res, /^mutate: control run.*test/)
  assert.equal(lines(log).length, 1)
})

test('M07: a failing build in the control is exit 2 and tries no mutant', () => {
  const log = newLog()
  const res = run(repo, MUTANTS.slice(0, 2), { build: step(log, 'build', 'exit 1'), test: step(log, 'test') })
  assertRefused(res, /^mutate: control run.*build/)
  assert.deepEqual(lines(log).map(l => l[0]), ['build'])
})

test('M08: a control past the timeout is exit 2', () => {
  assertRefused(run(repo, MUTANTS.slice(0, 1), { test: LOOP }), /^mutate: control run.*test/)
  assertRefused(run(repo, MUTANTS.slice(0, 1), { build: LOOP }), /^mutate: control run.*build/)
})

// Last: it leaves a locked worktree behind.
test('M04: a worktree that cannot be removed is exit 2 with the reason on stderr', () => {
  const res = run(repo, MUTANTS.slice(0, 1), { test: 'grep -q "x + 2" a.js && git worktree lock "$PWD"; exit 0' })
  assert.equal(res.status, 2)
  assert.match(res.stderr, /^mutate: .*M-1/)
})
