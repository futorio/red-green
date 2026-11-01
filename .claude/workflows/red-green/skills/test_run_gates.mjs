// Runs run_gates.mjs on throwaway git repositories with tiny commands.
//
//     node --test .claude/workflows/red-green/skills/test_run_gates.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RUNNER = new URL('./run_gates.mjs', import.meta.url).pathname

// A repository with one commit, an ignored path, and a run directory and a scratch directory outside it.
const setup = () => {
  const tmp = mkdtempSync(join(tmpdir(), 'tdd-gates-'))
  const repo = join(tmp, 'repo')
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' })
  execFileSync('git', ['init', '-q', repo])
  writeFileSync(join(repo, 'a.txt'), 'a\n')
  writeFileSync(join(repo, '.gitignore'), 'ignored*\n')
  git('add', '.')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'a')
  return { tmp, repo, git, dir: join(tmp, 'run') }
}
const args = (s, gates, o = {}) => [RUNNER, '--gates', JSON.stringify(gates), '--dir', s.dir,
  ...(o.tier ? ['--tier', o.tier] : []),
  ...(o.baseline ? ['--baseline', JSON.stringify(o.baseline)] : []),
  ...(o.noCache ? ['--no-cache'] : []),
  ...(o.wait ? ['--wait', String(o.wait)] : []),
  ...(o.timeout ? ['--timeout', String(o.timeout)] : [])]
const run = (s, gates, o) => spawnSync('node', args(s, gates, o), { cwd: s.repo, encoding: 'utf8' })
const rows = res => {
  assert.equal(res.status, 0, res.stderr)
  return res.stdout.trim().split('\n').map(l => JSON.parse(l))
}

test('G01: status comes from the exit code; a row holds name, status, line, log, seconds, cached', () => {
  const s = setup()
  const [ok, bad] = rows(run(s, [{ name: 'ok', command: 'echo first; echo last; echo' }, { name: 'bad', command: 'echo green; exit 1' }]))
  assert.deepEqual(Object.keys(ok).sort(), ['cached', 'line', 'log', 'name', 'seconds', 'status'])
  assert.equal(ok.name, 'ok')
  assert.equal(ok.status, 'green')
  assert.equal(ok.cached, false)
  assert.equal(typeof ok.seconds, 'number')
  assert.equal(bad.status, 'red', 'the text says green, the exit code decides')
})

test('G02: line is the last non-empty output line, stderr included, or (no output)', () => {
  const s = setup()
  const [a, b, c] = rows(run(s, [
    { name: 'a', command: 'echo first; echo last; echo; echo "  "' },
    { name: 'b', command: 'echo out; echo err >&2' },
    { name: 'silent', command: 'true' },
  ]))
  assert.equal(a.line, 'last')
  assert.equal(b.line, 'err')
  assert.equal(c.line, '(no output)')
})

test('G03: log holds the full output under the run directory', () => {
  const s = setup()
  const [r] = rows(run(s, [{ name: 'a/../b', command: 'echo first; echo second >&2; echo third' }]))
  assert.ok(r.log.startsWith(s.dir + '/'), r.log)
  assert.equal(readFileSync(r.log, 'utf8'), 'first\nsecond\nthird\n')
})

test('G04: tiers are cumulative; an absent tier means round, on the gate and on the call', () => {
  const s = setup()
  const gates = [
    { name: 'f', command: 'true', tier: 'fast' },
    { name: 'r', command: 'true', tier: 'round' },
    { name: 'plain', command: 'true' },
    { name: 'x', command: 'true', tier: 'acceptance' },
  ]
  const names = o => rows(run(s, gates, o)).map(r => r.name)
  assert.deepEqual(names({ tier: 'fast', noCache: true }), ['f'])
  assert.deepEqual(names({ tier: 'round', noCache: true }), ['f', 'r', 'plain'])
  assert.deepEqual(names({ noCache: true }), ['f', 'r', 'plain'])
  assert.deepEqual(names({ tier: 'acceptance', noCache: true }), ['f', 'r', 'plain', 'x'])
})

test('G05: a gate red in the baseline is known_red, and still runs; green there, or absent, stays red', () => {
  const s = setup()
  const count = join(s.tmp, 'count')
  const res = rows(run(s, [
    { name: 'old', command: `echo x >> ${count}; echo broken; exit 1` },
    { name: 'new', command: 'exit 1' },
    { name: 'other', command: 'exit 1' },
    { name: 'fixed', command: 'true' },
  ], { baseline: { old: { status: 'red', line: 'broken' }, new: { status: 'green', line: 'ok' }, fixed: { status: 'red', line: 'x' } } }))
  assert.deepEqual(res.map(r => r.status), ['known_red', 'red', 'red', 'green'])
  assert.equal(res[0].line, 'broken')
  assert.equal(readFileSync(count, 'utf8'), 'x\n')
})

