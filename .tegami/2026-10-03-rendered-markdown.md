---
packages:
  pagegraph:
    type: minor
---

### Capture rendered Markdown through TanStack Start

Declare `staticData.markdown: "rendered"` to publish Markdown twins from authored React pages,
with optional `staticData.llms` groups. Collection instances inherit their route's declarations.
The `pagegraph()` plugin accepts a canonical Markdown origin and a facts module, and exposes
`prerenderPages` for Start. The non-deployed `pagegraph/tanstack-start/prerender-worker` captures
pages through the compiled Start server and writes public twins plus private documents and heads.

Use `markdownRequest` from `pagegraph/tanstack-start/markdown` before the Start handler for dev
and prerender capture. Private paths return 404 in production. `pagegraph/tanstack-start/react`
exports a capture-aware `Link`; `llmsTxt` and `llmsSection` on the server entry compose graph-derived
links without rendering pages. Development rendering catches missing route opt-ins.
