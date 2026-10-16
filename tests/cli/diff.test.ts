import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { AuditFinding, AuditReport } from "../../src/audit/model";

const cli = fileURLToPath(new URL("../../src/cli/bin.ts", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const report = (
  options: {
    readonly generatedAt?: string;
    readonly finding?: AuditFinding;
    readonly evidence?: unknown;
  } = {},
): AuditReport => {
  const findings = options.finding === undefined ? [] : [options.finding];
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? "2026-08-30T00:00:00.000Z",
    targets: ["https://example.test/"],
    results: [
      {
        scanner: "http",
        target: "https://example.test/",
        status: "ok",
        evidence: options.evidence ?? { totalMs: 10 },
        findings,
      },
    ],
    findings,
    warnings: [],
  };
};

const runDiff = (before: AuditReport | string, after: AuditReport | string, json = true) => {
  const directory = mkdtempSync(join(tmpdir(), "seo-diff-test-"));
  temporaryDirectories.push(directory);
  const beforePath = join(directory, "before.json");
  const afterPath = join(directory, "after.json");
  writeFileSync(beforePath, typeof before === "string" ? before : JSON.stringify(before));
  writeFileSync(afterPath, typeof after === "string" ? after : JSON.stringify(after));
  return spawnSync("bun", [cli, "diff", beforePath, afterPath, ...(json ? ["--json"] : [])], {
    encoding: "utf8",
    timeout: 10_000,
  });
};

const structuralFinding: AuditFinding = {
  scanner: "rules",
  target: "https://example.test/",
  severity: "structural",
  rule: "missing-canonical",
  message: "Page is missing a canonical URL.",
};

describe("seo diff", () => {
  it("emits unchanged JSON and exits zero for volatile evidence", () => {
    const result = runDiff(
      report({ evidence: { totalMs: 10 } }),
      report({
        generatedAt: "2026-08-30T00:05:00.000Z",
        evidence: { totalMs: 900 },
      }),
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      kind: "audit-diff",
      schemaVersion: 1,
      outcome: "unchanged",
      changes: [],
    });
  });

  it("prints the complete JSON diff before exiting one on regression", () => {
    const result = runDiff(report(), report({ finding: structuralFinding }));

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      outcome: "regressed",
      summary: { structuralRegressions: 1 },
    });
    expect(result.stderr).toContain("✗ 1 structural");
  });

  it("renders the human comparison on stdout", () => {
    const result = runDiff(report(), report({ finding: structuralFinding }), false);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("# SEO audit diff");
    expect(result.stdout).toContain("Outcome: regressed");
    expect(result.stdout).toContain("missing-canonical");
  });

  it("keeps invalid input off stdout", () => {
    const result = runDiff("not json", report());

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Invalid before report");
  });
});
