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

test('C02: a marker in an untracked file is read; one in an ignored file is not', () => {
  const repo = setup({ 'a.js': '// contract: a.kept: kept\n', '.gitignore': 'out/\n' },
    { 'b.js': '// contract: a.untracked: not tracked\n', 'out/c.js': '// contract: a.ignored: ignored\n' })
  const text = doc(repo)
  assert.ok(text.includes('`a.kept`'), text)
  assert.ok(text.includes('`a.untracked`'), text)
  assert.ok(!text.includes('a.ignored'), text)
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

test('C07: a contract: line with no comment opener is prose, not a marker', () => {
  const repo = setup({ 'a.md': 'The renderer keeps one\ncontract:\nwith its caller.\n  contract: x.y: also prose\n', 'b.js': '// contract: a.one: one\n' })
  const text = doc(repo)
  assert.ok(text.includes('`a.one`'), text)
  assert.ok(!text.includes('x.y'), text)
})

// A repository whose test command is `node t.mjs`: it holds a contract `id` with `domain` (a JSON value, or a raw
// string) and, when its examples file is there, copies the file to $OUT and runs `body` (examples in `ex`, failed ids
// pushed onto `failed`), then writes `<id>.failed` unless `body` returns false.
const property = (domain, body = '', id = 'p.a') => setup({ 't.mjs': `// contract: ${id}: a property
// domain: ${typeof domain === 'string' ? domain : JSON.stringify(domain)}
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
const file = process.env.PROPERTY_DIR + '/${id}.json'
if (existsSync(file)) {
  const ex = JSON.parse(readFileSync(file, 'utf8')), failed = []
  if (process.env.OUT) copyFileSync(file, process.env.OUT)
  const write = (() => { ${body} })()
  if (write !== false) writeFileSync(process.env.PROPERTY_DIR + '/${id}.failed', failed.join('\\n'))
}
` })
const run = (repo, args = [], env = {}) =>
  spawnSync('node', [CLI, 'run', ...args, '--', 'node', 't.mjs'], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } })
const examples = (domain, args = []) => {
  const repo = property(domain), out = join(repo, '.out.json')
  const r = run(repo, args, { OUT: out })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(readFileSync(out, 'utf8'))
}

test('R01: the same seed gives the same examples, another seed others; the count is 100 unless given', () => {
  const d = { list: { int: [0, 1000] }, len: [0, 5] }
  const a = examples(d)
  assert.equal(a.length, 100)
  assert.deepEqual(examples(d), a)
  assert.deepEqual(examples(d, ['--seed', '7']), examples(d, ['--seed', '7']))
  assert.notDeepEqual(examples(d, ['--seed', '7']), a)
  assert.equal(examples(d, ['--examples', '3']).length, 3)
})

test('R02: the command sees the seed and the examples count in their variables', () => {
  const repo = property({ int: [0, 1] }, `writeFileSync(process.env.OUT + '.env', process.env.PROPERTY_SEED + ' ' + process.env.PROPERTY_EXAMPLES)`)
  const r = run(repo, ['--seed', '42', '--examples', '5'], { OUT: join(repo, 'o') })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(readFileSync(join(repo, 'o.env'), 'utf8'), '42 5')
})

test('R03: each domain type is generated within its bounds', () => {
  const each = (domain, ok) => { for (const v of examples(domain)) assert.ok(ok(v), `${JSON.stringify(domain)}: ${JSON.stringify(v)}`) }
  const ints = examples({ int: [-3, 3] })
  assert.ok(ints.every(v => Number.isInteger(v) && v >= -3 && v <= 3), ints)
  assert.deepEqual([...new Set(ints)].sort(), [-1, -2, -3, 0, 1, 2, 3])
  each({ bytes: [2, 4] }, v => Array.isArray(v) && v.length >= 2 && v.length <= 4 && v.every(b => Number.isInteger(b) && b >= 0 && b <= 255))
  each({ string: [0, 3] }, v => typeof v === 'string' && v.length <= 3 && /^[\x20-\x7e]*$/.test(v))
  each({ string: [1, 2], chars: 'ab' }, v => /^[ab]{1,2}$/.test(v))
  each({ list: { int: [5, 6] }, len: [1, 3] }, v => v.length >= 1 && v.length <= 3 && v.every(x => x === 5 || x === 6))
  each({ tuple: [{ int: [0, 0] }, { string: [1, 1], chars: 'z' }] }, v => v.length === 2 && v[0] === 0 && v[1] === 'z')
  const picks = examples({ oneof: [{ int: [0, 0] }, { const: 'x' }] })
  assert.deepEqual([...new Set(picks)].sort(), [0, 'x'])
})

