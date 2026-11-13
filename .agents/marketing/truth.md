# Marketing truth

This file decides whether the PageGraph site may say something in public. [Positioning](positioning.md) decides which true things to lead with, and [voice](voice.md) decides how they sound. Truth wins every conflict among the three.

Public means every surface a stranger can read: pages, titles, meta descriptions, OG cards, JSON-LD, `llms.txt`, the `.md` mirrors, the README, the npm description, GitHub metadata and social posts. Metadata counts.

Sources are paths in this repository. `README` means [README.md](../../README.md). Read the version from npm at ship time (`npm view pagegraph version`); do not hard-code it in copy that outlives the release. The published version when this file was written is 0.18.1.

## Approved headline and sub

- **Headline:** Declare SEO on the route. PageGraph derives the rest.
- **Sub:** Head tags, sitemap, robots.txt, JSON-LD and a CI gate for TanStack Start, from one declaration per route. This site is built with it.

Source: product decision for the site; every noun in the sub maps to a claim below (head, sitemap, robots.txt, JSON-LD, CI gate).

## What it is

| Claim                                                                                                                                                               | Source                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| PageGraph is an npm library for route-declared SEO in TanStack Start and TanStack Router.                                                                           | README intro                                                             |
| Each route declares its SEO policy and head once, in `staticData.seo`.                                                                                              | README intro, Quick start step 2                                         |
| The `<head>`, sitemap, `robots.txt`, breadcrumbs, JSON-LD, cross-links and the CI check derive from that declaration.                                               | README intro                                                             |
| `seo.head` returns the `meta` and canonical `links` TanStack renders: title, description, Open Graph and Twitter cards, robots, and the JSON-LD each page warrants. | README Quick start step 2                                                |
| JSON-LD includes BreadcrumbList (two or more crumbs), and Article, FAQPage, Service and ItemList when the head declares them.                                       | README Quick start step 2                                                |
| The graph and the checks read the same `staticData.seo.head` that the page renders, so the page and the graph cannot disagree.                                      | README Quick start step 2                                                |
| The `pagegraph()` Vite plugin builds the graph once per build (and on change in dev) inside the app's Vite pipeline, and ships it to the server runtime as data.    | README Quick start step 3; `src/tanstack-start/plugin.ts`                |
| `robots.txt` and `sitemap.xml` are one-line routes: `robotsTxt` and `sitemapXml` from `pagegraph/tanstack-start/server`.                                            | README Quick start step 4                                                |
| `indexable: false` (previews) serves a disallow-all `robots.txt` with no Sitemap line.                                                                              | `src/tanstack-start/graph.ts` (`PagegraphOptions.indexable`); core SKILL |
| `related` and `redirectTo` are typed against the real route tree through `Register`: a renamed route is a compile error.                                            | README Typed paths                                                       |
| Dynamic pages enter as collections; instances inherit the parameter route's declared policy.                                                                        | README The graph                                                         |
| This site is built with PageGraph.                                                                                                                                  | Product statement for the site (`site/pagegraph.config.ts` exists)       |

## The gates

| Claim                                                                                                                                                        | Source                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `pagegraph check` exits 1 on structural violations; editorial findings are reported and do not fail.                                                         | README The graph, CLI                                   |
| With `routeConfig.enforceCoverageIn`, a page in those route groups that declares neither `staticData` nor `head` fails `vite build`. The gate is opt-in.     | README intro, Coverage gate                             |
| `pagegraph check --site <url>` checks the server-rendered HTML of every declared page: one H1, canonical, robots meta, visible FAQ answers and offer prices. | README Check rendered content                           |
| A FAQ answer that exists only in JSON-LD or hydration data is a structural violation.                                                                        | README Check rendered content                           |
| `check` fails a published URL the rendered `robots.txt` disallows for `User-agent: *` (`robots-blocks-sitemap-url`), using RFC 9309 matching.                | README Coverage gate, The graph                         |
| `check` fails sitemap-eligible pages without a resolved Open Graph image.                                                                                    | README Per-page Open Graph images; `src/core/checks.ts` |
| `pagegraph links verify` crawls served HTML and reports homepage depth, rendered orphans and the declared-vs-rendered link diff.                             | README Verify the rendered link graph                   |
| `pagegraph links verify --assert-coverage` refuses to assert, rather than pass falsely, when the crawl is incomplete.                                        | README Assert coverage on the rendered graph            |
| Contextual-link coverage: `coverage` rules need a minimum count of inbound `related` edges per path glob.                                                    | README Contextual-link coverage                         |
| `pagegraph stale` lists sitemap pages past the freshness policy; undated pages are counted, not called stale.                                                | README Freshness                                        |
| The claims gate replays committed answers at build time without a model or credentials; missing answers and violations fail the build.                       | README Claims gate                                      |

