---
packages:
  pagegraph:
    type: minor
---

### Build the graph inside a TanStack Start app with `pagegraph()`

`pagegraph/tanstack-start` adds a Vite plugin that builds the SEO graph in the app's own Vite
pipeline — aliases, `define`s, and content plugins such as Fumadocs apply — and ships it to the
server runtime as data. `robots.txt` and `sitemap.xml` are one line each:

```ts
// vite.config.ts
pagegraph({ origin, indexable, robots: { contentSignal }, collections: "src/lib/seo/collections.ts", routeConfig });

// src/routes/robots[.]txt.ts
import { robotsTxt } from "pagegraph/tanstack-start/server";
export const Route = createFileRoute("/robots.txt")({ server: { handlers: { GET: robotsTxt } } });
```

The plugin evaluates each route file that declares `staticData`, never the generated route tree, so
a route that imports server-only modules no longer needs a stub; an app-only route that cannot
evaluate in Node fails with its file name and goes in `exclude`. `routeConfig` takes the
`seoRouteConfig` options and adds the derived robots exclusions. `tanstackStartGraph({ root })`
gives `seo.config.ts` and `loadPageHeads` the same graph, and `contentCollection` maps any pages
with a `url` (Fumadocs `getPages()`) to a collection.

### Declare a page's head once

A static route declares its head in `staticData.seo.head` and renders it with `head: seo.head`; the
graph, `pageHeads`, and `pagegraph check` read the same title, description, and FAQs. A route's
`titleTemplate` (`"%s | Example Blog"`) applies to the title `seoHead` renders and to the route's
collection pages. `createSeo({ transformHead })` post-processes every rendered head.

### Fail loud when a runtime bundle imports build code

`pagegraph/config`, `pagegraph/vite`, `pagegraph/audit`, and `pagegraph/tanstack-start` resolve to a
stub under the `workerd`, `worker`, and `browser` export conditions that throws at import with the
entry's name, instead of crashing on a native binding when a request first runs. The README opens
with what runs where.

### Keep every workflow failure

Workflows drop `null` from model JSON before decoding, give the repair turn every schema issue at
once, and write `failure.json` with the stage, OpenCode session id, transcript, and cause chain for
every error after a run starts. The error message ends with the artifact path and a next step.

### Breaking changes

- `selectPageHeadNodes`, `pageHeads`, `PageHead`, and `PageHeadsOptions` are exported from
  `pagegraph`, not `pagegraph/config`. `loadPageHeads` stays in `pagegraph/config`.
- `pageHeads` reads `node.head` (a declared `staticData.seo.head`, or a collection page through its
  route's `titleTemplate`) instead of `node.instance`.
- `PageSeoInstance` is `SeoPageHead` and `FAQItem` is `SeoFaq`.
- `@tanstack/router-generator` is an optional peer: install it with `pagegraph/vite` or
  `pagegraph/tanstack-start`.
- `research-failure.json` is replaced by `failure.json`.
- `seo.config.ts` `disallow` is optional; with `tanstackStartGraph` the robots policy comes from the
  plugin and must not be repeated.

Migrating a TanStack Start app: replace the hand-written graph module and `viteGraphLoader` with
`pagegraph()` plus a collections module, move `seoRouteConfig` options to `routeConfig`, serve
robots and sitemap with `robotsTxt`/`sitemapXml`, move static heads into `staticData.seo.head` with
`head: seo.head`, and move hand-appended title suffixes into `titleTemplate`. The
[TanStack Start cookbook](https://github.com/aryasaatvik/pagegraph/blob/main/examples/tanstack-start/README.md)
has before/after snippets for each step.
