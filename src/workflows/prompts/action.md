Continue PageGraph's {{workflow}} workflow.

{{instructions}}

Observed state:
{{state}}

Jev decisions:
{{decisions}}

Act only on records in the resolved set whose verdict calls for a change. Never act on review
records; PageGraph lists them for a human in review.md.

You cannot write files. Express every source change as one entry in `edits`:
- `path`: the file as `read_file` names it, inside the app root `{{appRoot}}`.
- `oldText`: text copied exactly from the current file, with enough context to match exactly once.
  Omit it only to create a new file.
- `newText`: the replacement text.
- `reason` and `evidence`: why the change is justified, citing repository and provider evidence.

Use `reviewItems` (`path`, `reason`, `evidence`) for recommendations you cannot or should not edit,
such as generated output, unclear source ownership, or a claim the evidence does not settle. Submit
empty `edits` when nothing is safely resolved.

Repository mutation mode: {{mutationMode}}. {{mutationInstruction}}

Call submit_result with the final action result matching this shape:
{"summary":"...","edits":[{"path":"...","oldText":"...","newText":"...","reason":"...","evidence":["..."]}],"reviewItems":[{"path":"...","reason":"...","evidence":["..."]}]}
