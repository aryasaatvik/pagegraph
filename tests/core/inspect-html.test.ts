import { describe, expect, it } from "@effect/vitest";

import { hasBlockingIssues, inspectHtml } from "../../src/core/inspect-html";

const ldJson = (value: unknown): string =>
  `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

const headDoc = (inner: string): string =>
  `<!doctype html><html><head>${inner}</head><body></body></html>`;

describe("inspectHtml", () => {
  it("extracts title, description, canonical, og, and twitter tags", () => {
    const html = headDoc(`
      <title>Pricing &amp; Plans</title>
      <meta name="description" content="Per-email pricing with no monthly minimums to start." />
      <link rel="canonical" href="https://example.com/pricing" />
      <meta property="og:title" content="Pricing" />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="robots" content="index, follow" />
    `);
    const report = inspectHtml("https://example.com/pricing", 200, html);
    expect(report.title).toBe("Pricing & Plans");
    expect(report.description).toBe("Per-email pricing with no monthly minimums to start.");
    expect(report.canonical).toBe("https://example.com/pricing");
    expect(report.og["og:title"]).toBe("Pricing");
    expect(report.twitter["twitter:card"]).toBe("summary_large_image");
    expect(report.robots).toBe("index, follow");
    expect(hasBlockingIssues(report)).toBe(false);
  });

  it("reports missing required tags as blocking issues", () => {
    const report = inspectHtml(
      "https://example.com/x",
      200,
      headDoc("<title>Only a title</title>"),
    );
    expect(report.issues).toContain("Missing meta description.");
    expect(report.issues).toContain("Missing canonical link.");
    expect(hasBlockingIssues(report)).toBe(true);
  });

  it("treats a non-2xx status as a blocking issue", () => {
    const report = inspectHtml("https://example.com/missing", 404, headDoc("<title>x</title>"));
    expect(report.issues).toContain("Fetch returned HTTP 404.");
  });

  it("validates an Article: missing datePublished is invalid", () => {
    const html = headDoc(
      `<title>Post</title><meta name="description" content="${"d".repeat(60)}"><link rel="canonical" href="/p">` +
        ldJson({ "@type": "Article", headline: "A headline" }),
    );
    const report = inspectHtml("https://example.com/p", 200, html);
    const article = report.jsonLd.find((block) => block.type === "Article");
    expect(article?.valid).toBe(false);
    expect(article?.errors.some((error) => error.includes("datePublished"))).toBe(true);
    expect(hasBlockingIssues(report)).toBe(true);
  });

  it("validates FAQPage (needs a Question) and BreadcrumbList (needs ≥2 items)", () => {
    const html = headDoc(
      ldJson({ "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Q?" }] }) +
        ldJson({ "@type": "BreadcrumbList", itemListElement: [{ name: "Home" }] }),
    );
    const report = inspectHtml("https://example.com/p", 200, html);
    expect(report.jsonLd.find((block) => block.type === "FAQPage")?.valid).toBe(true);
    expect(report.jsonLd.find((block) => block.type === "BreadcrumbList")?.valid).toBe(false);
  });

  it("reads a valid BreadcrumbList and an Article from a @graph array", () => {
    const html = headDoc(
      ldJson({
        "@graph": [
          { "@type": "BreadcrumbList", itemListElement: [{ name: "Home" }, { name: "Blog" }] },
          { "@type": "Article", headline: "H", datePublished: "2026-01-01" },
        ],
      }),
    );
    const report = inspectHtml("https://example.com/p", 200, html);
    expect(report.jsonLd.every((block) => block.valid)).toBe(true);
  });

  it("reports a JSON-LD parse error", () => {
    const html = headDoc(`<script type="application/ld+json">{ not json }</script>`);
    const report = inspectHtml("https://example.com/p", 200, html);
    expect(report.jsonLd[0]?.valid).toBe(false);
    expect(report.jsonLd[0]?.type).toBe("unparseable");
    expect(hasBlockingIssues(report)).toBe(true);
  });
});