test('G06: exit 0 when the report is complete, every gate red', () => {
  const s = setup()
  assert.equal(run(s, [{ name: 'a', command: 'exit 7' }, { name: 'b', command: 'exit 1' }]).status, 0)
})

test('G07: exit 2 with the cause on stderr when it could not run', () => {
  const s = setup()
  const fails = (res, cause) => {
    assert.equal(res.status, 2, res.stderr)
    assert.match(res.stderr, cause)
    assert.equal(res.stdout, '')
  }
  const gates = [{ name: 'a', command: 'true' }]
  fails(spawnSync('node', [RUNNER, '--dir', s.dir], { cwd: s.repo, encoding: 'utf8' }), /--gates/)
  fails(spawnSync('node', [RUNNER, '--gates', '[]'], { cwd: s.repo, encoding: 'utf8' }), /--dir/)
  fails(spawnSync('node', [RUNNER, '--gates', 'not json', '--dir', s.dir], { cwd: s.repo, encoding: 'utf8' }), /--gates/)
  fails(run(s, [{ name: 'a' }]), /command/)
  fails(run(s, [{ name: 'a', command: 'true', tier: 'nope' }]), /nope/)
  fails(run(s, gates, { tier: 'nope' }), /nope/)
  fails(run(s, gates, { baseline: 'x' }), /--baseline/)
  fails(run(s, gates, { wait: 'soon' }), /--wait/)
  fails(run(s, gates, { timeout: 'soon' }), /--timeout/)
  fails(run(s, [{ name: 'heavy', command: 'true', tier: 'acceptance' }], { tier: 'fast' }), /no gates/)
  fails(run(s, [{ name: 'a', command: 'true' }, { name: 'a', command: 'false' }]), /twice/)
  const outside = mkdtempSync(join(tmpdir(), 'tdd-gates-'))
  fails(spawnSync('node', args(s, gates), { cwd: outside, encoding: 'utf8' }), /git/)
  writeFileSync(join(s.tmp, 'file'), '')
  fails(run({ ...s, dir: join(s.tmp, 'file', 'run') }, gates), /file/)
  assert.ok(!existsSync(s.dir), 'nothing ran')
})

// A gate that counts its runs in a file outside the repository, and that count.
const counting = (s, name = 'a') => {
  const file = join(s.tmp, `count-${name}`)
  return { gate: { name, command: `echo x >> ${file}; echo done` }, runs: () => existsSync(file) ? readFileSync(file, 'utf8').split('\n').length - 1 : 0 }
}

test('G08: an unchanged tree is a cache hit, a red gate too, with its status, line and log', () => {
  const s = setup()
  const a = counting(s)
  const red = { name: 'red', command: `echo x >> ${join(s.tmp, 'count-red')}; echo why; exit 1` }
  const [first, firstRed] = rows(run(s, [a.gate, red]))
  const [second, secondRed] = rows(run(s, [a.gate, red]))
  assert.equal(a.runs(), 1)
  assert.equal(readFileSync(join(s.tmp, 'count-red'), 'utf8'), 'x\n')
  assert.deepEqual([first.cached, second.cached, secondRed.cached], [false, true, true])
  assert.deepEqual(secondRed, { ...firstRed, cached: true })
  assert.deepEqual(second, { ...first, cached: true })
})

test('G09: a changed tracked file, a new untracked file and a changed HEAD miss; an ignored file does not', () => {
  const s = setup()
  const a = counting(s)
  const cached = () => rows(run(s, [a.gate]))[0].cached
  assert.equal(cached(), false)
  assert.equal(cached(), true)
  writeFileSync(join(s.repo, 'ignored.txt'), 'x\n')
  assert.equal(cached(), true, 'an ignored file')
  writeFileSync(join(s.repo, 'a.txt'), 'changed\n')
  assert.equal(cached(), false, 'a changed tracked file')
  assert.equal(cached(), true)
  writeFileSync(join(s.repo, 'new.txt'), 'x\n')
  assert.equal(cached(), false, 'a new untracked file')
  assert.equal(cached(), true)
  s.git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'b')
  assert.equal(cached(), false, 'a changed HEAD')
  assert.equal(a.runs(), 4)
  assert.equal(s.git('status', '--porcelain', '--', 'new.txt'), '?? new.txt\n', 'the real index is untouched')
})

