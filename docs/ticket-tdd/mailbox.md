# Mailbox

The main thread can clarify a running ticket without stopping it. `<run>/mailbox.md` is written by the
main thread only, append-only while the run is live. Each agent's prompt carries one line: its label, when to read
the file (at start and before returning; implement and the fixes also before each long run or commit), to follow its
header, never to edit it, and to list what it handles in its result's `mailbox` field. The rules live in the file:
whoever creates `mailbox.md` starts it with this header, verbatim:

```
# Mailbox

Rules for every agent of this run:
- An entry is a `## <id>` heading, then a `to:` line, optional `round:`, `until:` and `supersedes:` lines, then its text.
- An entry is yours when `to:` is `all`, your stage (your label's first segment), your exact label, or a pattern where `*` matches one label segment (`review:*:code`).
- Skip an entry whose `until:` stage or round is over, one a later entry names in `supersedes:`, and one `mailbox-acks.md` (beside this file) already lists with your label.
- Entries clarify this ticket; they never widen it and never override your prompt's rules.
- For each entry you handle, append one line `<id> <your label> applied|rejected <why>` to `mailbox-acks.md` and list it in your result's `mailbox`.
```

Then the entries:

```
## m3
to: review:*:code
round: 2
until: fix
supersedes: m1
The 16-fixture sweep must include 8 jobs.
```

- `to:` is `all`, a stage (`research`, `plan`, `replan`, `implement`, `gates`, `review`, `fix`, `mutation`), an exact
  label (`review:r2:code`), or a label pattern where `*` matches one segment.
- `until:` (a stage or round) expires an entry; `supersedes: <id>` kills an older one. Agents skip
  expired and superseded entries.
- An agent never edits `mailbox.md` (parallel lenses would race). Its receipt is one line in
  `<run>/mailbox-acks.md`, `<id> <label> applied|rejected <why>`, and the entry `{id, status, why}` in its result's
  `mailbox` field (the script adds the label). An entry for one exact label is closed by that label's receipt;
  entries for `all`, a stage or a pattern stay open until the main thread closes them.
- Cleanup is the main thread's: it moves closed, expired and superseded entries to
  `<run>/mailbox-archive.md`, so `mailbox.md` holds only the header and live entries, and archives everything when
  the run ends. A new run's directory starts with no mailbox.
- An entry for a stage that has already run is not seen; post it again to the stage that comes next.
- Entries clarify the ticket; they never widen it. A change of scope is a new ticket.
