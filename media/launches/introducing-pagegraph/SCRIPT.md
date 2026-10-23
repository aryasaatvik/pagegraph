# Introducing pagegraph

A 60-second, 16:9 kinetic-typography film for TanStack Start and TanStack Router developers. On-screen
type carries the story with the sound off. The film is silent: no narration, captions track, music,
or generated audio. The [transcript](TRANSCRIPT.md) is its text alternative.

## Identity

A dark dot-grid sheet (graph paper for a graph), warm white ink, and one signal lime for what a
route declares. Derived output is drawn in ink. Coral marks only a failed check. The mark is one
lime node feeding two outlined nodes: a declaration and what derives from it. Display type is
Bricolage Grotesque; code, labels, and terminal output are Spline Sans Mono.

## Beats

| Time   | Beat     | On-screen copy and motion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–7s   | Hook     | **For TanStack Start and TanStack Router.** `/pricing`, then six places a hand-maintained site repeats its path (`<head>` canonical, sitemap `<loc>`, a JSON-LD item, `og:url`, a blog post's `related`, an llms.txt link). The route is struck and renamed `/plans`; every copy turns coral. **Rename one route. Every copy of its SEO has to follow.** The copies are illustrative of the problem, not pagegraph output.                                                                                                                                                                        |
| 7–12s  | Reveal   | The mark assembles; the **pagegraph** wordmark rises. **Declare SEO on the route. Derive the rest from one graph.** Chips: **TanStack Start · TanStack Router**, **Vite plugin and CLI**, **Open source · MIT**.                                                                                                                                                                                                                                                                                                                                                                                  |
| 12–24s | Declare  | **Declare it once, on the route.** **staticData.seo holds the crawl policy and the head together. seo.head renders it.** The real pricing route from the TanStack Start test fixture. Its `head` lines light and a `<head> from seo.head` card lists title, description, canonical, `og:image`, `twitter:card`, and `FAQPage` JSON-LD. `sitemap` lights and the page's `sitemap.xml` entry appears. `crumb` and `link` light and a `graph` card shows the `crumb-parent` edge `/pricing → /` and the link card. **The graph and the checks read this same declaration.**                          |
| 24–36s | Graph    | **One graph, built in your Vite pipeline.** **pagegraph() evaluates route files and collections with your aliases and defines.** The fixture's six pages appear (`/pricing` declared in lime), the blog collection is outlined, and three edges draw: `crumb-parent` from `/pricing` to `/`, and `related` from both blog posts to `/pricing`. Derived outputs stack beside it: `sitemap.xml` (6 `<loc>` entries), `robots.txt` (`Disallow: /app`, the `Sitemap:` line), `<head>`, `llms.txt`, `pagegraph check`. **robotsTxt and sitemapXml serve the graph from one-line Start server routes.** |
| 36–48s | Check    | **Rename a route. The check names what broke.** The pricing route is renamed to `/plans`; `src/collections.ts` still says `related: ["/pricing"]`. The real `pagegraph check` report types out: two `dead-edge` violations with their fixes, the editorial warnings trimmed, and the summary line. **exit 1.** **Two blog posts still link to a page that no longer exists.** Notes: structural violations fail the check and editorial ones warn; with `routeConfig.enforceCoverageIn`, the Vite build also fails a page in those groups that declares neither `staticData` nor `head`.          |
| 48–55s | Markdown | **Authored pages ship as Markdown, too.** **Mark page text with pagegraph/react. After prerender, each rendered page gets a Markdown twin.** The Markdown fixture's hero section (`Section`, `Title`, `T`, `Fact`, `Link`, `ForHumans`, `Visual`) beside the `dist/client/index.md` lines the build test asserts, with the `ForHumans` line struck as left out, and its `llms.txt` entry. The two `Fact` lines light: **Facts resolve from src/facts.ts, so 3000 renders as 3,000.**                                                                                                              |
| 55–60s | CTA      | Mark and wordmark. **$ bun add pagegraph**, **github.com/aryasaatvik/pagegraph**, **MIT · TanStack Start and TanStack Router · Pre-1.0**. Holds to the last frame.                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Claims

Every on-screen excerpt and derived value lives in `src/scenes/source.ts`, and
`tests/source.test.ts` fails when it drifts:

- The pricing route, collection entry, and authored section are verbatim excerpts of
  `tests/fixtures/tanstack-start-app` and `tests/fixtures/markdown-start-app`.
- The `<head>` rows come from calling the fixture's own `createSeo` `seo.head` on the pricing
  declaration; the sitemap and robots lines from `renderSitemap` and `renderRobots` over the fixture
  graph built with `buildSeoGraph` from its real route declarations, collections, origin, and image
  resolver. The page list and two of the edges are also asserted by `tests/tanstack-start/plugin.test.ts`,
  which evaluates the app through Vite.
- The check report is `checkGraph` and `renderViolations` over that graph with `/pricing` renamed to
  `/plans`, and the unrenamed graph has no structural violation. Running the real CLI on a renamed
  copy of the fixture printed the same block and exited 1.
- The coverage note quotes `coverageMessage` from `src/vite/route-config.ts` and says the gate is
  opt-in. The Markdown twin, the struck `ForHumans` line, and the llms.txt entry are the strings
  `tests/tanstack-start/build.test.ts` asserts.
- The film does not claim that nothing drifts or that every undeclared page fails the build; the
  coverage gate appears only as opt-in. It makes no ranking, traffic, speed, adoption, zero-config, or
  universal-framework claim; `tests/copy.test.ts` rejects those phrases and allows "rankings" only
  in the infographic's denial.

## Stills and cards

All use the film's scene system and render compositor, exported losslessly from a PNG sequence.

| File                          | Size      | Story                                                                                                                                                  |
| ----------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `route-declaration.png`       | 1920×1080 | The pricing declaration with five numbered fields (`link`, `crumb`, `sitemap`, `head`, `head.image`), what each derives, and the check that guards it. |
| `drift-gates.png`             | 1920×1080 | Where a broken declaration surfaces: type check, Vite build, `pagegraph check`, and `pagegraph links verify`, with opt-in gates marked.                |
| `what-runs-where.png`         | 1920×1080 | Runtime entries beside build and CLI entries, from `package.json` exports; build entries stub under `workerd`, `worker`, and `browser`.                |
| `og.png`                      | 1200×630  | Mark, wordmark, tagline, install line, repository.                                                                                                     |
| `github-social-preview.png`   | 1280×640  | The same card at GitHub's social preview size.                                                                                                         |
| `pagegraph-launch-poster.jpg` | 1920×1080 | The settled reveal at 10.6 seconds, extracted from the rendered film.                                                                                  |
