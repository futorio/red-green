// Runs mutate.mjs on a throwaway git repository with a tiny build and test command.
//
//     node --test .claude/workflows/ticket-tdd/skills/test_mutate.mjs
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
const run = (r, mutants) => {
  const file = join(tmp, `in-${Math.random()}.json`)
  writeFileSync(file, JSON.stringify(mutants))
  return spawnSync('node', [RUNNER, '--mutants', file, '--repo', r, '--head', head, '--dir', join(tmp, 'run'),
    '--build', 'node --check a.js', '--test', 'node -e "process.exit(require(\'./a.js\').inc(1) === 2 ? 0 : 1)"', '--timeout', '2'], { encoding: 'utf8' })
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
