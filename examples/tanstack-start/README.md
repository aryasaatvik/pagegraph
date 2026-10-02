# TanStack Start cookbook

This is a drop-in wiring example for a TanStack Start app. The package has no opinion about your
router layout or content source. Each route declares its SEO policy and head once in
`staticData.seo`; the `pagegraph()` Vite plugin builds one graph from those declarations, and that
graph feeds rendered head tags, `robots.txt`, `sitemap.xml`, the CLI, and CI.

Install `@tanstack/router-generator` alongside `pagegraph`: `pagegraph/tanstack-start` and
`pagegraph/vite` need it as an optional peer to parse the route files.

## 1. Bind site identity once

Create `src/lib/seo.ts`. Route modules only provide page content; they do not repeat the origin,
organization, or JSON-LD identity. Augmenting `Register` types `related` and `redirectTo` against
your real route tree.

```ts
import { createSeo, defineJsonLd, jsonLdRef } from "pagegraph/react";

import type { FileRouteTypes } from "../routeTree.gen";

declare module "pagegraph" {
  interface Register {
    paths: FileRouteTypes["fullPaths"];
    kinds: "page" | "article" | "hub";
  }
}

const site = createSeo({
  origin: "https://example.com",
  site: {
    name: "Example",
    logo: "/logo.png",
    publisherLogo: "/publisher.png",
    defaultImage: "/og.png",
    defaultAuthor: { name: "Example Team" },
  },
  organization: {
    legalName: "Example, Inc.",
    description: "A concise description of the company.",
    sameAs: ["https://github.com/example"],
    contactPoint: { contactType: "support", email: "support@example.com" },
  },
  website: { searchPath: "/search?q={search_term_string}" },
  jsonLd: {
    site: (ids) => [
      defineJsonLd({
        "@type": "SoftwareApplication",
        "@id": "https://example.com/#product",
        name: "Example",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Web",
        provider: jsonLdRef(ids.organization),
      }),
    ],
  },
});

export const seo = site; // seo.head for static routes
export const { seoHead } = site;
```

`kinds` is your own taxonomy; nothing branches on it.

## 2. Declare static routes

`staticData.seo` holds the crawl policy and the head together. `seo.head` renders the declaration into
`meta` and canonical `links`: title, description, social cards, robots, a BreadcrumbList, and the
JSON-LD the head warrants (`faqs`, `article`, `service`, `itemList`, `jsonLd`).

```tsx
import { createFileRoute } from "@tanstack/react-router";

import { seo } from "../../lib/seo";

export const Route = createFileRoute("/(marketing)/pricing")({
  staticData: {
    seo: {
      kind: "page",
      crumb: "Pricing",
      sitemap: { priority: 0.9, changeFrequency: "weekly" },
      related: ["/docs"],
      link: { title: "Pricing", description: "Simple volume pricing." },
      modifiedAt: "2026-09-29", // sitemap <lastmod> and the freshness report
      head: {
        title: "Pricing | Example",
        description: "Simple volume pricing.",
        faqs: [{ question: "Is there a free plan?", answer: "Yes." }],
      },
    },
  },
  head: seo.head,
  component: PricingPage,
});

function PricingPage() {
  return <main><h1>Pricing</h1></main>;
}
```

Write `staticData` as an object literal and `head: seo.head`: the coverage gate reads both keys
statically, and a helper call or an `AnyRouteMatch`-typed arrow in route options would make TanStack
infer `any` search and loader types across the route tree. A route that appears in another page's `related` also needs a `link` card.

For custom schema, pass a `jsonLd` array of `defineJsonLd(...)` documents in `head`.

## 3. Declare dynamic routes

A param route renders from `loaderData`, so it keeps its own `head()` and calls `seoHead`. Its
`titleTemplate` (`%s` is the page title) is applied by `seoHead` and by the graph to the route's
collection pages, so the suffix lives in one place.

```tsx
import { createFileRoute } from "@tanstack/react-router";

import { seoHead } from "../../../lib/seo";

export const Route = createFileRoute("/(marketing)/blog/$slug")({
  staticData: {
    seo: {
      kind: "article",
      titleTemplate: "%s | Example Blog",
      sitemap: { priority: 0.7, changeFrequency: "weekly" },
    },
  },
  head: (ctx) =>
    ctx.loaderData
      ? seoHead(ctx, { title: ctx.loaderData.title, description: ctx.loaderData.description })
      : {},
});
```

