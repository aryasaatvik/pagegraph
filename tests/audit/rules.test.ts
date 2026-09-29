import { describe, expect, it } from "vitest";

import { evaluateRules, pageRules } from "../../src/audit/rules";
import { extractDocumentSignals } from "../../src/audit/scanners/http";
import type { AuditOptions } from "../../src/audit/model";
import type { ScannerInput, ScannerObservation } from "../../src/audit/scanner";

const input = (options: AuditOptions = {}): ScannerInput => ({
  target: { url: "https://example.test/docs" },
  options,
});

const observation = (evidence: unknown): ScannerObservation => ({ evidence });

describe("SEO audit page rules", () => {
  it("evaluates title, description, canonical, and status as pure findings", () => {
    const findings = evaluateRules(
      pageRules,
      observation({
        status: 200,
        title: "Docs",
        description: "Short",
      }),
      input({
        policy: {
          titleMinLength: 10,
          descriptionMinLength: 10,
          requireCanonical: true,
        },
      }),
    );

    expect(findings).toEqual([
      expect.objectContaining({ rule: "title-length", severity: "editorial" }),
      expect.objectContaining({
        rule: "description-length",
        severity: "editorial",
      }),
      expect.objectContaining({
        rule: "missing-canonical",
        severity: "structural",
      }),
    ]);
    expect(
      findings.every(
        (finding) => finding.target === "https://example.test/docs",
      ),
    ).toBe(true);
  });

  it("reports an HTTP failure without treating it as editorial copy feedback", () => {
    const findings = evaluateRules(
      pageRules,
      observation({
        status: 404,
        title: "Not found page",
        description: "A sufficiently long description for this fixture page.",
        canonical: "https://example.test/docs",
      }),
      input(),
    );

    expect(findings).toEqual([
      expect.objectContaining({
        rule: "http-status",
        severity: "structural",
        observed: 404,
      }),
    ]);
  });

  it("uses page evidence from a probe collection and validates the self-canonical", () => {
    const findings = evaluateRules(
      pageRules,
      observation([
        { kind: "page-head", status: 200 },
        {
          kind: "page-html",
          status: 404,
          finalUrl: "https://example.test/docs",
          document: {
            title: "A descriptive documentation page title",
            description:
              "A concise description that is long enough for the configured policy.",
            canonicalUrl: "https://example.test/other",
          },
        },
      ]),
      input(),
    );

    expect(findings).toEqual([
      expect.objectContaining({ rule: "http-status", observed: 404 }),
      expect.objectContaining({
        rule: "canonical-mismatch",
        severity: "structural",
      }),
    ]);
  });

  it("accepts nested document/head evidence and honors policy opt-outs", () => {
    const findings = evaluateRules(
      pageRules,
      observation({
        status: 200,
        document: {
          title: "A descriptive documentation page title",
          description:
            "A concise description that is long enough for the configured policy.",
          canonical: "https://example.test/docs",
        },
      }),
      input({
        policy: {
          titleMinLength: 10,
          descriptionMinLength: 10,
          requireCanonical: false,
        },
      }),
    );

    expect(findings).toEqual([]);
  });

  it("does not mutate evidence or input options", () => {
    const options: AuditOptions = {
      policy: { titleMinLength: 10, descriptionMinLength: 10 },
    };
    const evidence = { title: "Docs", description: "Short" };
    const beforeOptions = structuredClone(options);
    const beforeEvidence = structuredClone(evidence);

    evaluateRules(pageRules, observation(evidence), input(options));

    expect(options).toEqual(beforeOptions);
    expect(evidence).toEqual(beforeEvidence);
  });

  it("reports the rendered document's content findings through the http evidence", () => {
    const html =
      '<!doctype html><html><head><title>Docs home | Example</title><meta name="description" content="A concise description that is long enough for the configured policy."><link rel="canonical" href="https://example.test/docs"></head><body><main><h2>Docs</h2><h4>Start</h4><p>Four words of copy.</p></main></body></html>';
    const document = extractDocumentSignals(html, "text/html", new URL("https://example.test/docs"));
    expect(document.wordCount).toBe(6);
    expect(document.content?.outline.map((heading) => heading.level)).toEqual([2, 4]);

    const findings = evaluateRules(
      pageRules,
      observation([{ kind: "page-html", status: 200, finalUrl: "https://example.test/docs", document }]),
      input(),
    );
    expect(findings.map((finding) => [finding.scanner, finding.rule, finding.severity])).toEqual([
      ["rules", "missing-h1", "structural"],
      ["rules", "heading-level-skip", "editorial"],
    ]);
  });
});