test('R04: all examples passing exits 0; a contract with no domain gets no file', () => {
  const repo = setup({ 'a.js': '// contract: q.none: no domain here\n' })
  writeFileSync(join(repo, 't.mjs'), `import { readdirSync } from 'node:fs'\nif (readdirSync(process.env.PROPERTY_DIR).length) process.exit(9)\n`)
  const r = run(repo)
  assert.equal(r.status, 0, r.stderr)
  const ok = run(property({ int: [0, 9] }))
  assert.equal(ok.status, 0, ok.stderr)
})

test('R05: a failed example exits 1, naming the seed and the original example', () => {
  const repo = property({ int: [0, 9] }, `ex.forEach((v, i) => { console.log('property: p.a ' + i); if (v === 7) failed.push(i) })`)
  const r = run(repo, ['--seed', '3'])
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /p\.a: example \d+ failed, seed 3: 7\n/)
})

test('R06: an abnormal exit with no results file is red on the last printed example', () => {
  const repo = property({ int: [0, 9] }, `ex.forEach((v, i) => { console.log('property: p.a ' + i); if (v === 7) process.exit(134) })`)
  const r = run(repo, ['--seed', '3'])
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /p\.a: red on example \d+, seed 3: 7; the command exited 134 with no p\.a\.failed/)
})

test('R07: a clean exit with no results file is an error', () => {
  const r = run(property({ int: [0, 9] }, 'return false'))
  assert.equal(r.status, 2)
  assert.match(r.stderr, /p\.a: no p\.a\.failed after a clean exit/)
})

test('R08: an example id in the results file that was not in the examples file is an error', () => {
  const r = run(property({ int: [0, 9] }, 'failed.push(ex.length)'), ['--examples', '4'])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /p\.a: p\.a\.failed names example 4, not in p\.a\.json/)
})

test('R09: a domain outside the language is an error naming its marker', () => {
  for (const d of ['{"float": [0, 1]}', '{"int": [2, 1]}', 'not json']) {
    const r = run(property(d))
    assert.equal(r.status, 2, d)
    assert.match(r.stderr, /t\.mjs:2: p\.a: domain/, d)
  }
})

test('R10: a red run names the first 3 failed examples of a contract and counts the rest', () => {
  const r = run(property({ int: [0, 9] }, 'ex.forEach((v, i) => failed.push(i))'), ['--examples', '10'])
  assert.equal(r.status, 1, r.stderr)
  assert.equal(r.stderr.match(/p\.a: example \d+ failed/g).length, 3, r.stderr)
  assert.match(r.stderr, /p\.a: 7 more failed examples\n/)
})

// The reduced example a red run reports for `domain` when `bad` (a JS expression over `v`) names a failing example.
const reduced = (domain, bad) => {
  const r = run(property(domain, `ex.forEach((v, i) => { if (${bad}) failed.push(i) })`))
  assert.equal(r.status, 1, r.stderr)
  const m = /p\.a: example (\d+) failed, seed 1: .*\n(?:.*\n)*?contracts: p\.a: example (\d+) reduced in \d+ reruns: (.*)\n/.exec(r.stderr)
  assert.ok(m, r.stderr)
  assert.equal(m[2], m[1], 'the first failed example is the one reduced')
  return JSON.parse(m[3])
}

