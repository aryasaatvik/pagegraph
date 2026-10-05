# Executor Starters for Internal Linking

These snippets are starting points, not an inventory. PageGraph's graph is primary; discover owned
query/page or crawl evidence only when it resolves ownership or discoverability.

Use `executor_search` for each discovery query below; it returns the current tools and their
TypeScript input and result shapes:

- `Google Search Console query page internal ownership`
- `Bing Webmaster crawl links URL information`

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

Record dates, page and query filters, crawl state, task status, errors, and cost. Search performance
can support a graph recommendation but does not override the source content. Do not submit URLs,
request indexing, or mutate provider projects.

Use `read_file`, `list_files`, and `search_text` for repository evidence. Finish the turn with
`submit_result` using the workflow result shape.

After the host evaluates the research, the action turn submits structured `edits` (path, exact
`oldText`, `newText`, reason, evidence) and `reviewItems` through `submit_result`. There are no
file-writing tools: PageGraph validates each edit against the current file and records it in the
run's `edits.json` and `review.md`, then applies it only in write mode.

Use `fetch_page` to read sentences from served pages on origins in the suggestion report.

Keep `executor_execute` results small: project to only the fields and rows needed in the TypeScript
snippet. For example, use `rows.slice(0, 50).map(({ keyword, searchVolume, keywordDifficulty }) => ({
  keyword, searchVolume, keywordDifficulty,
}))`.
If PageGraph reports that a result was truncated, read the named JSON artifact with `read_file`.
Use `offset` and `maxBytes` to read large files in chunks.
