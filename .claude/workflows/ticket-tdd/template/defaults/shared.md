<!-- Text more than one block's defaults include, and the long-command rule of the code-writing preamble. README § Blocks. -->
<!-- @part bg -->
- A command that runs longer than a couple of minutes goes in the background (`run_in_background`) and is waited on by its completion notice: never a sleep or polling loop, never a second start of a check that is still running.