## 4. List content pages as collections

The param route never enters the sitemap itself; its pages come from a collections module.
`contentCollection` accepts any pages with a `url`, including Fumadocs `loader().getPages()`
directly, and turns each entry's `related` into graph edges. Instances inherit the param route's
`kind`, `sitemap`, and `titleTemplate`.

```ts
// src/lib/seo/collections.ts
import { contentCollection } from "pagegraph";

import { blogSource } from "../blog-source"; // e.g. a Fumadocs loader()

export const collections = () => [
  contentCollection({
    route: "/blog/$slug",
    source: "blog",
    pages: blogSource.getPages(),
    entry: (page) => ({
      title: page.data.title,
      description: page.data.description,
      publishedAt: page.data.date,
      related: page.data.related,
    }),
  }),
];
```

## 5. Register the plugin

`pagegraph()` builds the graph inside the app's Vite pipeline, so path aliases, `define`s, and
content plugins apply with no stubs, and ships it to the server runtime as data.

```ts
// vite.config.ts
import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { pagegraph } from "pagegraph/tanstack-start";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tanstackStart(),
    pagegraph({
      origin: "https://example.com",
      indexable: process.env.DEPLOY_ENV === "production", // previews disallow everything
      robots: { contentSignal: "search=yes, ai-input=yes, ai-train=yes" },
      collections: "src/lib/seo/collections.ts",
      exclude: ["app-only.tsx"],
      routeConfig: {
        outputPath: fileURLToPath(new URL("./src/lib/route-config.ts", import.meta.url)),
        publicGroups: ["(marketing)", "(docs)"],
        enforceCoverageIn: ["(marketing)", "(docs)"],
        alwaysDisallow: ["/dashboard", "/api"],
      },
    }),
  ],
});
```

- The plugin evaluates every route file that declares `staticData`, never `routeTree.gen.ts`, in a
  Node environment named `pagegraph`. A route that imports a server-runtime-only module
  (`cloudflare:workers`) fails with its file name; add an app surface that is not a public page to
  `exclude` (route-file globs relative to the routes directory).
- `routeConfig` is the coverage gate: dev and `vite build` fail when a page in an enforced group has
  neither `staticData` nor `head`. Its `robotsExclusions` join `robots.disallow`.
- `indexable: false` serves a disallow-all `robots.txt` with no `Sitemap` line.

## 6. Serve robots.txt and sitemap.xml

Both are routes because their output depends on the deployment's origin and indexability. Each is
one line over the graph the plugin ships:

```ts
// src/routes/robots[.]txt.ts — sitemap[.]xml.ts is the same with sitemapXml
import { createFileRoute } from "@tanstack/react-router";
import { robotsTxt } from "pagegraph/tanstack-start/server";

export const Route = createFileRoute("/robots.txt")({ server: { handlers: { GET: robotsTxt } } });
```

`pagegraph/tanstack-start/server` also exports `seoGraph()` and `seoSite()` for other server code.
Do not import `pagegraph/tanstack-start`, `pagegraph/config`, `pagegraph/vite`, or `pagegraph/audit`
from code a Worker or browser bundle reaches; under those runtimes they resolve to a stub that
throws at import.

## 7. Point the CLI at the same graph

```ts
// seo.config.ts
import { defineSeoConfig } from "pagegraph/config";
import { tanstackStartGraph } from "pagegraph/tanstack-start";

export default defineSeoConfig({
  origin: "https://example.com",
  loadGraph: tanstackStartGraph({ root: import.meta.dirname }),
});
```

`tanstackStartGraph` evaluates the app's Vite config in `production` mode and returns the plugin's
graph and robots policy. Do not repeat `disallow` or `contentSignal` here; the plugin owns them.
Build-time consumers of page titles and descriptions use
`loadPageHeads(tanstackStartGraph({ root }), { exclude })` from `pagegraph/config`.

## 8. Inspect locally and compare deployments

The CLI evaluates the graph through the same Vite config as the app:

