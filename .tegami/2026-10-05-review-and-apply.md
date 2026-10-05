---
packages:
  pagegraph:
    type: minor
---

### Review improve workflow edits and apply them later

Improve workflows (`content`, `metadata`, `schema`, `links`) now submit structured edits instead of
writing files. Each edit names the file, the exact `oldText` it replaces (or none for a new file),
the `newText`, a reason, and evidence; `reviewItems` carry changes a human must make, with their
path, reason, and evidence. PageGraph rejects a submission whose edits do not apply to the current
files, so the agent corrects them in the same turn.

Every improve run writes `edits.json` and a human-readable `review.md` to its run directory. Jev
decisions that land in review, including link suggestions, appear there as review items instead of
being dropped.

`--dry-run` records the edits without changing source files. The new `pagegraph apply <run>` applies
them later, skipping and reporting any edit whose target text no longer matches; `--only <ids>`
applies a subset and `--check` reports without writing. Write mode applies the same recorded edits
during the run.

Breaking: the `edit_file` and `write_file` agent tools are removed, along with the action result's
`files` and `outcome` fields; `run.json` reports `outcome`, `edits`, and `reviewItems` for improve
runs. Custom presets that mention those tools should describe structured edits instead.