## Optional and extra capabilities

Claimable, but never in the hero and never described as required.

- **Markdown twins and llms.txt (TanStack Start).** Rendered pages can be captured to `dist/client/<page>.md`, and `llmsTxt` serves a graph-derived `llms.txt`. Source: README Rendered markdown with TanStack Start. The Cloudflare prerender Worker wiring is documented; do not imply other hosts are tested.
- **Audit (framework-independent).** `pagegraph audit <url>` works on any website without `pagegraph.config.ts`; `pagegraph diff` compares two audit reports. Source: README Audit any website, Compare audit artifacts.
- **Agentic workflows.** `research`, `analyze`, `plan` and `improve` commands run through Pi, Executor and Jev. `improve` applies edits by default on a clean Git tree; `--dry-run` records them for review and `pagegraph apply` applies them. The agent never writes files itself. Source: README Agentic workflows, Review and apply edits.
- **Agent skill.** `pagegraph skills get core` prints the bundled TanStack Start integration skill matching the installed version. Source: README Agent skill.
- **Testing.** Every check is a pure function callable from a test (`checkGraph`, `inspectHtml`, `checkPageContent`). Source: README Testing.

## Runtime and packaging

| Claim                                                                                                                                        | Source                 |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Runtime entries have zero runtime dependencies beyond their listed peers; a test pins each entry's import graph.                             | README What runs where |
| Build entries resolve to a stub under the `workerd`, `worker` and `browser` conditions and fail at import with an error naming the entry.    | README What runs where |
| The CLI bundles its Effect, TypeSafe and Pi runtimes and runs on Bun (`bunx pagegraph`). `vite` is a peer; `lighthouse` is only for `audit`. | README What runs where |
| The package is MIT licensed.                                                                                                                 | README License         |

## Adoption

- Claimable: **Samva's website is built with PageGraph, in production.** Evidence: Samva `main`
  (1a723778e7, read 2026-11-13) pins `pagegraph` 0.18.1 in `apps/web/package.json`;
  `apps/web/vite.config.ts` adds the `pagegraph()` plugin and the prerender Worker;
  `apps/web/pagegraph.config.ts` runs `pagegraph check` with an Open Graph image gate and
  contextual-link coverage rules. The site is https://samva.dev. Samva's maintainer approved naming
  it on 2026-11-13. Re-check the pinned version before quoting it.
- Say only what that shows: Samva's site uses the plugin, the check and its coverage rules. No
  traffic, ranking or indexing outcome.
- Any other user stays unnamed until it approves a mention and a row here records the evidence.

## What it is not

- **Not a hosted service.** PageGraph is a library and a CLI that run in your repository and your build. There is no account, dashboard or hosted crawler.
- **Not a crawler SaaS.** `pagegraph audit` and `links verify` fetch pages from your machine or CI, through a DNS-pinned, private-IP-blocked HTTP path. They do not monitor a site over time.
- **Not framework-neutral for the plugin.** The `pagegraph()` plugin, server routes and Markdown capture are TanStack Start. TanStack Router apps without Start can use `buildSeoGraph` and `seoRouteConfig`. `pagegraph audit` is the only framework-independent command.
- **Not a ranking tool.** It checks that declarations are consistent and that rendered pages match them. Never promise rankings, traffic or "better SEO".
- **Not a replacement for Google Search Console** or any analytics product.

## Never say

- Any number not in this file or the README: no download counts, GitHub star counts, performance figures, or customer counts.
- That PageGraph "guarantees" indexing, rankings or rich results.
- That `pagegraph check` verifies served HTML without `--site`. It does not.
- That the coverage gate is on by default. It is opt-in.
- That agent workflows are required, deterministic or free of model calls. They use a model and Executor; `check` does not.
- That a feature exists because a branch or plan says so. Claim only what the published package does.