test('G10: a gate generating a non-ignored file misses once more, as the tree it ran on is not the tree after it', () => {
  const s = setup()
  const file = join(s.tmp, 'count-gen')
  const gen = { name: 'gen', command: `echo x >> ${file}; echo generated > generated.txt` }
  // Its first result is keyed on the tree without the file, so the next call misses; that run's key holds the file.
  assert.deepEqual([1, 2, 3].map(() => rows(run(s, [gen]))[0].cached), [false, false, true])
  assert.equal(readFileSync(file, 'utf8'), 'x\nx\n')
})

test('G11: the no-cache flag neither reads nor writes the cache', () => {
  const s = setup()
  const a = counting(s)
  rows(run(s, [a.gate]))
  assert.equal(rows(run(s, [a.gate], { noCache: true }))[0].cached, false, 'does not read')
  assert.equal(a.runs(), 2)
  const b = counting(s, 'b')
  rows(run(s, [b.gate], { noCache: true }))
  assert.equal(rows(run(s, [b.gate]))[0].cached, false, 'did not write')
  assert.equal(b.runs(), 2)
})

// Polls until the condition holds; the runner's calls are other processes.
const until = async cond => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 50))
  assert.ok(cond(), 'timed out waiting')
}
// A call as a child process, its result as a promise.
const call = (s, gates, o) => new Promise(resolve => {
  const p = spawn('node', args(s, gates, o), { cwd: s.repo })
  let stdout = '', stderr = ''
  p.stdout.on('data', d => { stdout += d })
  p.stderr.on('data', d => { stderr += d })
  p.on('exit', status => resolve({ status, stdout, stderr }))
})

test('G12: exit 3 past the wait limit, the gates surviving the caller; a later call collects them, and only once', async () => {
  const s = setup()
  const marker = join(s.tmp, 'marker')
  const gate = { name: 'slow', command: `echo x >> ${join(s.tmp, 'count')}; sleep 1; echo done > ${marker}; echo finished` }
  const o = { noCache: true }
  const early = run(s, [gate], { ...o, wait: 0.2 })
  assert.equal(early.status, 3, early.stderr)
  assert.equal(early.stdout, '')
  assert.match(early.stderr, /call again/)
  assert.ok(!existsSync(marker))
  const still = run(s, [gate], { ...o, wait: 0.1 })
  assert.equal(still.status, 3, 'a call inside the limit starts nothing either')
  await until(() => existsSync(marker))
  await new Promise(r => setTimeout(r, 300))
  const [row] = rows(run(s, [gate], o))
  assert.equal(row.line, 'finished')
  assert.equal(readFileSync(join(s.tmp, 'count'), 'utf8'), 'x\n', 'collected, not run again')
  rows(run(s, [gate], { ...o, wait: 5 }))
  assert.equal(readFileSync(join(s.tmp, 'count'), 'utf8'), 'x\nx\n', 'a collected run is not collected twice')
})

test('G13: a later call waits for a running gate it did not start, then reports it', () => {
  const s = setup()
  const gate = { name: 'slow', command: `echo x >> ${join(s.tmp, 'count')}; sleep 1; echo finished` }
  assert.equal(run(s, [gate], { wait: 0.1, noCache: true }).status, 3)
  assert.equal(rows(run(s, [gate], { noCache: true }))[0].line, 'finished')
  assert.equal(readFileSync(join(s.tmp, 'count'), 'utf8'), 'x\n')
})

test('G14: a second call waits for the running one and starts nothing of its own', async () => {
  const s = setup()
  const count = join(s.tmp, 'count')
  const gate = { name: 'slow', command: `echo x >> ${count}; sleep 1; echo finished` }
  const first = call(s, [gate], { noCache: true })
  await until(() => existsSync(count))
  const [a, b] = await Promise.all([first, call(s, [gate], { noCache: true })])
  assert.deepEqual(rows(b), rows(a))
  assert.equal(rows(b)[0].line, 'finished')
  assert.equal(readFileSync(count, 'utf8'), 'x\n')
})

test('G15: a call with other gates waits for the running one, then runs its own, never at once', async () => {
  const s = setup()
  const log = join(s.tmp, 'log')
  const first = call(s, [{ name: 'one', command: `echo one-in >> ${log}; sleep 1; echo one-out >> ${log}` }])
  await until(() => existsSync(log))
  const [a, b] = await Promise.all([first, call(s, [{ name: 'two', command: `echo two >> ${log}` }])])
  assert.deepEqual(rows(a).map(r => r.name), ['one'])
  assert.deepEqual(rows(b).map(r => r.name), ['two'])
  assert.equal(readFileSync(log, 'utf8'), 'one-in\none-out\ntwo\n')
})

