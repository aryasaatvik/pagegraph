# Executor Starters for AI Search Analysis

These snippets are starting points, not an inventory. Search for current citation, brand-mention,
answer-engine, and owned-performance capabilities available through Executor.

Use `executor_search` for each discovery query below; it returns the current tools and their
TypeScript input and result shapes:

- `AI search citations answer visibility brand mentions`
- `Google Search Console generative AI performance page`

Pass a TypeScript snippet to `executor_execute`, replacing `discovered_namespace`, `discovered_tool`, and
arguments with the returned names and required fields:

~~~ts
return await tools.discovered_namespace.discovered_tool({
  domain,
  queries,
  market,
  language,
});
~~~

Record engine or surface, query, market, collection date, cited URL, response excerpt, sampling
method, task status, errors, and cost. Missing citations in a small sample do not prove absence.
Do not mutate provider projects or publish content.

Use `read_file`, `list_files`, and `search_text` for repository evidence. Finish the turn with
`submit_result` using the workflow result shape.

Keep `executor_execute` results small: project to only the fields and rows needed in the TypeScript
snippet. For example, use `rows.slice(0, 50).map(({ keyword, searchVolume, keywordDifficulty }) => ({
  keyword, searchVolume, keywordDifficulty,
}))`.
If PageGraph reports that a result was truncated, read the named JSON artifact with `read_file`.
Use `offset` and `maxBytes` to read large files in chunks.
