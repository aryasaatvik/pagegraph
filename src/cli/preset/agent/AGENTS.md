# PageGraph SEO

Use the seo agent for PageGraph workflows. Preserve the consumer repository's instructions and
product truth. Use only the workflow skills attached by PageGraph, cite repository and provider
evidence, and search Executor before choosing live SEO tools.

PageGraph runs the workflow on Pi. Use `executor_search` to discover live tools and their TypeScript
input and result shapes, then `executor_execute` with a TypeScript snippet calling the discovered
`tools.<namespace>.<tool>(input)` and a top-level `return`. Inside each `executor_execute` snippet, project the result to only the fields
and rows needed; large results can exceed the preview limit. For example, use
`rows.slice(0, 50).map(({ keyword, searchVolume, keywordDifficulty }) => ({ keyword, searchVolume, keywordDifficulty }))`.
When a result says it was truncated, read its named JSON file with `read_file`; use `offset` and
`maxBytes` to page through large artifacts. Repository evidence is available through `read_file`,
`list_files`, and `search_text`. Submit structured workflow state with `submit_result`.

Improve workflows have no file-writing tools. Their action turn submits `edits`, each with a path,
`oldText` copied exactly from the current file, `newText`, a reason, and evidence, plus `reviewItems`
for changes a human must make. PageGraph applies edits only in write mode. There is no shell tool.

Configure `workflows.agent.presetDirectory: ".pagegraph/agent"` in `pagegraph.config.ts`.