test('R11: a failed example is reduced by its domain until no smaller example fails', () => {
  assert.equal(reduced({ int: [0, 1000] }, 'v >= 37'), 37)
  assert.equal(reduced({ int: [-50, 50] }, 'v >= -20'), -20)
  assert.deepEqual(reduced({ bytes: [1, 8] }, 'v.some(b => b >= 200)'), [200])
  assert.equal(reduced({ string: [0, 10] }, '/[x-~]/.test(v)'), 'x')
  assert.equal(reduced({ string: [2, 6], chars: 'abc' }, 'true'), 'aa')
  assert.deepEqual(reduced({ list: { int: [0, 100] }, len: [1, 6] }, 'v.length >= 3'), [0, 0, 0])
  assert.deepEqual(reduced({ tuple: [{ int: [0, 9] }, { string: [0, 5], chars: 'ab' }] }, "v[0] >= 4 && v[1].includes('b')"), [4, 'b'])
  const choice = { oneof: [{ const: 'none' }, { int: [0, 99] }] }
  assert.equal(reduced(choice, 'true'), 'none')
  assert.equal(reduced(choice, "v !== 'none' && v >= 10"), 10)
})

test('R12: a crash with no results file is reduced too', () => {
  const r = run(property({ int: [0, 99] }, `ex.forEach((v, i) => { console.log('property: p.a ' + i); if (v >= 30) process.exit(134) })`))
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /p\.a: red on example \d+, seed 1: \d+; the command exited 134 with no p\.a\.failed\n(?:.*\n)*contracts: p\.a: example \d+ reduced in \d+ reruns: 30\n/)
})

test('R13: a rerun writes only the reduced contract\'s file and runs the command again', () => {
  const repo = setup({ 't.mjs': `// contract: p.a: a property
// domain: {"int": [0, 99]}
// contract: p.b: another property
// domain: {"int": [0, 99]}
import { existsSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
const dir = process.env.PROPERTY_DIR
appendFileSync('runs.log', readdirSync(dir).sort().join(' ') + '\\n')
for (const id of ['p.a', 'p.b']) {
  if (!existsSync(dir + '/' + id + '.json')) continue
  const ex = JSON.parse(readFileSync(dir + '/' + id + '.json', 'utf8'))
  writeFileSync(dir + '/' + id + '.failed', ex.flatMap((v, i) => id === 'p.a' && v >= 10 ? [i] : []).join('\\n'))
}
` })
  const r = run(repo)
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /p\.a: example \d+ reduced in \d+ reruns: 10\n/)
  assert.doesNotMatch(r.stderr, /p\.b/)
  const runs = readFileSync(join(repo, 'runs.log'), 'utf8').trim().split('\n')
  assert.equal(runs[0], 'p.a.json p.b.json')
  assert.ok(runs.length > 1)
  for (const l of runs.slice(1)) assert.equal(l, 'p.a.json')
})

test('R14: a record is generated as an object with the declared keys in declared order, nested and in lists too', () => {
  const d = { record: { seed: { int: [0, 9] }, cuts: { list: { record: { dir: { int: [0, 2] }, at: { int: [5, 5] } } }, len: [1, 2] },
    inner: { record: { b: { const: 'x' }, a: { int: [1, 1] } } } } }
  for (const v of examples(d)) {
    assert.deepEqual(Object.keys(v), ['seed', 'cuts', 'inner'], JSON.stringify(v))
    assert.ok(Number.isInteger(v.seed) && v.seed >= 0 && v.seed <= 9, JSON.stringify(v))
    assert.ok(v.cuts.length >= 1 && v.cuts.length <= 2, JSON.stringify(v))
    for (const c of v.cuts) assert.deepEqual(Object.keys(c), ['dir', 'at'], JSON.stringify(v))
    assert.equal(JSON.stringify(v.inner), '{"b":"x","a":1}')
  }
})

