# Executor Starters for Authority Research

These snippets are starting points, not an inventory. Discover backlink and live-page capabilities
before composing calls.

Use `executor_search` for each discovery query below; it returns the current tools and their
TypeScript input and result shapes:

- `OpenSEO DataForSEO backlink domain intersection`
- `web search fetch directory editorial partner eligibility`

Pass a TypeScript snippet to `executor_execute`, replacing `discovered_namespace`, `discovered_tool`, and
arguments with the returned names and required fields:

~~~ts
return await tools.discovered_namespace.discovered_tool({
  targets: [ownedDomain, ...competitors],
  excludeInternal: true,
  limit: 100,
});
~~~

Record source URL, target domain, dates, limits, authority metrics, task status, errors, and cost.
Provider metrics nominate prospects; current pages determine legitimacy. Do not discover personal
contact data, send outreach, submit listings, or mutate OpenSEO project state.

Use `read_file`, `list_files`, and `search_text` for repository evidence. Finish the turn with
`submit_result` using the workflow result shape.

Keep `executor_execute` results small: project to only the fields and rows needed in the TypeScript
snippet. For example, use `rows.slice(0, 50).map(({ keyword, searchVolume, keywordDifficulty }) => ({
  keyword, searchVolume, keywordDifficulty,
}))`.
If PageGraph reports that a result was truncated, read the named JSON artifact with `read_file`.
Use `offset` and `maxBytes` to read large files in chunks.
