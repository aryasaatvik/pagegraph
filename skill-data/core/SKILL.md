---
name: core
description: Use when adding Pagegraph to a TanStack Start app or changing its SEO wiring — the pagegraph() Vite plugin, staticData.seo declarations and seo.head, title templates, typed related links, content collections, the coverage gate, pagegraph.config.ts, sitemap and robots routes — or when a `pagegraph check`, coverage, or rendered-head failure needs diagnosing.
---

# Pagegraph and TanStack Start

Each route declares its SEO policy once in `staticData.seo`; Pagegraph derives the sitemap, robots, breadcrumbs, JSON-LD, related links, and `pagegraph check` from those declarations. TanStack Start still owns routing and the document shell. This skill ships inside the Pagegraph CLI that printed it, so it matches that version. Run the app's installed binary (`bunx pagegraph` from the app root) so the guidance and the types agree.

Before editing, read the app's `package.json`, `src/routes/`, `src/routeTree.gen.ts`, any existing `pagegraph.config.ts`, and `vite.config.ts`. Adapt the paths below to the app's layout.

## Wire it up

**1. Bind site identity and typed paths once.** Route files never repeat the origin or brand.

```ts
// src/lib/seo.ts
import { createSeo } from "pagegraph/react";
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
    description: "What the company does.",
    sameAs: [],
    contactPoint: { contactType: "support", email: "support@example.com" },
  },
  website: { searchPath: "/search?q={search_term_string}" },
});

export const seo = site; // seo.head for static routes
export const { seoHead } = site;
```

The `Register` augmentation is what types `staticData.seo` on TanStack routes and checks `related` and `redirectTo` against real paths, so a renamed route becomes a compile error. `kinds` is the app's own taxonomy; nothing branches on it.

**2. Declare each static page once.** `staticData.seo` holds the crawl policy and the head together; `seo.head` renders it.

```tsx
// src/routes/(marketing)/pricing.tsx
import { createFileRoute } from "@tanstack/react-router";
import { seo } from "../../lib/seo";

export const Route = createFileRoute("/(marketing)/pricing")({
  staticData: {
    seo: {
      kind: "page",
      crumb: "Pricing",
      sitemap: { priority: 0.9, changeFrequency: "monthly" },
      related: ["/features"],
      link: { title: "Pricing", description: "Simple volume pricing." },
      head: { title: "Pricing — Example", description: "Simple volume pricing.", faqs: pricingFaqs },
    },
  },
  head: seo.head,
  component: PricingPage,
});
```

- Policy fields: `kind`, `crumb`, `sitemap` (or `false`), `robots`, `related`, `link`, `redirectTo`, `modifiedAt`, `titleTemplate`.
- `head` is the full `title` and `description`, plus optional `faqs`, `article`, `service`, `itemList`, `jsonLd`, `ogTitle`, `canonicalPath`, and `breadcrumbs`. The title, description, and FAQs land in `staticData.seo.head`, which the graph, `pageHeads`, and `check` read — the page and the graph cannot disagree.
- Write `staticData` as an object literal and `head: seo.head`: the coverage gate reads both keys statically, and a helper call or an arrow typed with `AnyRouteMatch` in route options would make TanStack infer `any` search and loader types for the route tree.
- `link` is how other pages render a card for this route. Add it to every route that appears in someone's `related`.
- Declare `related` only for links the page actually renders in its body.
- `crumb` accepts `(match) => string` for dynamic segments, such as a title from `loaderData`.

**3. Dynamic routes keep `head()` and declare a title template.** A param route renders from `loaderData`, so it calls `seoHead`; its `titleTemplate` (`%s` is the page title) is applied by `seoHead` and by the graph to the route's collection instances, so the suffix lives in one place.

```tsx
export const Route = createFileRoute("/(marketing)/blog/$slug")({
  staticData: {
    seo: { kind: "article", titleTemplate: "%s | Example Blog", sitemap: { priority: 0.7, changeFrequency: "weekly" } },
  },
  head: (ctx) => (ctx.loaderData ? seoHead(ctx, { title: ctx.loaderData.title, description: ctx.loaderData.description }) : {}),
});
```

**4. List content pages as collections.** A param route such as `/blog/$slug` never enters the sitemap itself; its pages come from a collections module. `contentCollection` accepts any pages with a `url` (Fumadocs `loader().getPages()` directly) and turns each entry's `related` into edges. Instances inherit the param route's `kind`, `sitemap`, and `titleTemplate`.

```ts
// src/lib/seo/collections.ts
import { contentCollection } from "pagegraph";
import { blogSource } from "../blog-source";

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

**5. Register the plugin once.** It builds the graph inside the app's Vite pipeline (aliases, `define`s, and content plugins apply; no stubs) and ships it to the server runtime.

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
      indexable: process.env.DEPLOY_ENV === "production",
      robots: { contentSignal: "search=yes, ai-input=yes, ai-train=yes" },
      collections: "src/lib/seo/collections.ts",
      routeConfig: {
        outputPath: fileURLToPath(new URL("./src/lib/route-config.ts", import.meta.url)),
        publicGroups: ["(marketing)"],
        enforceCoverageIn: ["(marketing)"],
        alwaysDisallow: ["/dashboard", "/api"],
      },
    }),
  ],
});
```

