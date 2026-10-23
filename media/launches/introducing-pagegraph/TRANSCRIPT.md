# Introducing pagegraph: transcript

Text alternative for [`pagegraph-launch.mp4`](../../exports/pagegraph-launch.mp4), a silent
60-second film. Each section lists the on-screen text in order and describes what the motion shows.

## 0:00 For TanStack Start and TanStack Router

The route `/pricing` appears. Beside it, six places a hand-maintained site repeats that path:

- `<head>`: canonical example.com/pricing
- sitemap.xml: `<loc>example.com/pricing</loc>`
- JSON-LD: `"item": "example.com/pricing"`
- og tags: og:url example.com/pricing
- blog posts: `related: ["/pricing"]`
- llms.txt: `[Pricing](example.com/pricing.md)`

`/pricing` is struck through and renamed `/plans`. Each copy turns coral: none of them followed.

Rename one route. Every copy of its SEO has to follow.

## 0:07 pagegraph

The mark assembles: a lime node with edges to two outlined nodes.

pagegraph. Declare SEO on the route. Derive the rest from one graph.

TanStack Start, TanStack Router. Vite plugin and CLI. Open source, MIT.

## 0:12 Declare

Declare it once, on the route. `staticData.seo` holds the crawl policy and the head together.
`seo.head` renders it.

The code from `src/routes/(marketing)/pricing.tsx` in the repository's TanStack Start test fixture:

```tsx
export const Route = createFileRoute("/(marketing)/pricing")({
  staticData: {
    seo: {
      kind: "page",
      link: { title: "Pricing", description: "Simple pricing." },
      crumb: "Pricing",
      sitemap: { priority: 0.9, changeFrequency: "monthly" },
      head: {
        image: { url: "/og/pricing.png", width: 1200, height: 630, alt: "Example pricing" },
        title: "Pricing | Example",
        description: "Simple pricing.",
        faqs: [{ question: "Is there a free plan?", answer: "Yes." }],
      },
    },
  },
  head: seo.head,
});
```

Each part highlights as the output it feeds appears:

- `head` and `head: seo.head`: the `<head>` from `seo.head`. Title: Pricing | Example. Description:
  Simple pricing. Canonical: https://example.com/pricing. og:image:
  https://example.com/og/pricing.png. twitter:card: summary_large_image. JSON-LD: FAQPage.
- `sitemap`: in sitemap.xml, `<loc>https://example.com/pricing</loc>`,
  `<changefreq>monthly</changefreq>`, `<priority>0.9</priority>`.
- `crumb` and `link`: in the graph, a crumb-parent edge from `/pricing` to `/`, and the link card
  "Pricing · Simple pricing."

The graph and the checks read this same declaration.

## 0:24 Graph

One graph, built in your Vite pipeline. `pagegraph()` evaluates route files and collections with
your aliases and defines.

The fixture's pages appear as nodes: `/`, `/pricing` (in lime), `/help`, `/terms`, and, inside a
dashed box labelled "collection · blog", `/blog/second` and `/blog/first`. Three edges draw: a
crumb-parent edge from `/pricing` to `/`, and related edges from both blog posts to `/pricing`.

Derived from the graph:

- sitemap.xml: 6 `<loc>` entries
- robots.txt: `Disallow: /app`, `Sitemap: https://example.com/sitemap.xml`
- `<head>`: seo.head, from the same declarations
- llms.txt: graph titles and descriptions
- pagegraph check: the CI gate reads the same graph

robotsTxt and sitemapXml serve the graph from one-line Start server routes.

## 0:36 Check

Rename a route. The check names what broke.

In `src/routes/(marketing)/pricing.tsx`, renamed:

```diff
- createFileRoute("/(marketing)/pricing")
+ createFileRoute("/(marketing)/plans")
```

In `src/collections.ts`, unchanged: `related: ["/pricing"],`

A terminal runs `pagegraph check`:

```text
Structural (2):

  ✗ [dead-edge]  /blog/second
      related edge from "/blog/second" points at "/pricing", which is not a node in the graph.
      fix: Update the related target on the "/blog/second" route, or restore "/pricing".
  ✗ [dead-edge]  /blog/first
      related edge from "/blog/first" points at "/pricing", which is not a node in the graph.
      fix: Update the related target on the "/blog/first" route, or restore "/pricing".

Editorial (2): description-length warnings trimmed

2 structural, 2 editorial — structural violations fail the check.
```

exit 1. Two blog posts still link to a page that no longer exists.

Structural violations fail the check. Editorial ones warn. With `routeConfig.enforceCoverageIn`,
the Vite build also fails for a page in those route groups that declares neither `staticData` nor
`head`.

## 0:48 Markdown

Authored pages ship as Markdown, too. Mark page text with `pagegraph/react`. After prerender, each
rendered page gets a Markdown twin.

The code from `src/routes/index.tsx` in the repository's Markdown test fixture:

```tsx
<Section id="hero" kind="hero">
  <h1>
    <Title>Email, in one call.</Title>
  </h1>
  <p>
    <T>
      Start with <Fact id="emails" /> emails.
    </T>
  </p>
  <Link to="/plain">
    <T>Read more</T>
  </Link>
  <T>
    Runtime: <Fact id="runtime" />.
  </T>
  <ForHumans>
    <T>Scroll to compare.</T>
  </ForHumans>
  <Visual describe="The email arrives in the inbox.">
    <div>Image placeholder</div>
  </Visual>
</Section>
```

`dist/client/index.md` contains:

```text
# Email, in one call.
Start with 3,000 emails.
[Read more](https://example.com/plain)
Runtime: workerd.
The email arrives in the inbox.
```

"Scroll to compare." is struck through: ForHumans, left out.

llms.txt:

```text
## Pages

- [Mail for teams](https://example.com/index.md): Send product email.
```

The two `Fact` lines highlight. Facts resolve from src/facts.ts, so 3000 renders as 3,000.

## 0:55 Get started

pagegraph. `bun add pagegraph`. github.com/aryasaatvik/pagegraph. MIT, TanStack Start and TanStack
Router, pre-1.0.
