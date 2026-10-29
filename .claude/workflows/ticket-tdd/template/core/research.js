// Block research: its schema, the call, the checks that repair its output into the research value later stages get,
// and its inputs. Its only interface is the include order: it reads A.replay, TARGET, failures, NO_CODE_PRE, READ_ONLY,
// call, contract, died, retryValues, validate, idOf, log, phase, and INPUTS; it declares RESEARCH_SCHEMA, research,
// reqIds, researchIssues, droppedFacts, unresearched and researchQuestions for later parts.
// @part schema

const RESEARCH_SCHEMA = { type: 'object', properties: {
  requirements: { type: 'array', items: { type: 'string', pattern: '^R\\d+: ' } },
  facts: { type: 'array', items: { type: 'object', properties: {
    kind: { type: 'string', enum: ['code', 'change-site', 'note'] }, fact: { type: 'string' },
    where: { anyOf: [{ type: 'array', items: { type: 'string' }, minItems: 1 }, { type: 'string' }] },
    requirements: { type: 'array', items: { type: 'string' }, minItems: 1 },
  }, required: ['kind', 'fact', 'where', 'requirements'] } },
  plan: { type: 'array', items: { type: 'string', maxLength: 600 } },
  test_harness: { type: 'array', items: { type: 'object', properties: {
    requirement: { type: 'string' }, by: { type: 'string', enum: ['test', 'review', 'launch', 'none'] }, how: { type: 'string' },
  }, required: ['requirement', 'by', 'how'] } },
  questions: { type: 'array', items: { type: 'object', properties: {
    requirement: { type: 'string' }, question: { type: 'string' }, settles: { type: 'string', enum: ['owner', 'outside'] },
  }, required: ['requirement', 'question', 'settles'] } },
}, required: ['requirements', 'facts', 'plan', 'test_harness', 'questions'] }
// @part call
phase('Research')
// The core checks what the agent's schema does not force (a plan step's 600 characters); an answer that fails gets one
// retry with the errors, and a retry that fails too is a dead research. A replay (args.replay, set by render.mjs alone)
// takes a recorded research as given, so results recorded before the limit still reach later stages.
const researchCall = (errors, label) => call('research', NO_CODE_PRE, 'research', Object.assign({ TARGET }, retryValues(errors)), contract(READ_ONLY, `- requirements: every checkable requirement, one line each, prefixed with its id R1, R2, … in order and naming the checklist box or phrase it comes from, e.g. "R7: grammar/effects.json holds 8 entries (Checklist › Whitelist)". Cover every checklist box.
- facts: one list, complete: every place the diff will touch, and every caller or reader of a symbol it changes. Each fact is one sentence with a kind, where, and requirements: the ids (e.g. "R7") it serves, at least one; a fact that serves the whole ticket and no requirement in particular (a shared convention, helper or harness) takes "general" instead. The kind follows one rule: lines of code show the fact → change-site when the change touches those lines, code otherwise; no lines of code show it → note.
  - code and change-site: where = a list of locations, each \`file\` or \`file:a-b\` (repository-relative, one range per entry; a fact spanning several files or ranges lists each one). A change-site fact says what is there now; a new file is named in the fact and located by an existing place it relates to.
  - note: where = one string, \`path § section\` (a repository document; the ticket's own spec only for a decision the requirement lines do not carry) or \`$ command\` (a read-only rg, grep, git, find or ls of the repository). A tool's behaviour is shown from the tree (its source, config or lock file).
- plan: the fewest actions that meet the requirements, built from the facts, in dependency order: reuse what the facts name before adding anything new, and add nothing the requirements do not ask for. Every step changes code, config or docs; running checks, committing and recording results belong to the implementer and the gates. Each step is two or three sentences: a part of the code (a module, config, script, doc set) and what is done to it, naming every tool, symbol and file it acts on; line ranges, flags, commands and lists stay in the facts.
- test_harness: exactly one entry per requirement: requirement (its id), by, how (test: the seam and where its tests live; review or launch: what is checked; none: why). The run commands stay in the gates.
- questions: every point a requirement depends on that the repository does not settle, one entry each: requirement (its id), question, settles (owner: the ticket and the spec leave it to their author; outside: the answer lies outside the repository, in running the program, outside documentation or data). An empty list says nothing was left open.`, died('Answer')),
  { schema: RESEARCH_SCHEMA, phase: 'Research', label })
const researchErrors = r => r ? validate({ type: 'object', properties: { plan: RESEARCH_SCHEMA.properties.plan } }, r).join('; ') : ''
let research = await researchCall(null, 'research')
const checkErrors = A.replay ? '' : researchErrors(research)
if (checkErrors) {
  log(`research failed its checks; retrying once: ${checkErrors}`)
  research = await researchCall(checkErrors, 'research:retry')
  const retryErrors = researchErrors(research)
  if (retryErrors) { failures.push(`research:retry output: ${retryErrors}`); research = null }
}
if (!research) return { status: 'failed', stage: 'research', failures }
// @part checks
// The research checks: ids renumbered R1..Rn when one is missing or repeated, facts that serve no listed id dropped,
// one test_harness entry per requirement, files derived from the located facts. What they repair or cannot repair is
// reported in research_issues, not failures: the run goes on as before.
const researchIssues = []
if (research.requirements.some((r, i, all) => !/^R\d+:/.test(r) || all.findIndex(x => idOf(x) === idOf(r)) !== i)) {
  research.requirements = research.requirements.map((r, i) => `R${i + 1}: ${r.replace(/^R\d+:\s*/, '')}`)
  researchIssues.push('a requirement id was missing or repeated: renumbered R1..Rn')
}
const reqIds = research.requirements.map(idOf)
const serves = f => f.requirements.some(i => idOf(i) === 'general' || reqIds.includes(idOf(i)))
const droppedFacts = research.facts.filter(f => !serves(f))
research.facts = research.facts.filter(serves)
const cited = new Set(research.facts.flatMap(f => f.requirements.map(idOf)))
const unresearched = research.requirements.filter(r => !cited.has(idOf(r)))
research.test_harness.filter(h => !reqIds.includes(idOf(h.requirement))).forEach(h => researchIssues.push(`test_harness entry for unknown requirement ${h.requirement}: dropped`))
reqIds.forEach(id => {
  const n = research.test_harness.filter(h => idOf(h.requirement) === id).length
  if (n !== 1) researchIssues.push(n ? `${n} test_harness entries for ${id}: kept the first` : `no test_harness entry for ${id}`)
})
research.test_harness = reqIds.map(id => research.test_harness.find(h => idOf(h.requirement) === id)).filter(Boolean)
// Research questions go to the result alone: what research could not settle is not passed on as knowledge.
const researchQuestions = (research.questions || []).filter(q => reqIds.includes(idOf(q.requirement)) || !researchIssues.push(`question for unknown requirement ${q.requirement}: dropped`))
delete research.questions
research.files = [...new Set(research.facts.filter(f => f.kind !== 'note').flatMap(f => [].concat(f.where).map(w => w.split(':')[0].trim())))]
// @part inputs
// Research's inputs.
INPUTS.research = ['TARGET', 'previous_notes', 'retry_note']
