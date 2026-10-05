# Executor Starters for Metadata Improvement

These snippets are starting points, not an inventory. Discover owned query/page evidence and a
current SERP before selecting a candidate.

Use `executor_search` for each discovery query below; it returns the current tools and their
TypeScript input and result shapes:

- `Google Search Console query page CTR position`
- `current SERP titles snippets intent`

Pass a TypeScript snippet to `executor_execute`, replacing `discovered_namespace`, `discovered_tool`, and
arguments with the returned names and required fields:

~~~ts
return await tools.discovered_namespace.discovered_tool({
  siteUrl,
  startDate,
  endDate,
  dimensions: ["PAGE", "QUERY"],
});
~~~

Record dates, query and page filters, market, device, task status, errors, and cost. CTR and position
describe observed performance; they do not prove a particular title caused it. Do not mutate
provider metadata or request recrawls.

Use `read_file`, `list_files`, and `search_text` for repository evidence. Finish the turn with
`submit_result` using the workflow result shape.

After the host evaluates the research, a write-mode action turn exposes `edit_file` and
`write_file` for guarded repository edits. In dry-run mode, describe intended edits using only
read tools.

Keep `executor_execute` results small: project to only the fields and rows needed in the TypeScript
snippet. For example, use `rows.slice(0, 50).map(({ keyword, searchVolume, keywordDifficulty }) => ({
  keyword, searchVolume, keywordDifficulty,
}))`.
If PageGraph reports that a result was truncated, read the named JSON artifact with `read_file`.
Use `offset` and `maxBytes` to read large files in chunks.
