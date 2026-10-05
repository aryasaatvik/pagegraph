# Executor Starters for Site Architecture

These snippets are starting points, not an inventory. Discover owned page/query, crawl, sitemap,
and URL evidence only when the deterministic graph does not answer the question.

Use `executor_search` for each discovery query below; it returns the current tools and their
TypeScript input and result shapes:

- `Search Console page performance`
- `Bing Webmaster crawl`

Inspect a selected tool's TypeScript shape with `executor_search` before executing it.

Pass a TypeScript snippet to `executor_execute`, replacing `discovered_namespace`, `discovered_tool`, and
arguments with the returned names and required fields:

~~~ts
return await tools.discovered_namespace.discovered_tool(input);
~~~

In a later turn, call that discovered tool with the required fields from its returned signature. Property,
project, URL, date, and dimension arguments differ between integrations. Do not copy guessed fields
from a recipe. Prefer page/query performance for demand and ownership questions; use URL inspection
when the question actually concerns crawl, canonical, or indexing state.

Keep submitted, crawled, indexed, ranking, and clicked evidence distinct. Record reporting dates,
filters, canonical state, task status, errors, and cost. Do not request indexing, submit sitemaps,
or update provider projects.

Use `read_file`, `list_files`, and `search_text` for repository evidence. Finish the turn with
`submit_result` using the workflow result shape.

Keep `executor_execute` results small: project to only the fields and rows needed in the TypeScript
snippet. For example, use `rows.slice(0, 50).map(({ keyword, searchVolume, keywordDifficulty }) => ({
  keyword, searchVolume, keywordDifficulty,
}))`.
If PageGraph reports that a result was truncated, read the named JSON artifact with `read_file`.
Use `offset` and `maxBytes` to read large files in chunks.
