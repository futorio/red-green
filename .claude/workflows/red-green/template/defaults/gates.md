<!-- Block gates: the discovery step's and the gates step's default instructions. -->
<!-- @part discover -->
STAGE: gates discovery.
Where: the repo's agent instructions, then CI config, then the task runner; the first source that names gates wins. A gate: a command CI or those instructions require before a commit; runs with no human, network or secrets; pass/fail by exit code; writes nothing to the tree. A fast gate: a static check that reads the source without building it (lint, format check, typecheck); a build or a test suite is slow.
Run each gate exactly as its `command` reads, once, to completion; one that cannot run that way here is a question, not a gate.
{{> shared bg}}
<!-- @part run -->
STAGE: gates, HEAD {{HEAD}}.
Run each gate below from {{REPO}} to completion and compare it with its baseline.
GATES:
{{gate_list}}
{{> shared bg}}
