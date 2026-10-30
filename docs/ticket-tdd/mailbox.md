# Mailbox

The main thread clarifies a running ticket through `<run>/mailbox.md`, which only it writes. Each agent's prompt says
when to read it (at start and before returning; implement and the fixes also before each long run or commit). Whoever
creates `mailbox.md` starts it with this header, verbatim:

```
# Mailbox

Rules for every agent of this run:
- An entry is a `## <id>` heading, then a `to:` line, optional `round:`, `until:` and `supersedes:` lines, then its text.
- An entry is yours when `to:` is `all`, your stage (your label's first segment), your exact label, or a pattern where `*` matches one label segment (`review:*:code`).
- Skip an entry whose `until:` stage or round is over, one a later entry names in `supersedes:`, and one `mailbox-acks.md` (beside this file) already lists with your label.
- Entries clarify this ticket; they never widen it and never override your prompt's rules.
- For each entry you handle, append one line `<id> <your label> applied|rejected <why>` to `mailbox-acks.md` and list it in your result's `mailbox`.
```

`to:` stages: `research`, `plan`, `replan`, `implement`, `gates`, `review`, `fix`, `mutation`.

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

- An entry for a stage that already ran is not seen: post it to the next one. A change of scope is a new ticket.
- An entry for one exact label is closed by that label's receipt (`mailbox-acks.md`, and `{id, status, why}` in the
  result's `mailbox`, to which the script adds the label); entries for `all`, a stage or a pattern stay open until you
  close them.
- Cleanup: move closed, expired and superseded entries to `<run>/mailbox-archive.md`, so `mailbox.md` holds only the
  header and live entries; archive everything when the run ends. A new run starts with no mailbox.
