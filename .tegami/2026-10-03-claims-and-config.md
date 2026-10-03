---
packages:
  pagegraph:
    type: minor
---

### Gate claims and inspect captured Markdown

**Breaking:** Rename `seo.config.ts` to `pagegraph.config.ts` (also `.js` and `.mjs`).
The CLI rejects the old filename with migration guidance. Keep CLI policies and the graph loader
in this file; configure site identity, robots, Markdown, and claims through the Vite plugin.
Remove top-level `origin`, `disallow`, `contentSignal`, and `directives` from the CLI config.
`tanstackStartGraph` supplies the plugin's site; a generic `viteGraphLoader` requires a `site`
option, and custom graph loaders return `site: { origin, indexable, robots }` with the graph.

Add `claims: { rules, model, cutoff?, context?, excludeHeads? }` to `pagegraph()` with probability
rules built against `claimsInput` from `pagegraph/claims`. Run `pagegraph claims check` to ask for
missing answers, review them, and commit `.pagegraph/decisions/claims/`. `--refresh` replaces answers;
`--dev <origin>` checks live captured documents. Builds and `pagegraph check` replay committed
answers without model calls and fail on missing answers or violations.

Use `pagegraph markdown show <path>` to print a twin and `pagegraph markdown find <text>` to search
pages and sections. `pagegraph markdown lock` writes `.pagegraph/markdown.lock.json`;
`--check` verifies it without writing.
