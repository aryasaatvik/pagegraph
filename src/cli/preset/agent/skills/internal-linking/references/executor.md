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

After the host evaluates the research, a write-mode action turn exposes `edit_file` and
`write_file` for guarded repository edits. In dry-run mode, describe intended edits using only
read tools.

Use `fetch_page` to read sentences from served pages on origins in the suggestion report.