test('R15: a record is reduced field by field and reported with its names', () => {
  const d = { record: { loss: { int: [0, 40] }, name: { string: [0, 5], chars: 'ab' }, cuts: { list: { record: { at: { int: [0, 99] } } }, len: [0, 3] } } }
  const r = run(property(d, `ex.forEach((v, i) => { if (v.loss >= 7 && v.cuts.some(c => c.at >= 20)) failed.push(i) })`))
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /p\.a: example \d+ reduced in \d+ reruns: \{"loss":7,"name":"","cuts":\[\{"at":20\}\]\}\n/)
  assert.deepEqual(reduced({ oneof: [{ const: 0 }, { record: { a: { int: [0, 9] } } }] }, 'v !== 0 && v.a >= 3'), { a: 3 })
})

test('R16: a domain continues over comment lines with its opener until the JSON is complete; an unterminated one is an error naming its file', () => {
  const spread = '{"record": {\n//   "seed": {"int": [0, 9]},\n//   "loss": {"int": [3, 3]}\n// }}'
  const v = examples(spread)
  assert.equal(v.length, 100)
  for (const x of v) assert.deepEqual(Object.keys(x), ['seed', 'loss'])
  const py = setup({ 't.py': '# contract: p.a: a property\n# domain: {"tuple": [\n#   {"int": [4, 4]}]}\n',
    't.mjs': `import { existsSync, readFileSync, writeFileSync } from 'node:fs'
const f = process.env.PROPERTY_DIR + '/p.a.json'
if (existsSync(f)) { if (!JSON.parse(readFileSync(f, 'utf8')).every(x => x[0] === 4)) process.exit(9); writeFileSync(f.replace('json', 'failed'), '') }
` })
  const ok = run(py)
  assert.equal(ok.status, 0, ok.stderr)
  for (const domain of ['{"record": {\n//   "seed": {"int": [0, 9]}', '{"record": {\n#   "seed": {"int": [0, 9]}}}']) {
    const r = run(property(domain))
    assert.equal(r.status, 2, domain)
    assert.match(r.stderr, /t\.mjs:2: p\.a: domain/, domain)
  }
})

test('C08: doc and doc --check accept a one-line and a multi-line domain', () => {
  const repo = setup({ 'a.js': '// contract: a.one: one\n// domain: {"int": [0, 1]}\n',
    'b.js': '// contract: a.two: two\n// domain: {"record": {\n//   "x": {"int": [0, 1]}\n// }}\n' })
  const text = doc(repo)
  assert.ok(text.includes('`a.one`: one (a.js)') && text.includes('`a.two`: two (b.js)'), text)
  const r = cli(repo, 'doc', 'CONTRACTS.md', '--check')
  assert.equal(r.status, 0, r.stderr)
})

test('C09: doc and doc --check reject an unterminated or invalid domain as a malformed marker naming its line, writing nothing', () => {
  for (const domain of ['{"record": {\n//   "x": {"int": [0, 1]}', '{"int": [2, 1]}', 'not json']) {
    const repo = setup({ 'a.js': `// contract: a.one: one\n// domain: ${domain}\n` })
    for (const a of [['doc', 'CONTRACTS.md'], ['doc', 'CONTRACTS.md', '--check']]) {
      const r = cli(repo, ...a)
      assert.equal(r.status, 1, `${a} ${domain}`)
      assert.match(r.stderr, /^a\.js:2: a\.one: domain: malformed marker: /m, r.stderr)
    }
    assert.ok(!existsSync(join(repo, 'CONTRACTS.md')))
  }
})

test('C10: in a Markdown file only <!-- opens a marker; a bullet or a heading is prose', () => {
  const repo = setup({ 'a.md': '* contract: x.bullet: prose\n# contract: x.heading: prose\n<!-- contract: a.md: a marker -->\n',
    'b.py': '# contract: a.py: a marker\n' })
  const text = doc(repo)
  assert.ok(text.includes('`a.md`') && text.includes('`a.py`'), text)
  assert.ok(!text.includes('x.'), text)
})

test('R17: a reduction stopped by the cap of 100 reruns says so', () => {
  const r = run(property({ list: { int: [0, 1000] }, len: [120, 120] }, 'ex.forEach((v, i) => failed.push(i))'), ['--examples', '1'])
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /p\.a: example 0 reduced in 100 reruns, stopped at the cap: \[/)
})
