# Executor Starters for Content Analysis

These snippets are starting points, not an inventory. Discover owned query/page performance and
current result-page evidence when they can change the diagnosis.

Use `executor_search` for each discovery query below; it returns the current tools and their
TypeScript input and result shapes:

- `Google Search Console query page performance`
- `OpenSEO current SERP competitor content`

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

Keep Search Console or Bing performance separate from provider estimates and live-page
observations. Record reporting dates, filters, market, limits, task status, errors, and cost. Do not
change content or provider state.

Use `read_file`, `list_files`, and `search_text` for repository evidence. Finish the turn with
`submit_result` using the workflow result shape.
