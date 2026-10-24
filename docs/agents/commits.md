# Commit messages

Adapted from [Baneeishaque/ai-agent-rules](https://github.com/Baneeishaque/ai-agent-rules/blob/master/git-commit-message-rules.md),
without its Conventional Commits prefix and submodule sections.

## Format

- Plain text only. No markdown: no bold, italics or backticks.
- Standard punctuation is fine: `-`, `:`, `()`, `[]`.

## Title line

- One strong, concise summary of the whole change.
- Include critical context (a date, a release) when the change depends on it.
- Ideally under 50 characters; hard limit 72.
- Imperative mood: "Add feature", not "Added feature" or "Adds feature".
- No period at the end.
- Refer to doc sections by title, not by number.

## Body

- A blank line separates it from the title.
- Bullet points (`-`) only, no paragraphs. Wrap at 72 characters.
- What changed and why, and the impact of the change.
- Never repeat the title; supplementary details only.
- Summarise repetitive changes at a higher level instead of listing each
  one.
- A self-explanatory title (a style cleanup, a simple deletion) may have
  no body at all. No filler.
- The `Co-Authored-By:` trailer, when present, is the last line, after a
  blank line.

## Binary and opaque files

- Inspect what actually changed before describing it.
- Name a critical added or modified file in the body.
- State any encoding change explicitly.
- For dependency files, name the key package changes.

## Amending

An amended commit's message describes the commit as it now stands, the
union of the original and the amend, not the amend's delta. Rewrite the
whole message.
