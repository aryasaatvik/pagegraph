# Executor Starters for Schema

These snippets are starting points, not an inventory. Discover owned search-appearance, URL
inspection, rich-result, or documentation tools when they can change the eligibility assessment.

Use `executor_search` for each discovery query below; it returns the current tools and their
TypeScript input and result shapes:

- `Google Search Console search appearance page`
- `URL inspection rich results structured data eligibility`

Pass a TypeScript snippet to `executor_execute`, replacing `discovered_namespace`, `discovered_tool`, and
arguments with the returned names and required fields:

~~~ts
return await tools.discovered_namespace.discovered_tool({
  siteUrl,
  startDate,
  endDate,
  dimensions: ["SEARCH_APPEARANCE", "PAGE"],
});
~~~

Treat visible page content and current primary requirements as eligibility authority. Record dates,
page filters, result types, task status, errors, and cost. Do not request indexing, submit schemas,
or update provider projects.

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
