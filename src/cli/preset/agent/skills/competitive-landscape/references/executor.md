# Executor Starters for a Competitive Landscape

These snippets are starting points, not an inventory. Discover current tools and call the discovered tools
with arguments matching their TypeScript shapes.

Use `executor_search` for each discovery query below; it returns the current tools and their
TypeScript input and result shapes:

- `OpenSEO SERP competitors recurring domains`
- `domain overview ranked keywords backlink authority`

Pass a TypeScript snippet to `executor_execute`, replacing `discovered_namespace`, `discovered_tool`, and
arguments with the returned names and required fields:

~~~ts
return await tools.discovered_namespace.discovered_tool({
  queries,
  market,
  language,
  device,
});
~~~

Prefer relevant cached OpenSEO context or research when an existing project matches the domain
unambiguously. Use external traffic and keyword values as estimates. Record query, market, device,
date, result depth, task status, errors, and cost. Do not update project context or competitors.

Use `read_file`, `list_files`, and `search_text` for repository evidence. Finish the turn with
`submit_result` using the workflow result shape.
