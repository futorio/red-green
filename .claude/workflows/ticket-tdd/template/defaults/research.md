<!-- Block research: its default instructions, the retry's note, and the research section every later block's defaults include. -->
<!-- @part research -->
STAGE: research.{{retry_note}} Read {{TARGET}}, its parent spec and the sections it names, sibling tickets, the documents they cite, and the code and tests the ticket touches. Collect the knowledge of the code that must be known BEFORE writing it: helpers and seams to reuse, every call site and reader affected, and the traps that apply. Every fact is shown by lines of code, a repository document or a read-only search of the repository. The baseline and the gates step own the environment and the checks' results: report neither in facts nor in plan.
<!-- @part retry_note -->
 A previous answer at this stage failed the core's checks: {{previous_notes}}. Answer again in full with each of them fixed; a plan step over its limit keeps its action and moves the details to the facts.
<!-- @part section -->
RESEARCH:
{{research}}

Start from the change-site facts above: read only the lines you change or verify, and search only for what they do not cover.