- The graph evaluates every route file that declares `staticData` in a Node environment named `pagegraph`, never `routeTree.gen.ts`. A route that imports a server-runtime-only module (`cloudflare:workers`) fails with its file name; if it is an app surface rather than a public page, add it to `exclude` (route-file globs relative to `src/routes`).
- `routeConfig` is the coverage gate: dev and `vite build` fail when a page leaf in an enforced group has neither `staticData` nor `head`. Its `robotsExclusions` join `robots.disallow`.
- `indexable: false` (previews, local) serves a disallow-all robots.txt with no Sitemap line.

**6. Serve robots.txt and sitemap.xml.** They are routes, because their output depends on the deployment.

```ts
// src/routes/robots[.]txt.ts — sitemap[.]xml.ts is the same with sitemapXml
import { createFileRoute } from "@tanstack/react-router";
import { robotsTxt } from "pagegraph/tanstack-start/server";

export const Route = createFileRoute("/robots.txt")({ server: { handlers: { GET: robotsTxt } } });
```

`pagegraph/tanstack-start/server` also exports `seoGraph()` and `seoSite()` for other server code. Never import `pagegraph/tanstack-start`, `pagegraph/config`, `pagegraph/vite`, or `pagegraph/audit` from code a Worker or browser bundle reaches: under those runtimes they resolve to a stub that throws at import.

**7. Point the CLI at the same graph** with `pagegraph.config.ts` at the app root:

```ts
// pagegraph.config.ts
import { defineSeoConfig } from "pagegraph/config";
import { tanstackStartGraph } from "pagegraph/tanstack-start";

export default defineSeoConfig({
  loadGraph: tanstackStartGraph({ root: import.meta.dirname }),
});
```

`tanstackStartGraph` returns the graph and site identity from the Vite plugin. It uses the built site by default; pass `command: "serve"` with `mode: "development"` to inspect a dev host. Keep origin, indexability, and robots settings in `pagegraph()`. Optional CLI fields: `coverage` (`[{ path, minInbound }]`, contextual-link minimums enforced by `check`), `content`, `freshness`, and `workflows`. Build-time head consumers use `loadPageHeads(tanstackStartGraph({ root }), { exclude })` from `pagegraph/config`.

## Rules that bite

- `robots` values must be lowercase (`"noindex, follow"`). The sitemap projection matches `noindex` literally, so `check` rejects mixed case.
- A route with `robots` containing `noindex` or with `redirectTo` must not declare a positive `sitemap`. Use `sitemap: false` or omit it.
- A `related` target route without `link` fails `check`. Collection instances are exempt because their card uses the instance `title` and `description`.
- Coverage enforcement sees only route files inside the named group folders. `route.tsx` layouts, `.ts` server routes, and ungrouped routes are not checked. List ungrouped public routes in `extraPublicRoutes`.
- `routeConfig.outputPath` must be in an existing directory outside `src/routes`, so the route watcher does not loop.
- The graph knows declared heads (`staticData.seo.head`) and collection instances, not what a dynamic `head()` computes at request time. A route's rendered headings and JSON-LD are verified only by inspecting HTML (`check --site`).
- A FAQPage question or answer, or an Offer price, that is not in the server-rendered text fails `check --site`. Accordions must render closed panels into the HTML (for example `hidden="until-found"`), not mount them on open.
- Dates (`publishedAt`, `modifiedAt`, a route's `modifiedAt`) must be ISO 8601 (`2026-09-29`, or a date-time with an offset); they become the sitemap's `<lastmod>`, and `check` rejects any other form.
- Keep indexable pages server-rendered or prerendered. An `ssr: false` route's head is not in the served HTML.

## Verify

| Changed | Run | Proves |
| --- | --- | --- |
| Declarations, collections, the plugin, `pagegraph.config.ts` | `pagegraph check` | No structural violations (exit 1 otherwise); editorial findings are reported but do not fail |
| Headings, JSON-LD, robots meta, canonicals, page copy | `pagegraph check --site <url>` against a running server | Every declared page's rendered HTML matches its declaration and its structured data |
| `modifiedAt` dates, `freshness` policy | `pagegraph stale` | The refresh queue and which pages are undated |
| Graph shape | `pagegraph graph`, `pagegraph inspect /path` | Nodes, edges, and a page's sitemap status |
| Sitemap or robots wiring | `pagegraph sitemap`, `pagegraph robots` | The projections from the declared graph |
| Declared heads, `seoHead` input, document shell | `pagegraph inspect <full-url> --live` against a running server | The served `<head>` and JSON-LD |
| Rendered links vs `related` | `pagegraph links verify <url>` (add `--assert-coverage` for `coverage` rules) | What a crawler receives, not what was declared |
| Coverage gate | `vite build` | Every enforced page leaf declares SEO |

A passing `check` without `--site` says nothing about served HTML. Verify head and content changes with `check --site`, `inspect --live`, or a rendered-HTML test. Add `--json` when a script consumes the output. Stdout carries the data and stderr carries status. Check the exit code as well as the output.
