import { describe, expect, it } from "@effect/vitest";

import {
  checkPageContent,
  checkRenderedContent,
  extractPageContent,
  priceIsVisible,
  renderedCheckTargets,
  type RenderedDocument,
} from "../../src/core/content";
import type { RouteSeo } from "../../src/core/declare";
import type { SeoGraph, SeoNode } from "../../src/core/graph";

/**
 * Content checks are pure over rendered HTML strings, so each fixture is the
 * smallest document that exercises one rule. `page()` builds a well-formed page
 * that passes every rule; tests override one part of it.
 */
const page = (parts: {
  readonly head?: string;
  readonly main?: string;
  readonly chrome?: string;
  readonly jsonLd?: ReadonlyArray<unknown>;
  readonly path?: string;
}): string => {
  const path = parts.path ?? "/pricing";
  const head =
    parts.head ??
    `<title>Email API pricing | Example</title><meta name="description" content="Plans for every volume."><link rel="canonical" href="https://example.com${path}">`;
  const blocks = (parts.jsonLd ?? [])
    .map((block) => `<script type="application/ld+json">${JSON.stringify(block)}</script>`)
    .join("");
  const main = parts.main ?? "<h1>Email API pricing</h1><h2>Plans</h2><p>Start free.</p>";
  return `<!doctype html><html><head>${head}${blocks}</head><body><header><nav><h3>Menu</h3></nav></header>${parts.chrome ?? ""}<main>${main}</main><footer><h4>Company</h4></footer></body></html>`;
};

const rulesOf = (html: string, minWords?: number): Array<string> =>
  checkPageContent(extractPageContent(html), { minWords }).map((finding) => finding.rule);

describe("extractPageContent", () => {
  it("reads H1s from the whole body and the outline from <main> only", () => {
    const content = extractPageContent(page({}));
    expect(content.h1).toEqual(["Email API pricing"]);
    expect(content.outline).toEqual([
      { level: 1, text: "Email API pricing" },
      { level: 2, text: "Plans" },
    ]);
  });

  it("falls back to the body without nav and footer when there is no <main>", () => {
    const html =
      "<html><body><nav><h2>Nav</h2></nav><h1>Topic</h1><h2>Section</h2><footer><h5>Legal</h5></footer></body></html>";
    expect(extractPageContent(html).outline.map((heading) => heading.text)).toEqual([
      "Topic",
      "Section",
    ]);
  });

  it("names an H1 by its text, then aria-label, then image alt", () => {
    const content = extractPageContent(
      page({
        main: '<h1><span>Send</span> <em>email</em></h1><h1 aria-label="Labelled"><svg><title>x</title></svg></h1><h1><img alt="Logo"></h1>',
      }),
    );
    expect(content.h1).toEqual(["Send email", "Labelled", "Logo"]);
  });

  it("excludes scripts, styles, templates, and comments from visible text", () => {
    const content = extractPageContent(
      page({
        main: '<h1>Visible</h1><script>self.$R = {answer:"hydration only"}</script><style>.x{}</style><template><p>later</p></template><!-- note -->',
      }),
    );
    expect(content.text).toContain("Visible");
    for (const hidden of ["hydration only", "later", "note", ".x"]) {
      expect(content.text).not.toContain(hidden);
    }
  });

  it("collects typed JSON-LD nodes at any depth, across arrays and @graph", () => {
    const content = extractPageContent(
      page({
        jsonLd: [
          { "@context": "https://schema.org", "@graph": [{ "@type": "WebPage", name: "Email API pricing" }] },
          [{ "@type": "Product", offers: { "@type": "Offer", price: 19 } }],
        ],
      }),
    );
    expect(content.jsonLd.map((node) => node["@type"])).toEqual(["WebPage", "Product", "Offer"]);
  });

  it("counts words in the main region, not site chrome", () => {
    const content = extractPageContent(page({ main: "<h1>One two</h1><p>three, four-five.</p>" }));
    expect(content.wordCount).toBe(5);
  });
});

