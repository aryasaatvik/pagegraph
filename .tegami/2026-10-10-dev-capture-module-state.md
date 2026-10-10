---
packages:
  pagegraph:
    type: patch
---

### Capture Markdown in dev when Vite pre-bundles dependencies

`pagegraph()` now keeps `pagegraph` and `pagegraph/react` out of dependency pre-bundling, next to
the runtime entries. A pre-bundled copy gave pages their own document context and `defineFacts`
registry, so every dev capture (`/__pagegraph/markdown.json`, `<page>.md`, `claims check --dev`)
failed with `recorded no <Section>` or `Unknown document fact`.
