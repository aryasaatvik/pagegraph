---
packages:
  pagegraph:
    type: patch
---

### Show Executor tool types for every search hit

`executor_search` with details no longer fails when a hit is an MCP-backed tool whose schema has no
TypeScript definitions. A hit whose schema cannot be loaded keeps its search result and reports
`types unavailable: <reason>`, while the other hits still return their input and result types.
