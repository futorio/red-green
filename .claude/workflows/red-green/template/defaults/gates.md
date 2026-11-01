<!-- Block gates: the gates step's default instructions. -->
<!-- @part run -->
STAGE: gates, HEAD {{HEAD}}.
From {{REPO}}, run this in the foreground with a Bash timeout of 600000 ms (10 minutes):
{{gate_command}}
It prints one JSON row per gate.
Exit 0: the report is complete, whatever the gates did; return its rows.
Exit 2: it could not run; a `not_run` row per gate, `line` its stderr.
Exit 3: gates are still running and survive the call; run the same command again, at most 6 calls in all. Still exit 3 after the 6th: a `not_run` row per gate, `line` saying it did not finish.
Do not end your turn before one of these; judge no gate and read no log.
