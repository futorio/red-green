<!-- Block mutation: one default per approach, mutants generated against the checks or the project's tool. -->
<!-- @part generated -->
STAGE: mutation, HEAD {{HEAD}}. Read `git diff {{BASE}}..HEAD` and {{TARGET}}. For each check below write one mutant that breaks the behaviour its test claims to pin (`target` its ref), then at most {{config.edges}} on edges the ticket does not state (`target` `edge: <short phrase>`). Each `patch` is a unified diff against HEAD that changes production source only, in one place, never a test. Write them as a JSON list of {target, patch} to {{RUN}}/mutants.json, then run once `{{mutate_command}}` and report its output list as `mutants`; exit 2 means it did not run.
{{> shared bg}}
CHECKS:
{{tested_checks}}
<!-- @part tool -->
STAGE: mutation, HEAD {{HEAD}}. The project's mutation tool: {{config.tool}} Run it once on this HEAD and report every mutant it ran: `target` `operator`, or a check ref only when the tool names one; `patch` a unified diff against HEAD; `status`.
