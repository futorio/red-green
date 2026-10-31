// The proofs and strays bookkeeping: each proof a code lens writes is a fix's to rewrite or delete; one no fix
// accounts for is a stray, a failure of the run. It reads failures (settle).
// @part track
// Only the code lens proves a finding. Each proof is a fix's to rewrite or delete; one no fix accounts for is a stray.
const proofs = []
const settled = new Set()
const strayProofs = []
const stray = f => { settled.add(f.id); strayProofs.push({ id: f.id, path: f.proof.path }) }
// A proof from another source is not sent to a fix, but its file may exist: it is a stray, never dropped silently.
function proven(f) {
  if (f.proof && f.source !== 'code') { stray(f); delete f.proof }
  if (f.proof) proofs.push(f)
  return f
}
// A fix accounts for each proof it was sent, by id or path, in its proofs; one it does not is a stray.
const reconcile = (sent, res) => sent.filter(f => f.proof && !settled.has(f.id))
  .forEach(f => res.proofs.some(p => p.id === f.id || p.path === f.proof.path) ? settled.add(f.id) : stray(f))
// @part settle
// A proof no fix was sent (its fix died, the run stopped) is a stray too; strays count as failures only here, so
// one never skips the minor fix.
proofs.filter(f => !settled.has(f.id)).forEach(stray)
strayProofs.forEach(s => failures.push(`stray proof ${s.id}: ${s.path}`))
