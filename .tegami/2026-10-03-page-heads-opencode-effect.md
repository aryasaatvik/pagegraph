---
packages:
  pagegraph:
    type: minor
---

### Load page heads from `pagegraph/config`

Graph loaders created by `viteGraphLoader` accept an input that is passed to the entry export.
`pagegraph/config` exports `selectPageHeadNodes`, `pageHeads`, and `loadPageHeads`, which return
`{ path, title, description }` for indexable pages, honor caller excludes, fail with the page path
when a selected page lacks a title or description, and dispose the loader for the caller.

### Run the OpenCode host from an isolated install

`improve` and `research` workflows load the pinned OpenCode host from their own verified Bun
install, so a consumer's Effect or Drizzle overrides no longer change its runtime. Failures keep the
HTTP operation, status, and body, research keeps its transcript, and a discovery-only run gets one
recovery turn.

### Require stable Effect 4

The Effect peer dependencies are `^4.0.0`.
