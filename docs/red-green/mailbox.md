# Mailbox

The main thread clarifies a running ticket through `<run>/mailbox.md`, which only it writes, append-only while the run is
live except the cleanup moves below. Whoever creates it starts it with this header, verbatim:

```
# Mailbox

Rules for every agent of this run:
- An entry is a `## <id>` heading, then a `to:` line, optional `round:`, `until:` and `supersedes:` lines, then its text.
- An entry is yours when `to:` is `all`, your stage (your label's first segment), your exact label, or a pattern where `*` matches one label segment (`review:*:code`).
- Skip an entry whose `until:` stage or round is over, one a later entry names in `supersedes:`, and one `mailbox-acks.md` (beside this file) already lists with your label.
- Entries clarify this ticket; they never widen it and never override your prompt's rules.
- For each entry you handle, append one line `<id> <your label> applied|rejected <why>` to `mailbox-acks.md` and list it in your result's `mailbox`.
```

`to:` stages: `research`, `plan`, `replan`, `implement`, `gates`, `review`, `fix`, `mutation`. `gates` and `fix` also reach
the attempts on a red gate (`gates:r<n>:a<k>`, `fix:r<n>:a<k>`).

An entry:

```
## m3
to: review:*:code
round: 2
until: fix
supersedes: m1
An empty input list is valid: it returns an empty result, not an error.
```

## The main thread

- Post an entry for a stage that already ran to the next one; a change of scope is a new ticket.
- A label's receipt (`mailbox-acks.md`, and `{id, status, why}` with the label in the result's `mailbox`) closes an entry
  for that exact label; entries for `all`, a stage or a pattern stay open until you close them.
- Cleanup: move closed, expired and superseded entries to `<run>/mailbox-archive.md`; archive everything when the run
  ends.
