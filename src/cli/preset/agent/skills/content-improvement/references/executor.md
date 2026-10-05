# Executor Starters for Content Improvement

These snippets are starting points, not an inventory. Discover owned performance and current SERP
evidence during the read-only research turn.

Use `executor_search` for each discovery query below; it returns the current tools and their
TypeScript input and result shapes:

- `Google Search Console page query performance`
- `OpenSEO current SERP intent competitor pages`

Pass a TypeScript snippet to `executor_execute`, replacing `discovered_namespace`, `discovered_tool`, and
arguments with the returned names and required fields:

~~~ts
return await tools.discovered_namespace.discovered_tool({
  query,
  market,
  language,
  device,
});
~~~

Record market, language, device, dates, limits, task status, errors, and cost. Search evidence may
support a source edit only after the host evaluates it; never edit during research or write to an
OpenSEO project.

Use `read_file`, `list_files`, and `search_text` for repository evidence. Finish the turn with
`submit_result` using the workflow result shape.

After the host evaluates the research, the action turn submits structured `edits` (path, exact
`oldText`, `newText`, reason, evidence) and `reviewItems` through `submit_result`. There are no
file-writing tools: PageGraph validates each edit against the current file and records it in the
run's `edits.json` and `review.md`, then applies it only in write mode.

Keep `executor_execute` results small: project to only the fields and rows needed in the TypeScript
snippet. For example, use `rows.slice(0, 50).map(({ keyword, searchVolume, keywordDifficulty }) => ({
  keyword, searchVolume, keywordDifficulty,
}))`.
If PageGraph reports that a result was truncated, read the named JSON artifact with `read_file`.
Use `offset` and `maxBytes` to read large files in chunks.