describe("checkPageContent — headings", () => {
  it("passes a page with one H1 and a nested outline", () => {
    expect(rulesOf(page({}))).toEqual([]);
  });

  it("flags a missing, repeated, or empty H1 as structural", () => {
    expect(rulesOf(page({ main: "<h2>Plans</h2>" }))).toContain("missing-h1");
    expect(rulesOf(page({ main: "<h1>Pricing</h1><h1>Plans</h1>" }))).toContain("multiple-h1");
    expect(rulesOf(page({ main: "<h1> </h1>" }))).toContain("empty-h1");
    const [finding] = checkPageContent(extractPageContent(page({ main: "<p>No heading</p>" })));
    expect(finding).toMatchObject({ rule: "missing-h1", severity: "structural" });
  });

  it("flags a skipped heading level, including an outline that starts below h2", () => {
    const skips = checkPageContent(
      extractPageContent(page({ main: "<h1>Email API pricing</h1><h2>A</h2><h4>B</h4><h2>C</h2><h3>D</h3>" })),
    ).filter((finding) => finding.rule === "heading-level-skip");
    expect(skips).toEqual([
      expect.objectContaining({ severity: "editorial", message: expect.stringContaining('h2 → h4 "B"') }),
    ]);
    expect(rulesOf(page({ main: "<h3>Deep first</h3><h1>Email API pricing</h1>" }))).toContain(
      "heading-level-skip",
    );
  });

  it("ignores heading levels in site chrome", () => {
    expect(rulesOf(page({}))).not.toContain("heading-level-skip");
  });

  it("warns when the H1 shares no significant term with the title", () => {
    expect(rulesOf(page({ main: "<h1>Start free today</h1>" }))).toContain("h1-title-mismatch");
    // Stopwords and plural folding do not count as, or hide, a shared topic.
    expect(rulesOf(page({ main: "<h1>The prices of emails</h1>" }))).not.toContain("h1-title-mismatch");
    // Word forms of one stem agree.
    expect(
      rulesOf(page({ head: "<title>Authenticate the API | Example</title>", main: "<h1>Authentication</h1>" })),
    ).not.toContain("h1-title-mismatch");
  });
});

describe("checkPageContent — structured data against visible text", () => {
  const faq = (answer: string) => ({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      { "@type": "Question", name: "Is there a free plan?", acceptedAnswer: { "@type": "Answer", text: answer } },
    ],
  });

  it("passes FAQ entries whose question and answer are rendered, despite markup and punctuation", () => {
    const html = page({
      jsonLd: [faq("Yes — <strong>3,000</strong> emails a month.")],
      main: "<h1>Email API pricing</h1><details><summary>Is there a free plan?</summary><p>Yes, 3,000 emails a <em>month</em>.</p></details>",
    });
    expect(rulesOf(html)).toEqual([]);
  });

  it("passes a plain-text answer whose angle-bracket placeholders render escaped", () => {
    const html = page({
      jsonLd: [faq("Add a TXT record at samva-<id>._domainkey.example.com.")],
      main: "<h1>Email API pricing</h1><details><summary>Is there a free plan?</summary><p>Add a TXT record at samva-&lt;id&gt;._domainkey.example.com.</p></details>",
    });
    expect(rulesOf(html)).toEqual([]);
  });

  it("passes an answer with real block and link markup when its text is rendered", () => {
    const html = page({
      jsonLd: [faq('<p>Yes.</p><p>See <a href="/pricing">pricing</a>.<br>No card needed.</p>')],
      main: '<h1>Email API pricing</h1><details><summary>Is there a free plan?</summary><p>Yes. See <a href="/pricing">pricing</a>. No card needed.</p></details>',
    });
    expect(rulesOf(html)).toEqual([]);
  });

  it("flags a placeholder answer that the page does not show", () => {
    const html = page({
      jsonLd: [faq("Add a TXT record at samva-<id>._domainkey.example.com.")],
      main: "<h1>Email API pricing</h1><details><summary>Is there a free plan?</summary><p>Add a record.</p></details>",
    });
    expect(rulesOf(html)).toEqual(["faq-not-visible"]);
  });

  it("flags an FAQ answer that exists only in JSON-LD and hydration data", () => {
    const html = page({
      jsonLd: [faq("Yes, 3,000 emails a month.")],
      main: '<h1>Email API pricing</h1><button>Is there a free plan?</button><script>$R={answer:"Yes, 3,000 emails a month."}</script>',
    });
    const [finding] = checkPageContent(extractPageContent(html));
    expect(finding).toMatchObject({
      rule: "faq-not-visible",
      severity: "structural",
      message: 'FAQPage answer for "Is there a free plan?" is not in the rendered page text.',
    });
  });

  it("flags an offer price that the page never shows", () => {
    const offer = (price: unknown) => ({
      "@type": "Product",
      name: "Growth",
      offers: { "@type": "Offer", price, priceCurrency: "USD" },
    });
    const main = "<h1>Email API pricing</h1><p>Growth is $19/mo.</p>";
    expect(rulesOf(page({ main, jsonLd: [offer("19.00")] }))).toEqual([]);
    const [finding] = checkPageContent(extractPageContent(page({ main, jsonLd: [offer(29)] })));
    expect(finding).toMatchObject({
      rule: "offer-price-not-visible",
      severity: "structural",
      message: "Offer price 29 USD does not appear in the rendered page text.",
    });
  });

  it("matches prices as numbers, not substrings", () => {
    expect(priceIsVisible(19, "Growth $19/mo")).toBe(true);
    expect(priceIsVisible(19, "19.00 USD")).toBe(true);
    expect(priceIsVisible(19, "$199")).toBe(false);
    expect(priceIsVisible(19, "$1.19")).toBe(false);
    expect(priceIsVisible(1000, "$1,000 a year")).toBe(true);
    expect(priceIsVisible(0.5, "$0.50 per 1,000")).toBe(true);
    expect(priceIsVisible(0, "Free forever")).toBe(true);
  });

  it("warns when a WebPage name or description drifts from the head", () => {
    const main = "<h1>Email API pricing</h1>";
    const agreeing = { "@type": "WebPage", name: "Email API pricing", description: "Plans for every volume." };
    expect(rulesOf(page({ main, jsonLd: [agreeing] }))).toEqual([]);

    const findings = checkPageContent(
      extractPageContent(
        page({ main, jsonLd: [{ "@type": "WebPage", name: "Old pricing", description: "Stale copy." }] }),
      ),
    );
    expect(findings.map((finding) => [finding.rule, finding.severity])).toEqual([
      ["webpage-head-mismatch", "editorial"],
      ["webpage-head-mismatch", "editorial"],
    ]);
  });
});

