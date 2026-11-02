// Runs mutate.mjs on a throwaway git repository with a tiny build and test command.
//
//     node --test .claude/workflows/red-green/skills/test_mutate.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync, execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RUNNER = new URL('./mutate.mjs', import.meta.url).pathname
const SRC = '// inc adds one\nconst inc = x => x + 1\nconst dec = x => x - 1\nmodule.exports = { inc, dec }\n'
const VENDOR = 'module.exports = x => x * 2\n'
const OTHER = 'module.exports = 1\n'
const tmp = mkdtempSync(join(tmpdir(), 'tdd-mutate-'))
const repo = join(tmp, 'repo')
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' })
const commit = files => {
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(repo, f, '..'), { recursive: true })
    writeFileSync(join(repo, f), text)
    git('add', f)
  }
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'c')
  return git('rev-parse', 'HEAD').trim()
}
execFileSync('git', ['init', '-q', repo])
// other.js predates the range; the range adds a.js, vendor/v.js and an ignored build output.
const base = commit({ 'other.js': OTHER })
const head = commit({ 'a.js': SRC, 'vendor/v.js': VENDOR, '.gitignore': 'out\n' })
const RANGE = `${base}..${head}`
// A patch is the diff of `file` with each [from, to] replaced, made by git and the tree restored.
const patch = (file, ...edits) => {
  const before = readFileSync(join(repo, file), 'utf8')
  writeFileSync(join(repo, file), edits.reduce((s, [from, to]) => s.replace(from, to), before))
  const d = git('diff')
  git('checkout', '--', file)
  return d
}
const MUTANTS = [
  { target: 'C1', patch: patch('a.js', ['x + 1', 'x + 2']) },
  { target: 'edge: dec', patch: patch('a.js', ['x - 1', 'x - 2']) },
  { target: 'C2', patch: patch('a.js', ['x + 1', 'x +']) },
  { target: 'edge: loop', patch: patch('a.js', ['x => x + 1', 'x => { for (;;); }']) },
  { target: 'C3', patch: 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-nothing here\n+x\n' },
]
const VENDORED = { target: 'vendored', patch: patch('vendor/v.js', ['x * 2', 'x * 3']) }
const OLD = { target: 'outside the range', patch: patch('other.js', ['1', '2']) }
const COMMENT = { target: 'comment', patch: patch('a.js', ['adds one', 'adds two']) }
const BOTH = { target: 'comment and code', patch: patch('a.js', ['adds one', 'adds two'], ['x + 1', 'x + 2']) }

// cmds overrides the build and test commands; mutation is the profile file's section (none: no --profile); more is extra argv.
const run = (r, mutants, cmds, { mutation, more = [] } = {}) => {
  const c = Object.assign({ build: 'node --check a.js', test: 'node -e "process.exit(require(\'./a.js\').inc(1) === 2 ? 0 : 1)"' }, cmds)
  const file = join(tmp, `in-${Math.random()}.json`)
  writeFileSync(file, JSON.stringify(mutants))
  const profile = []
  if (mutation) {
    profile.push('--profile', join(tmp, `profile-${Math.random()}.json`))
    writeFileSync(profile[1], JSON.stringify({ blocks: {}, mutation }))
  }
  return spawnSync('node', [RUNNER, '--mutants', file, '--repo', r, '--range', RANGE, '--dir', join(tmp, 'run'),
    '--build', c.build, '--test', c.test, '--timeout', '2', ...profile, ...more], { encoding: 'utf8' })
}
const statuses = res => JSON.parse(res.stdout).map(m => [m.target, m.status])

test('M01: each mutant comes back with its status and file:line, stderr counts them; the repository is unchanged', () => {
  const before = [git('rev-parse', 'HEAD'), git('status', '--porcelain'), readFileSync(join(repo, 'a.js'), 'utf8')]
  const res = run(repo, MUTANTS)
  assert.equal(res.status, 0, res.stderr)
  const at = ['a.js:2', 'a.js:3', 'a.js:2', 'a.js:2', 'a.js:1']
  assert.deepEqual(JSON.parse(res.stdout), MUTANTS.map((m, i) => Object.assign({}, m, { at: at[i], status: ['killed', 'survived', 'invalid', 'killed', 'not_run'][i] })))
  assert.match(res.stderr, new RegExp(`^mutate: ${RANGE}: 2 killed, 1 survived, 1 invalid, 1 not_run, 0 dropped, 0 over_budget\\n$`))
  assert.deepEqual([git('rev-parse', 'HEAD'), git('status', '--porcelain'), readFileSync(join(repo, 'a.js'), 'utf8')], before)
  assert.equal(git('worktree', 'list').trim().split('\n').length, 1)
})

test('M02: a missing repository or a range that is not two commits is exit 2 with the reason on stderr', () => {
  const res = run(join(tmp, 'nope'), MUTANTS.slice(0, 1))
  assert.equal(res.status, 2)
  assert.match(res.stderr, /nope/)
  assert.equal(res.stdout, '')
  for (const range of [head, `${base}..nope`]) {
    const bad = spawnSync('node', [RUNNER, '--mutants', '/dev/null', '--repo', repo, '--range', range, '--dir', tmp, '--test', 'true'], { encoding: 'utf8' })
    assert.equal(bad.status, 2, range)
    assert.match(bad.stderr, /^mutate: .*range/, range)
  }
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

test('M05: the control is a mutant with no patch: a detached clean worktree at the range\'s end, build then test', () => {
  const log = newLog()
  const res = run(repo, MUTANTS.slice(0, 1), { build: step(log, 'build'), test: step(log, 'test') })
  assert.equal(res.status, 0, res.stderr)
  const [[b, bdir, bsha, bdirty], [t, tdir, tsha, tdirty]] = lines(log)
  assert.deepEqual([b, t], ['build', 'test'])
  assert.equal(tdir, bdir)
  assert.ok(bdir.startsWith(join(tmp, 'run')), bdir)
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

test('M10: one worktree serves the control and every mutant, reset in between; an ignored build output stays', () => {
  const log = newLog()
  // The build reports whether the previous build's output is still there, then writes it.
  const build = `echo "build $PWD $(test -f out && echo kept || echo fresh) $(git status --porcelain | wc -l)" >> ${log}; touch out`
  const added = { target: 'adds a file', patch: MUTANTS[1].patch + 'diff --git a/n.js b/n.js\nnew file mode 100644\n--- /dev/null\n+++ b/n.js\n@@ -0,0 +1 @@\n+1\n' }
  const res = run(repo, [added, MUTANTS[0]], { build })
  assert.equal(res.status, 0, res.stderr)
  assert.deepEqual(statuses(res), [['adds a file', 'survived'], ['C1', 'killed']])
  const builds = lines(log)
  assert.equal(new Set(builds.map(l => l[1])).size, 1)
  assert.deepEqual(builds.map(l => l.slice(2)), [['fresh', '0'], ['kept', '2'], ['kept', '1']])
  assert.equal(git('worktree', 'list').trim().split('\n').length, 1)
})

test('M11: a mutant touching only excluded paths, or files the range did not change, is dropped and never runs', () => {
  const mixed = { target: 'a.js and vendored', patch: MUTANTS[0].patch + VENDORED.patch }
  const log = newLog()
  const res = run(repo, [VENDORED, OLD, MUTANTS[1], mixed], { test: step(log, 'test') }, { mutation: { exclude: ['vendor/**'] } })
  assert.equal(res.status, 0, res.stderr)
  assert.deepEqual(statuses(res), [['vendored', 'dropped'], ['outside the range', 'dropped'], ['edge: dec', 'survived'], ['a.js and vendored', 'survived']])
  assert.equal(lines(log).length, 3)
  // include: only the paths it names; the profile file is the repository's own when --profile is not given.
  mkdirSync(join(repo, '.git', 'info'), { recursive: true })
  writeFileSync(join(repo, '.git', 'info', 'exclude'), '.claude/\n')
  mkdirSync(join(repo, '.claude', 'red-green'), { recursive: true })
  writeFileSync(join(repo, '.claude', 'red-green', 'profile.json'), JSON.stringify({ mutation: { include: ['vendor/**'] } }))
  try {
    const own = run(repo, [VENDORED, MUTANTS[1]], { test: 'exit 0' })
    assert.equal(own.status, 0, own.stderr)
    assert.deepEqual(statuses(own), [['vendored', 'survived'], ['edge: dec', 'dropped']])
  } finally { rmSync(join(repo, '.claude'), { recursive: true }) }
})

test('M12: a mutant whose every changed line matches a skip_lines pattern is dropped; one changing code too is kept', () => {
  const res = run(repo, [COMMENT, BOTH], {}, { mutation: { skip_lines: ['^\\s*//'] } })
  assert.equal(res.status, 0, res.stderr)
  assert.deepEqual(statuses(res), [['comment', 'dropped'], ['comment and code', 'killed']])
  assert.equal(statuses(run(repo, [COMMENT])).at(0)[1], 'survived')
})

test('M13: the budget counts the mutants left after dropping; the rest are over_budget and never run', () => {
  const log = newLog()
  const res = run(repo, [VENDORED, COMMENT, MUTANTS[1], MUTANTS[0], MUTANTS[2]], { test: step(log, 'test') },
    { mutation: { exclude: ['vendor/**'], skip_lines: ['^\\s*//'] }, more: ['--budget', '2'] })
  assert.equal(res.status, 0, res.stderr)
  assert.deepEqual(statuses(res).map(s => s[1]), ['dropped', 'dropped', 'survived', 'survived', 'over_budget'])
  assert.equal(lines(log).length, 3)
  assert.match(res.stderr, /: 0 killed, 2 survived, 0 invalid, 0 not_run, 2 dropped, 1 over_budget\n$/)
})

test('M14: --seed passes PROPERTY_SEED to build and test; random draws one and names it on stderr', () => {
  const log = newLog()
  const env = what => `echo "${what} \${PROPERTY_SEED-unset}" >> ${log}`
  assert.equal(run(repo, MUTANTS.slice(1, 2), { build: env('build'), test: env('test') }, { more: ['--seed', '7'] }).status, 0)
  assert.deepEqual(lines(log), [['build', '7'], ['test', '7'], ['build', '7'], ['test', '7']])
  writeFileSync(log, '')
  const res = run(repo, MUTANTS.slice(1, 2), { build: 'exit 0', test: env('test') }, { more: ['--seed', 'random'] })
  assert.equal(res.status, 0, res.stderr)
  const seeds = lines(log).map(l => l[1])
  assert.match(seeds[0], /^\d+$/)
  assert.deepEqual(seeds, [seeds[0], seeds[0]])
  assert.match(res.stderr, new RegExp(`^mutate: ${RANGE} seed ${seeds[0]}: `))
  writeFileSync(log, '')
  run(repo, MUTANTS.slice(1, 2), { build: 'exit 0', test: env('test') })
  assert.deepEqual(lines(log).map(l => l[1]), ['unset', 'unset'])
})

// Last: it leaves a locked worktree behind.
test('M04: a worktree that cannot be removed is exit 2 with the reason on stderr, after the report', () => {
  const res = run(repo, MUTANTS.slice(0, 1), { test: 'grep -q "x + 2" a.js && git worktree lock "$PWD"; exit 0' })
  assert.equal(res.status, 2)
  assert.match(res.stderr, /^mutate: remove .*worktree/m)
  assert.deepEqual(statuses(res), [['C1', 'survived']])
})
