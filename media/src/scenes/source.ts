/**
 * Code and output shown on screen. Each excerpt is copied verbatim from the repository file it
 * names, and `tests/source.test.ts` fails when that file no longer contains it. Derived output
 * (head tags, sitemap lines, `pagegraph check` report) is recomputed there with the repository's
 * own functions, so a change to what pagegraph emits fails the test before it reaches a render.
 */

export interface Excerpt {
  /** Repository-relative file the code is copied from. */
  readonly file: string;
  /** The verbatim text, including its original indentation. */
  readonly code: string;
}

/** The fixture app the excerpts come from; tests build and evaluate it. */
export const fixtureApp = "tests/fixtures/tanstack-start-app";

export const pricingRoute: Excerpt = {
  file: `${fixtureApp}/src/routes/(marketing)/pricing.tsx`,
  code: `export const Route = createFileRoute("/(marketing)/pricing")({
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
});`,
};

/** Lines of {@link pricingRoute} (zero-based, inclusive) that each derived output reads. */
export const pricingLines = {
  link: [4, 4],
  crumb: [5, 5],
  sitemap: [6, 6],
  head: [7, 12],
  render: [15, 15],
} as const;

/** The collection entry that relates every blog post to `/pricing`. */
export const collectionEntry: Excerpt = {
  file: `${fixtureApp}/src/collections.ts`,
  code: `    entry: (post) => ({
      title: post.title,
      description: post.description,
      publishedAt: post.date,
      related: ["/pricing"],
    }),`,
};

/**
 * The film's one illustrative edit: the pricing route renamed to `/plans`. The check scene shows
 * the real `pagegraph check` report for that edit; the test rebuilds it with `checkGraph`.
 */
export const rename = {
  from: `createFileRoute("/(marketing)/pricing")`,
  to: `createFileRoute("/(marketing)/plans")`,
  path: { from: "/pricing", to: "/plans" },
} as const;

/** The site identity `createSeo` binds in the fixture; rendered head values use its origin. */
export const fixtureOrigin = "https://example.com";

/** What `seo.head` renders for the pricing declaration, as name/value rows. */
export const pricingHead = [
  { name: "title", value: "Pricing | Example" },
  { name: "description", value: "Simple pricing." },
  { name: "canonical", value: "https://example.com/pricing" },
  { name: "og:image", value: "https://example.com/og/pricing.png" },
  { name: "twitter:card", value: "summary_large_image" },
  { name: "JSON-LD", value: "FAQPage" },
] as const;

/** The pricing entry `renderSitemap` writes for the built fixture. */
export const pricingSitemap = [
  "<loc>https://example.com/pricing</loc>",
  "<changefreq>monthly</changefreq>",
  "<priority>0.9</priority>",
] as const;

/** Lines `renderRobots` writes for the built fixture's robots policy. */
export const fixtureRobots = [
  "Disallow: /app",
  "Sitemap: https://example.com/sitemap.xml",
] as const;

/** The fixture graph's pages, in `pageHeads` order, and its typed edges. */
export const graphPages = [
  "/",
  "/pricing",
  "/help",
  "/terms",
  "/blog/second",
  "/blog/first",
] as const;
export const graphEdges = [
  { from: "/pricing", to: "/", type: "crumb-parent" },
  { from: "/blog/second", to: "/pricing", type: "related" },
  { from: "/blog/first", to: "/pricing", type: "related" },
] as const;

/**
 * `pagegraph check` after the rename: its structural block and summary line, verbatim. The two
 * editorial warnings the fixture also reports (short blog descriptions) are trimmed on screen.
 */
export const checkReport = {
  command: "pagegraph check",
  structural: `Structural (2):

  ✗ [dead-edge]  /blog/second
      related edge from "/blog/second" points at "/pricing", which is not a node in the graph.
      fix: Update the related target on the "/blog/second" route, or restore "/pricing".
  ✗ [dead-edge]  /blog/first
      related edge from "/blog/first" points at "/pricing", which is not a node in the graph.
      fix: Update the related target on the "/blog/first" route, or restore "/pricing".`,
  trimmed: "Editorial (2): description-length warnings trimmed",
  summary: "2 structural, 2 editorial — structural violations fail the check.",
} as const;

/** The coverage gate's failure message prefix, from `pagegraph/vite`'s route-config plugin. */
export const coverageFailure = "declare neither staticData nor head";

/** The rendered-markdown fixture's authored hero section. */
export const markdownApp = "tests/fixtures/markdown-start-app";

export const authoredSection: Excerpt = {
  file: `${markdownApp}/src/routes/index.tsx`,
  code: `      <Section id="hero" kind="hero">
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
      </Section>`,
};

/** Lines the build test asserts the published `index.md` twin contains, in document order. */
export const markdownTwin = [
  "# Email, in one call.",
  "Start with 3,000 emails.",
  "[Read more](https://example.com/plain)",
  "Runtime: workerd.",
  "The email arrives in the inbox.",
] as const;

/** Human-only text the build test asserts the twin leaves out. */
export const humansOnly = "Scroll to compare.";

/** The llms.txt entry the build composes from graph metadata. */
export const llmsEntry = "- [Mail for teams](https://example.com/index.md): Send product email.";

export const install = "bun add pagegraph";
export const repositoryUrl = "github.com/aryasaatvik/pagegraph";

/** Strip the indentation every line of an excerpt shares, for display. */
export function dedent(code: string): string {
  const lines = code.split("\n");
  const indent = Math.min(
    ...lines.filter((line) => line.trim() !== "").map((line) => /^ */.exec(line)?.[0].length ?? 0),
  );
  return lines.map((line) => line.slice(indent)).join("\n");
}
