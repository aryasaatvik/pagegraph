import { describe, expect, it } from "vitest";

import { AuditComparisonResult, compareAuditReports } from "../../src/audit/diff";
import type { AuditFinding, AuditReport, ScannerResult } from "../../src/audit/model";

const finding = (severity: AuditFinding["severity"], rule = "fixture-rule"): AuditFinding => ({
  scanner: "rules",
  target: "https://example.test/",
  severity,
  rule,
  message: `${severity} fixture finding`,
});

const report = (
  options: {
    readonly generatedAt?: string;
    readonly targets?: ReadonlyArray<string>;
    readonly status?: ScannerResult["status"];
    readonly findings?: ReadonlyArray<AuditFinding>;
    readonly evidence?: unknown;
    readonly warnings?: ReadonlyArray<string>;
  } = {},
): AuditReport => {
  const findings = [...(options.findings ?? [])];
  const targets = [...(options.targets ?? ["https://example.test/"])];
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? "2026-08-30T00:00:00.000Z",
    targets,
    results: targets.map((target) => ({
      scanner: "http",
      target,
      status: options.status ?? "ok",
      evidence: options.evidence ?? { totalMs: 10 },
      findings: findings.filter((entry) => entry.target === target),
      ...(options.status === "error" ? { error: "fixture failed" } : {}),
    })),
    findings,
    warnings: [...(options.warnings ?? [])],
  };
};

const success = (before: AuditReport, after: AuditReport) => {
  const result = compareAuditReports(before, after);
  if (AuditComparisonResult.$is("InvalidReport")(result)) {
    throw new Error(result.issues.join("\n"));
  }
  return result.diff;
};

describe("audit report diff", () => {
  it("ignores timestamp, warning, evidence, and ordering volatility", () => {
    const before = report({
      generatedAt: "2026-08-30T00:00:00.000Z",
      targets: ["https://two.test/", "https://one.test/"],
      evidence: { totalMs: 10, headers: { server: "one" } },
      warnings: ["old diagnostic"],
    });
    const afterReport = report({
      generatedAt: "2026-08-30T00:05:00.000Z",
      targets: ["https://one.test/", "https://two.test/"],
      evidence: { totalMs: 900, headers: { server: "two" } },
      warnings: ["new diagnostic"],
    });
    const after = { ...afterReport, results: afterReport.results.toReversed() };

    expect(success(before, after)).toMatchObject({
      outcome: "unchanged",
      changes: [],
      before: { targets: ["https://one.test/", "https://two.test/"] },
      after: { targets: ["https://one.test/", "https://two.test/"] },
    });
  });

  it("fails only structural finding additions", () => {
    const editorial = success(report(), report({ findings: [finding("editorial")] }));
    expect(editorial).toMatchObject({
      outcome: "changed",
      summary: { editorialRegressions: 1, structuralRegressions: 0 },
    });

    const structural = success(report(), report({ findings: [finding("structural")] }));
    expect(structural).toMatchObject({
      outcome: "regressed",
      summary: { structuralRegressions: 1 },
    });
  });

  it("classifies severity escalation and recovery", () => {
    const escalated = success(
      report({ findings: [finding("editorial")] }),
      report({ findings: [finding("structural")] }),
    );
    expect(escalated).toMatchObject({
      outcome: "regressed",
      summary: { structuralRegressions: 1 },
      changes: [
        expect.objectContaining({
          _tag: "FindingChanged",
          beforeSeverity: "editorial",
          afterSeverity: "structural",
        }),
      ],
    });

    const recovered = success(report({ status: "error" }), report({ status: "ok" }));
    expect(recovered).toMatchObject({
      outcome: "changed",
      summary: { improvements: 1 },
      changes: [expect.objectContaining({ _tag: "ScannerRecovered" })],
    });
  });

  it("treats scanner degradation and lost coverage as regressions", () => {
    const degraded = success(report(), report({ status: "error" }));
    expect(degraded).toMatchObject({
      outcome: "regressed",
      summary: { scannerRegressions: 1 },
    });

    const removed = success(
      report({ targets: ["https://one.test/", "https://two.test/"] }),
      report({ targets: ["https://one.test/"] }),
    );
    expect(removed).toMatchObject({
      outcome: "regressed",
      summary: { coverageRegressions: 2 },
      changes: expect.arrayContaining([
        expect.objectContaining({ _tag: "TargetRemoved" }),
        expect.objectContaining({ _tag: "ScannerRemoved" }),
      ]),
    });
  });

  it("fails when newly added scanner coverage is already in error", () => {
    const after = report();
    const withFailedScanner = {
      ...after,
      results: [
        ...after.results,
        {
          scanner: "lighthouse",
          target: "https://example.test/",
          status: "error" as const,
          findings: [],
          error: "fixture lighthouse failed",
        },
      ],
    };

    expect(success(report(), withFailedScanner)).toMatchObject({
      outcome: "regressed",
      summary: { scannerRegressions: 1 },
      changes: [
        expect.objectContaining({
          _tag: "ScannerAdded",
          scanner: "lighthouse",
          status: "error",
        }),
      ],
    });
  });

  it("keeps same-severity finding payload changes non-blocking", () => {
    const before = {
      ...finding("editorial"),
      message: "Original editorial wording.",
      observed: { length: 8 },
    };
    const after = {
      ...finding("editorial"),
      message: "Updated editorial wording.",
      observed: { length: 9 },
    };

    expect(success(report({ findings: [before] }), report({ findings: [after] }))).toMatchObject({
      outcome: "changed",
      summary: { informationalChanges: 1 },
      changes: [expect.objectContaining({ _tag: "FindingChanged" })],
    });
  });

  it("rejects ambiguous and internally inconsistent reports", () => {
    const validDuplicate = report();
    const duplicate = {
      ...validDuplicate,
      results: [...validDuplicate.results, validDuplicate.results[0]!],
    };
    const validInconsistent = report({ findings: [finding("structural")] });
    const inconsistent = { ...validInconsistent, findings: [] };

    const result = compareAuditReports(duplicate, inconsistent);
    expect(result).toMatchObject({
      _tag: "InvalidReport",
      issues: expect.arrayContaining([
        expect.stringContaining("duplicate scanner result"),
        expect.stringContaining("top-level findings do not match"),
      ]),
    });
  });
});
