<!-- Block research: its default instructions, and the research section every later block's defaults include. -->
<!-- @part research -->
STAGE: research. Read {{TARGET}}, its parent spec and the sections it names, sibling tickets, the documents they cite, and the code and tests the ticket touches. Collect the knowledge of the code that must be known BEFORE writing it: helpers and seams to reuse, every call site and reader affected, and the traps that apply. Every fact is shown by lines of code, a repository document or a read-only search of the repository. The baseline and the gates step own the environment and the checks' results: report neither in facts nor in plan.
<!-- @part section -->
RESEARCH:
{{research}}

Start from the change-site facts above: read only the lines you change or verify, and search only for what they do not cover.