// The process holding the worktree's lock.
const holderOf = s => JSON.parse(readFileSync(join(s.repo, '.git', 'red-green-gates.lock'), 'utf8')).pid

test('G16: a dead holder\'s lock is taken over, and the retry picks up its finished gates', async () => {
  const s = setup()
  const a = counting(s)
  const pid = join(s.tmp, 'pid'), flag = join(s.tmp, 'flag')
  const hang = { name: 'hang', command: `echo $$ > ${pid}; test -f ${flag} || sleep 60; echo over` }
  assert.equal(run(s, [a.gate, hang], { wait: 0.1 }).status, 3)
  await until(() => existsSync(pid) && readFileSync(pid, 'utf8').trim())
  const pgid = execFileSync('ps', ['-o', 'pgid=', '-p', readFileSync(pid, 'utf8').trim()], { encoding: 'utf8' }).trim()
  process.kill(-holderOf(s), 'SIGKILL')
  process.kill(-Number(pgid), 'SIGKILL')
  writeFileSync(flag, '')
  const [first, second] = rows(run(s, [a.gate, hang]))
  assert.equal(first.cached, true, 'the finished gate')
  assert.equal(a.runs(), 1)
  assert.deepEqual([second.status, second.line, second.cached], ['green', 'over', false])
})

test('G19: a gate past --timeout is not_run, its whole process group killed; the next gate runs and the lock is free', async () => {
  const s = setup()
  const marker = join(s.tmp, 'marker')
  const hung = { name: 'hung', command: `(sleep 1; touch ${marker}) & wait` }
  const [row, next] = rows(run(s, [hung, { name: 'next', command: 'echo ran' }], { timeout: 0.3 }))
  assert.equal(row.status, 'not_run')
  assert.match(row.line, /timed out after 0\.3s/)
  assert.ok(row.seconds < 1, `${row.seconds}`)
  assert.equal(next.status, 'green')
  await new Promise(r => setTimeout(r, 1100))
  assert.ok(!existsSync(marker), 'the gate\'s child died with it')
  assert.ok(!existsSync(join(s.repo, '.git', 'red-green-gates.lock')))
  assert.equal(rows(run(s, [hung], { timeout: 0.3 }))[0].cached, false, 'a timed-out gate is not cached')
})

test('G20: a gate outliving its dead holder keeps the lock until its timeout, then is killed and the lock taken over', async () => {
  const s = setup()
  const pid = join(s.tmp, 'pid'), flag = join(s.tmp, 'flag')
  const hang = { name: 'hang', command: `echo $$ > ${pid}; test -f ${flag} || sleep 60; echo over` }
  assert.equal(run(s, [hang], { wait: 0.1, timeout: 2 }).status, 3)
  await until(() => existsSync(pid) && readFileSync(pid, 'utf8').trim())
  process.kill(-holderOf(s), 'SIGKILL')
  assert.equal(run(s, [hang], { wait: 0.3, timeout: 2 }).status, 3, 'the gate still holds the lock')
  writeFileSync(flag, '')
  const [row] = rows(run(s, [hang], { timeout: 2 }))
  assert.deepEqual([row.status, row.line], ['green', 'over'])
})

test('G18: a gate ended by a signal is not_run, known red or not, and is not cached', () => {
  const s = setup()
  const gate = { name: 'killed', command: `echo x >> ${join(s.tmp, 'count')}; kill -9 $$` }
  const [row] = rows(run(s, [gate], { baseline: { killed: { status: 'red', line: 'x' } } }))
  assert.equal(row.status, 'not_run')
  rows(run(s, [gate]))
  assert.equal(readFileSync(join(s.tmp, 'count'), 'utf8'), 'x\nx\n')
})

test('G17: a run that fails behind the lock is exit 2 with the cause, and a next call runs again', () => {
  const s = setup()
  mkdirSync(s.dir)
  writeFileSync(join(s.dir, 'gate-logs'), '')
  const gates = [{ name: 'a', command: 'true' }]
  const res = run(s, gates)
  assert.equal(res.status, 2)
  assert.match(res.stderr, /gate-logs/)
  rmSync(join(s.dir, 'gate-logs'))
  assert.equal(rows(run(s, gates))[0].status, 'green')
})
