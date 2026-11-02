// Runs contracts.mjs on throwaway git repositories.
//
//     node --test .claude/workflows/red-green/skills/test_contracts.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync, execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const CLI = new URL('./contracts.mjs', import.meta.url).pathname

// A repository holding `files` ({path: text}), all committed unless listed in `untracked`.
const setup = (files, untracked = {}) => {
  const repo = mkdtempSync(join(tmpdir(), 'tdd-contracts-'))
  execFileSync('git', ['init', '-q', repo])
  const put = all => { for (const [p, text] of Object.entries(all)) { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), text) } }
  put(files)
  execFileSync('git', ['-C', repo, 'add', '.'])
  put(untracked)
  return repo
}
const cli = (repo, ...a) => spawnSync('node', [CLI, ...a], { cwd: repo, encoding: 'utf8' })
const doc = (repo, path = 'CONTRACTS.md') => {
  const r = cli(repo, 'doc', path)
  assert.equal(r.status, 0, r.stderr)
  return readFileSync(join(repo, path), 'utf8')
}

test('C01: doc reads the marker in several comment forms and groups contracts by id prefix', () => {
  const repo = setup({
    'a.js': '// contract: parse.int: parse accepts every decimal integer\n',
    'b.py': 'x = 1\n    # contract: parse.float: parse accepts every float\n',
    'c.c': '/* contract: hash.stable: equal inputs give equal hashes */\n',
    'd.sql': '-- contract: hash.short: a hash is 8 bytes\n',
    'e.html': '<!-- contract: render.escape: output never holds a raw angle bracket -->\n',
  })
  const text = doc(repo)
  const at = s => { const i = text.indexOf(s); assert.ok(i >= 0, `${s} missing from\n${text}`); return i }
  assert.ok(at('## hash') < at('`hash.short`: a hash is 8 bytes') && at('`hash.short`') < at('## parse'), text)
  assert.ok(at('`hash.stable`: equal inputs give equal hashes (c.c)') < at('## parse'))
  assert.ok(at('## parse') < at('`parse.float`: parse accepts every float (b.py)') && at('`parse.int`') < at('## render'))
  at('`render.escape`: output never holds a raw angle bracket (e.html)')
  at('`parse.int`: parse accepts every decimal integer (a.js)')
})

test('C02: a marker in an untracked file is ignored', () => {
  const repo = setup({ 'a.js': '// contract: a.kept: kept\n' }, { 'b.js': '// contract: a.untracked: not tracked\n' })
  const text = doc(repo)
  assert.ok(text.includes('`a.kept`'), text)
  assert.ok(!text.includes('a.untracked'), text)
})

test('C03: a statement of 255 characters passes; one of 256 fails, writing nothing', () => {
  const ok = setup({ 'a.js': `// contract: a.long: ${'é'.repeat(255)}\n` })
  assert.ok(doc(ok).includes('é'.repeat(255)))
  const bad = setup({ 'a.js': `// contract: a.long: ${'é'.repeat(256)}\n` })
  for (const a of [['doc', 'CONTRACTS.md'], ['doc', 'CONTRACTS.md', '--check']]) {
    const r = cli(bad, ...a)
    assert.equal(r.status, 1, a.join(' '))
    assert.match(r.stderr, /a\.js:1: a\.long: statement is 256 characters, over 255/)
  }
  assert.ok(!existsSync(join(bad, 'CONTRACTS.md')))
})

test('C04: a duplicate id fails, naming both places', () => {
  const repo = setup({ 'a.js': '// contract: a.same: one\n', 'b.js': 'x\n# contract: a.same: two\n' })
  const r = cli(repo, 'doc', 'CONTRACTS.md', '--check')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /b\.js:2: a\.same: duplicate id, also at a\.js:1/)
})

test('C05: a malformed marker fails', () => {
  for (const line of ['// contract: no statement here', '// contract: a.b:', '# contract: bad id: x']) {
    const repo = setup({ 'a.js': `${line}\n` })
    const r = cli(repo, 'doc', 'CONTRACTS.md')
    assert.equal(r.status, 1, line)
    assert.match(r.stderr, /a\.js:1: malformed marker/, line)
  }
})

test('C06: --check passes on the doc that doc wrote, and fails on a stale or missing one', () => {
  const repo = setup({ 'a.js': '// contract: a.one: one\n' })
  doc(repo, 'docs/contracts.md')
  const ok = cli(repo, 'doc', 'docs/contracts.md', '--check')
  assert.equal(ok.status, 0, ok.stderr)
  writeFileSync(join(repo, 'a.js'), '// contract: a.one: one, changed\n')
  const stale = cli(repo, 'doc', 'docs/contracts.md', '--check')
  assert.equal(stale.status, 1)
  assert.match(stale.stderr, /docs\/contracts\.md: stale/)
  assert.ok(!readFileSync(join(repo, 'docs/contracts.md'), 'utf8').includes('changed'), '--check writes nothing')
  const missing = cli(repo, 'doc', 'other.md', '--check')
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /other\.md: missing/)
})
