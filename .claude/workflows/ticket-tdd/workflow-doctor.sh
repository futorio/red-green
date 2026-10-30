#!/usr/bin/env bash
set -u

HELP='workflow-doctor.sh — checks what the ticket-tdd workflow itself needs on this machine.

Usage: workflow-doctor.sh [--help]
Exit 0: every checkable dependency is present. Exit 1: something is missing.

Checked here:
  claude     Claude Code CLI.
  git        the run works in a worktree of its own and commits there.
  No plugin is used.

Not checkable from a shell — confirm by hand:
  Workflow tool   gated per account; the project profile runs the core by scriptPath.
  models          stages ask for opus, sonnet and haiku; profile.blocks.<name>.model changes them.'

[[ "${1:-}" == "--help" || "${1:-}" == "-h" ]] && { printf '%s\n' "$HELP"; exit 0; }

bad=0

ok() { printf 'ok       %-42s %s\n' "$1" "$2"; }
miss() { printf 'MISSING  %-42s %s\n' "$1" "$2"; bad=1; }

for tool in claude git; do
	if command -v "$tool" >/dev/null 2>&1; then
		ok "$tool" "$("$tool" --version 2>&1 | head -1)"
	else
		miss "$tool" "not on PATH"
	fi
done

exit $bad