```bash
pagegraph check
pagegraph graph --format mermaid
pagegraph inspect /pricing
pagegraph sitemap
pagegraph robots

pagegraph check --site http://localhost:3000 --allow-private
pagegraph inspect http://localhost:3000/pricing --live

pagegraph audit http://localhost:3000 --allow-private --probe-only --output-dir .audit/current
before="$(find .audit/before -type f -name '*.json' -print | sort | tail -n 1)"
after="$(find .audit/current -type f -name '*.json' -print | sort | tail -n 1)"
if [ -z "$before" ] || [ -z "$after" ]; then
  echo "expected one JSON audit artifact in each directory" >&2
  exit 1
fi
pagegraph diff "$before" "$after"
pagegraph diff "$before" "$after" --json | jq
```

`pagegraph check` exits non-zero for structural graph violations and says nothing about served
HTML; `check --site` and `inspect --live` verify the rendered head and content. `pagegraph diff`
exits non-zero only when coverage or scanner quality regresses; timestamps and raw Lighthouse
timings are ignored. Each audit invocation writes one timestamped JSON artifact and one Markdown
report; the globs above select those JSON artifacts for a reviewable before/after comparison.

## Migrating from 0.11

**`selectPageHeadNodes`, `pageHeads`, and `PageHead` are exported from `pagegraph`.**

```ts
// before
import { pageHeads } from "pagegraph/config";
// after
import { pageHeads } from "pagegraph";
```

`loadPageHeads` stays in `pagegraph/config`.

**`pageHeads` reads `node.head`, not `node.instance`.** A head is declared in `staticData.seo.head`
or derived from a collection instance through its route's `titleTemplate`.

**A hand-written graph loader becomes `pagegraph()`, a collections module, and `tanstackStartGraph`.**

```ts
// before: src/lib/seo/graph.ts + seo.config.ts
export const loadSeoGraph = async () => buildSeoGraph({ routeTree, collections });
// seo.config.ts: loadGraph: viteGraphLoader({ root, entry: "/src/lib/seo/graph.ts", exportName: "loadSeoGraph" })

// after: vite.config.ts and seo.config.ts
pagegraph({ origin, collections: "src/lib/seo/collections.ts" });
// seo.config.ts: loadGraph: tanstackStartGraph({ root: import.meta.dirname })
```

Delete the stubs and env seeding that `viteGraphLoader` needed; the plugin evaluates routes inside
the app's Vite pipeline.

**`seoRouteConfig` becomes `pagegraph({ routeConfig })`.** The options are the same.

```ts
// before
seoRouteConfig({ outputPath, publicGroups, enforceCoverageIn, alwaysDisallow });
// after
pagegraph({ origin, routeConfig: { outputPath, publicGroups, enforceCoverageIn, alwaysDisallow } });
```

`seoRouteConfig` remains in `pagegraph/vite` for Router-only apps.

**robots and sitemap routes become `robotsTxt` and `sitemapXml`.**

```ts
// before
renderRobots(await loadSeoGraph(), { origin, indexable, disallow, contentSignal });
// after
import { robotsTxt } from "pagegraph/tanstack-start/server";
export const Route = createFileRoute("/robots.txt")({ server: { handlers: { GET: robotsTxt } } });
```

**`seo.config.ts` drops `disallow` and `contentSignal`.** They move to `pagegraph({ robots })`; do
not repeat them when `tanstackStartGraph` supplies them.

**`@tanstack/router-generator` is an optional peer.** Install it alongside `pagegraph/tanstack-start`
or `pagegraph/vite`.

**`research-failure.json` is `failure.json`.** Workflows write the failure checkpoint under the new
name in the output directory.

**A title suffix appended by hand in a dynamic `head()` moves to `titleTemplate`.**

```tsx
// before
head: (ctx) => seoHead(ctx, { title: `${ctx.loaderData.title} | Example Blog`, description })
// after: staticData.seo.titleTemplate: "%s | Example Blog"
head: (ctx) => seoHead(ctx, { title: ctx.loaderData.title, description })
```

**`PageSeoInstance` is `SeoPageHead` and `FAQItem` is `SeoFaq`.** Both are exported from `pagegraph`
and `pagegraph/react`; `SeoPageHead` is also the type of `staticData.seo.head`.

**A static `head: (ctx) => seoHead(ctx, {...})` becomes `staticData.seo.head` plus `head: seo.head`.**

```tsx
// before
staticData: { seo: { kind: "page", sitemap } },
head: (ctx) => seoHead(ctx, { title: "Pricing | Example", description: "Simple pricing." }),
// after
staticData: { seo: { kind: "page", sitemap, head: { title: "Pricing | Example", description: "Simple pricing." } } },
head: seo.head,
```
