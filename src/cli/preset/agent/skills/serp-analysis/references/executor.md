# Executor Starters for SERP Analysis

These snippets are starting points, not an inventory. Discover a current organic SERP capability
and resolve its exact signature before use.

Use `executor_search` for each discovery query below; it returns the current tools and their
TypeScript input and result shapes:

- `OpenSEO DataForSEO current organic SERP features intent`

Pass a TypeScript snippet to `executor_execute`, replacing `discovered_namespace`, `discovered_tool`, and
arguments with the returned names and required fields:

~~~ts
return await tools.discovered_namespace.discovered_tool({
  query,
  market,
  language,
  device,
  depth: 20,
});
~~~

Reuse a matching cached OpenSEO SERP when it satisfies the requested freshness. Record query,
market, language, device, collection time, depth, features, task status, errors, and cost. Fetch
individual result pages only when their content is material to the decision.

Use `read_file`, `list_files`, and `search_text` for repository evidence. Finish the turn with
`submit_result` using the workflow result shape.
