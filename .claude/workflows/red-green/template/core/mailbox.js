// The mailbox and ask(): every agent call goes through ask(), which adds the mailbox note and output field and keeps
// what each agent handled. docs/red-green/mailbox.md. It reads RUN and agent.
// @part ask

// Mailbox: the main thread posts mid-run clarifications to <run>/mailbox.md, under a header of rules it writes; see
// docs/red-green/mailbox.md.
const MAIL = { type: 'array', items: { type: 'object', properties: {
  id: { type: 'string' }, status: { type: 'string', enum: ['applied', 'rejected'] }, why: { type: 'string' } },
  required: ['id', 'status', 'why'] } }
const mailNote = label => `

MAILBOX: you are \`${label}\`. If ${RUN}/mailbox.md exists, read it at start${/^(implement|fix)(:|$)/.test(label) ? ', before each long run or commit' : ''} and before returning, and follow its header; never edit it. List what you handle in \`mailbox\`.`
const mailbox = []
// values: the call's, riding along as a property the options do not enumerate; the conformance check's stubs answer
// from them.
async function ask(prompt, opts, values) {
  const s = opts.schema
  const o = Object.assign({}, opts, s && { schema: Object.assign({}, s, { properties: Object.assign({}, s.properties, { mailbox: MAIL }) }) })
  const res = await agent(prompt + mailNote(opts.label), Object.defineProperty(o, 'values', { value: values }))
  if (res && res.mailbox) mailbox.push(...res.mailbox.map(m => Object.assign({ label: opts.label }, m)))
  return res
}