describe("checkPageContent — word count", () => {
  it("flags thin main content only when a floor is given", () => {
    expect(rulesOf(page({}))).not.toContain("thin-content");
    expect(rulesOf(page({}), 50)).toContain("thin-content");
    expect(rulesOf(page({}), 5)).not.toContain("thin-content");
  });
});

describe("checkRenderedContent", () => {
  const SITEMAP = { priority: 0.5, changeFrequency: "monthly" } as const;
  const node = (path: string, policy: Partial<RouteSeo> = {}): SeoNode => ({
    path,
    kind: "page",
    source: "route",
    policy: { kind: "page", sitemap: SITEMAP, ...policy },
  });
  const graph: SeoGraph = {
    nodes: new Map(
      [
        node("/pricing"),
        node("/features"),
        node("/compare", { sitemap: false, robots: "noindex, follow" }),
        node("/blog/$slug"),
        node("/old", { redirectTo: "/pricing" }),
      ].map((entry) => [entry.path, entry]),
    ),
    edges: [],
  };
  const ok = (path: string, html: string): RenderedDocument => ({ path, ok: true, finalPath: path, html });

  it("targets sitemap pages and concrete noindex pages, not templates or redirects", () => {
    expect(renderedCheckTargets(graph)).toEqual(["/pricing", "/features", "/compare"]);
  });

  it("passes pages that match their declarations", () => {
    const violations = checkRenderedContent(graph, [
      ok("/pricing", page({})),
      ok(
        "/compare",
        page({ head: '<title>Compare | Example</title><meta name="robots" content="noindex, follow">' }),
      ),
    ]);
    expect(violations).toEqual([]);
  });

  it("reports unreadable and redirected pages as structural", () => {
    const violations = checkRenderedContent(graph, [
      { path: "/pricing", ok: false, error: "HTTP 500" },
      { path: "/features", ok: true, finalPath: "/", html: page({}) },
    ]);
    expect(violations.map((violation) => [violation.rule, violation.path, violation.severity])).toEqual([
      ["rendered-page-unavailable", "/pricing", "structural"],
      ["rendered-page-unavailable", "/features", "structural"],
    ]);
  });

  it("holds rendered robots meta to the declaration in both directions", () => {
    const violations = checkRenderedContent(graph, [
      ok("/pricing", page({ head: `${'<meta name="robots" content="noindex">'}<link rel="canonical" href="/pricing"><title>Email API pricing</title>` })),
      ok("/compare", page({ path: "/compare" })),
    ]);
    expect(violations.filter((violation) => violation.rule === "rendered-robots-mismatch").map((violation) => violation.path)).toEqual([
      "/pricing",
      "/compare",
    ]);
  });

  it("requires a self-referencing canonical, compared by path so any host can serve the check", () => {
    const violations = checkRenderedContent(graph, [
      ok("/pricing", page({ path: "/pricing/" })),
      ok("/features", page({ path: "/pricing" })),
    ]);
    expect(violations.map((violation) => [violation.rule, violation.path])).toEqual([
      ["rendered-canonical-mismatch", "/features"],
    ]);
  });

  it("compares declared, response, and canonical paths in their URL-encoded form", () => {
    const encoded: SeoGraph = { nodes: new Map([["/café", node("/café")]]), edges: [] };
    const html = page({ path: "/caf%C3%A9", main: "<h1>Email API pricing</h1>" });
    expect(
      checkRenderedContent(encoded, [{ path: "/café", ok: true, finalPath: "/caf%C3%A9", html }]),
    ).toEqual([]);
  });

  it("applies the highest matching word floor and rejects a floor that matches nothing", () => {
    const violations = checkRenderedContent(graph, [ok("/pricing", page({}))], {
      minWords: [
        { path: "/**", minWords: 2 },
        { path: "/pricing", minWords: 50 },
        { path: "/nowhere/*", minWords: 10 },
      ],
    });
    expect(violations.map((violation) => violation.rule)).toEqual(["content-rule-unmatched", "thin-content"]);
    expect(violations[1]?.message).toBe("Main content has 6 words (min 50).");
  });
});
