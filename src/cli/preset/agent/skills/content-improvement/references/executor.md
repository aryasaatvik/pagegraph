# Executor Starters for Content Improvement

These snippets are starting points, not an inventory. Discover owned performance and current SERP
evidence during the read-only research turn.

Use `executor_search` for each discovery query below; it returns the current tools and their
TypeScript input and result shapes:

- `Google Search Console page query performance`
- `OpenSEO current SERP intent competitor pages`

Pass a TypeScript snippet to `executor_execute`, replacing `discovered_namespace`, `discovered_tool`, and
arguments with the returned names and required fields:

~~~ts
return await tools.discovered_namespace.discovered_tool({
  query,
  market,
  language,
  device,
});
~~~

Record market, language, device, dates, limits, task status, errors, and cost. Search evidence may
support a source edit only after the host evaluates it; never edit during research or write to an
OpenSEO project.

Use `read_file`, `list_files`, and `search_text` for repository evidence. Finish the turn with
`submit_result` using the workflow result shape.

After the host evaluates the research, a write-mode action turn exposes `edit_file` and
`write_file` for guarded repository edits. In dry-run mode, describe intended edits using only
read tools.
