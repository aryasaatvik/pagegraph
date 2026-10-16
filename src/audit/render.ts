import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AuditDiff, AuditDiffChange } from "./diff";
import type { AuditReport } from "./model";

const cell = (value: unknown): string =>
  String(value ?? "—")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");

export const renderAuditMarkdown = (report: AuditReport): string => {
  const structural = report.findings.filter((finding) => finding.severity === "structural");
  const editorial = report.findings.filter((finding) => finding.severity === "editorial");
  const lines = [
    "# SEO audit",
    "",
    `Generated: ${report.generatedAt}`,
    `Targets: ${report.targets.length} · Structural: ${structural.length} · Editorial: ${editorial.length}`,
    "",
    "## Scanner results",
    "",
    "| Scanner | Target | Status | Findings |",
    "| --- | --- | --- | ---: |",
    ...report.results.map(
      (result) =>
        `| ${cell(result.scanner)} | ${cell(result.target)} | ${cell(result.status)} | ${result.findings.length} |`,
    ),
  ];

  if (report.findings.length > 0) {
    lines.push(
      "",
      "## Findings",
      "",
      "| Severity | Rule | Target | Finding |",
      "| --- | --- | --- | --- |",
      ...report.findings.map(
        (finding) =>
          `| ${cell(finding.severity)} | ${cell(finding.rule)} | ${cell(finding.target)} | ${cell(finding.message)} |`,
      ),
    );
  }

  if (report.warnings.length > 0) {
    lines.push("", "## Warnings", "", ...report.warnings.map((warning) => `- ${warning}`));
  }

  return `${lines.join("\n")}\n`;
};

const renderDiffChange = (change: AuditDiffChange): string => {
  switch (change._tag) {
    case "FindingAdded":
      return `+ [${change.group.severity}] ${change.group.rule} · ${change.group.target} (${change.group.scanner})`;
    case "FindingRemoved":
      return `- [${change.group.severity}] ${change.group.rule} · ${change.group.target} (${change.group.scanner})`;
    case "FindingChanged":
      return `~ [${change.beforeSeverity} → ${change.afterSeverity}] ${change.rule} · ${change.target} (${change.scanner})`;
    case "ScannerDegraded":
      return `✗ scanner ${change.scanner} degraded · ${change.target}`;
    case "ScannerRecovered":
      return `✓ scanner ${change.scanner} recovered · ${change.target}`;
    case "TargetAdded":
      return `+ target coverage · ${change.target}`;
    case "TargetRemoved":
      return `- target coverage · ${change.target}`;
    case "ScannerAdded":
      return `+ scanner coverage ${change.scanner} (${change.status}) · ${change.target}`;
    case "ScannerRemoved":
      return `- scanner coverage ${change.scanner} · ${change.target}`;
  }
};

const diffSection = (
  title: string,
  changes: ReadonlyArray<AuditDiffChange>,
): ReadonlyArray<string> =>
  changes.length === 0 ? [] : ["", `## ${title}`, "", ...changes.map(renderDiffChange)];

/** Human-readable rendering of the semantic comparison contract. */
export const renderAuditDiff = (diff: AuditDiff): string => {
  const regressions: AuditDiffChange[] = [];
  const editorial: AuditDiffChange[] = [];
  const improvements: AuditDiffChange[] = [];
  const informational: AuditDiffChange[] = [];

  for (const change of diff.changes) {
    switch (change._tag) {
      case "FindingAdded":
        if (change.group.severity === "structural") regressions.push(change);
        else editorial.push(change);
        break;
      case "FindingChanged":
        if (change.beforeSeverity === "editorial" && change.afterSeverity === "structural") {
          regressions.push(change);
        } else if (change.beforeSeverity === "structural" && change.afterSeverity === "editorial") {
          improvements.push(change);
        } else {
          informational.push(change);
        }
        break;
      case "ScannerDegraded":
      case "TargetRemoved":
      case "ScannerRemoved":
        regressions.push(change);
        break;
      case "FindingRemoved":
      case "ScannerRecovered":
        improvements.push(change);
        break;
      case "TargetAdded":
        informational.push(change);
        break;
      case "ScannerAdded":
        if (change.status === "error") regressions.push(change);
        else informational.push(change);
        break;
    }
  }

  const symbol = diff.outcome === "regressed" ? "✗" : diff.outcome === "changed" ? "!" : "✓";
  const lines = [
    "# SEO audit diff",
    "",
    `${symbol} Outcome: ${diff.outcome}`,
    `Before: ${diff.before.generatedAt} · ${diff.before.targets.length} target(s)`,
    `After: ${diff.after.generatedAt} · ${diff.after.targets.length} target(s)`,
  ];

  if (diff.changes.length === 0) {
    lines.push("", "No semantic changes. Volatile scanner evidence was ignored.");
  } else {
    lines.push(
      ...diffSection("Regressions", regressions),
      ...diffSection("Editorial changes", editorial),
      ...diffSection("Improvements", improvements),
      ...diffSection("Other changes", informational),
    );
  }

  lines.push(
    "",
    `Ignored: ${diff.ignored.join(", ")}`,
    "",
    `Summary: ${diff.summary.structuralRegressions} structural · ${diff.summary.editorialRegressions} editorial · ${diff.summary.scannerRegressions} scanner · ${diff.summary.coverageRegressions} coverage regression(s)`,
  );
  return `${lines.join("\n")}\n`;
};

const atomicWrite = async (path: string, contents: string): Promise<void> => {
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, path);
};

export const writeAuditFiles = async (
  report: AuditReport,
  outputDirectory: string,
): Promise<{ readonly json: string; readonly markdown: string }> => {
  await mkdir(outputDirectory, { recursive: true });
  const stamp = report.generatedAt.replaceAll(":", "-");
  const json = join(outputDirectory, `${stamp}.json`);
  const markdown = join(outputDirectory, `${stamp}.md`);
  await Promise.all([
    atomicWrite(json, `${JSON.stringify(report, null, 2)}\n`),
    atomicWrite(markdown, renderAuditMarkdown(report)),
  ]);
  return { json, markdown };
};
