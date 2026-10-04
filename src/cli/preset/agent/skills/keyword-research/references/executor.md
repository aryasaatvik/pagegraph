# Executor Starters for Keyword Research

These snippets are starting points, not an inventory. Use `executor_search` before selecting calls, and inspect the returned TypeScript shapes.

Discover Google Search Console or Bing query/page performance, OpenSEO cached project context and
keyword research, provider keyword metrics, and live SERP results. Prefer a relevant cached OpenSEO
result when it already covers the requested market, language, device, and freshness. When a matching
OpenSEO project can be resolved unambiguously, its project context and research log are supporting
evidence; the consumer repository remains authoritative for product truth.

Use `executor_search` for each discovery query below; it returns the current tools and their
TypeScript input and result shapes:

- `Google Search Console performance query page`
- `OpenSEO project context cached keyword research`
- `keyword volume difficulty current SERP results`

Pass a TypeScript snippet to `executor_execute`, replacing `discovered_namespace`, `discovered_tool`, and
arguments with the returned names and required fields:

~~~ts
return await tools.discovered_namespace.discovered_tool({ siteUrl, startDate, endDate, dimensions: ["PAGE", "QUERY"] });
~~~

Treat Search Console and Bing as owned-site evidence, OpenSEO and DataForSEO as provider evidence,
and current result pages as observed evidence. Record market, language, device, reporting dates,
limits, task status, errors, and cost metadata when returned. Do not create or update an OpenSEO
project, save keywords, or perform another provider write.

Use `read_file`, `list_files`, and `search_text` for repository evidence. Finish the turn with
`submit_result` using the workflow result shape.
