import type { AuditFinding, AuditOptions } from "./model";
import type { ScannerInput, ScannerObservation, ScannerRule } from "./scanner";

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const stringAt = (value: unknown, ...keys: string[]): string | undefined => {
  let current: unknown = value;
  for (const key of keys) {
    const object = record(current);
    current = object?.[key];
  }
  return typeof current === "string" ? current : undefined;
};

const firstString = (
  value: unknown,
  paths: readonly (readonly string[])[],
): string | undefined => {
  for (const path of paths) {
    const found = stringAt(value, ...path);
    if (found !== undefined) return found;
  }
  return undefined;
};

const pageEvidence = (value: unknown): unknown => {
  if (!Array.isArray(value)) return value;
  return (
    value.find((entry) => stringAt(entry, "kind") === "page-html") ??
    value.find((entry) => stringAt(entry, "kind") === "page-head") ??
    value[0]
  );
};

const finding = (
  input: ScannerInput,
  rule: string,
  message: string,
  fix: string,
  observed?: unknown,
  severity: AuditFinding["severity"] = "structural",
): AuditFinding => ({
  scanner: "rules",
  target: input.target.url,
  severity,
  rule,
  message,
  fix,
  ...(observed === undefined ? {} : { observed }),
});

/** Generic page-quality rules. They accept the normalized evidence shape used
 * by HTTP and hosted scanners, while remaining pure and dependency-free. */
export const pageRules: readonly ScannerRule[] = [
  {
    id: "http-status",
    evaluate: (observation, input) => {
      const status = record(pageEvidence(observation.evidence))?.status;
      return typeof status === "number" && status >= 400
        ? [
            finding(
              input,
              "http-status",
              `Fetch returned HTTP ${status}.`,
              "Return a successful HTTP status.",
              status,
            ),
          ]
        : [];
    },
  },
  {
    id: "title-length",
    evaluate: (observation, input) => {
      const evidence = pageEvidence(observation.evidence);
      const title = firstString(evidence, [
        ["title"],
        ["document", "title"],
        ["head", "title"],
      ]);
      const policy = input.options.policy;
      const min = policy?.titleMinLength ?? 10;
      const max = policy?.titleMaxLength ?? 70;
      if (title === undefined || title.trim() === "") {
        return [
          finding(
            input,
            "missing-title",
            "Page is missing a usable title.",
            "Add a descriptive <title>.",
          ),
        ];
      }
      if (title.length < min || title.length > max) {
        return [
          finding(
            input,
            "title-length",
            `Title length ${title.length} is outside ${min}-${max} characters.`,
            `Keep the title between ${min} and ${max} characters.`,
            title,
            "editorial",
          ),
        ];
      }
      return [];
    },
  },
  {
    id: "description-length",
    evaluate: (observation, input) => {
      const evidence = pageEvidence(observation.evidence);
      const description = firstString(evidence, [
        ["description"],
        ["metaDescription"],
        ["document", "description"],
        ["head", "description"],
      ]);
      const policy = input.options.policy;
      const min = policy?.descriptionMinLength ?? 50;
      const max = policy?.descriptionMaxLength ?? 160;
      if (description === undefined || description.trim() === "") {
        return [
          finding(
            input,
            "missing-description",
            "Page is missing a meta description.",
            "Add a concise description that summarizes the page.",
          ),
        ];
      }
      if (description.length < min || description.length > max) {
        return [
          finding(
            input,
            "description-length",
            `Meta description length ${description.length} is outside ${min}-${max} characters.`,
            `Keep the meta description between ${min} and ${max} characters.`,
            description,
            "editorial",
          ),
        ];
      }
      return [];
    },
  },
  {
    id: "canonical",
    evaluate: (observation, input) => {
      if (input.options.policy?.requireCanonical === false) return [];
      const canonical = firstString(pageEvidence(observation.evidence), [
        ["canonical"],
        ["canonicalUrl"],
        ["document", "canonical"],
        ["document", "canonicalUrl"],
        ["head", "canonical"],
      ]);
      if (canonical === undefined) {
        return [
          finding(
            input,
            "missing-canonical",
            "Page is missing a canonical URL.",
            "Add a canonical link that identifies the preferred URL.",
          ),
        ];
      }
      try {
        const observed = new URL(canonical, input.target.url);
        const expected = new URL(
          firstString(pageEvidence(observation.evidence), [["finalUrl"]]) ??
            input.target.url,
        );
        observed.hash = "";
        expected.hash = "";
        return observed.href === expected.href
          ? []
          : [
              finding(
                input,
                "canonical-mismatch",
                `Canonical points to ${observed.href} instead of the audited URL.`,
                "Use a self-referencing canonical unless this page is intentionally consolidated.",
                observed.href,
              ),
            ];
      } catch {
        return [
          finding(
            input,
            "invalid-canonical",
            "Page canonical is not a valid URL.",
            "Use an absolute or resolvable canonical URL.",
            canonical,
          ),
        ];
      }
    },
  },
  {
    // Headings and structured-data-vs-visible-text findings, computed from the
    // rendered HTML by the same pure rules `pagegraph check --site` runs. The
    // word-count floor and declared-vs-rendered rules need the app's graph and
    // stay in `check`.
    id: "content",
    evaluate: (observation, input) => {
      const content = record(record(pageEvidence(observation.evidence))?.["document"])?.[
        "content"
      ];
      const list = record(content)?.["findings"];
      if (!Array.isArray(list)) return [];
      return list.flatMap((entry) => {
        const rule = stringAt(entry, "rule");
        const message = stringAt(entry, "message");
        const fix = stringAt(entry, "fix");
        const severity = stringAt(entry, "severity");
        if (rule === undefined || message === undefined || fix === undefined) return [];
        return [
          finding(
            input,
            rule,
            message,
            fix,
            undefined,
            severity === "editorial" ? "editorial" : "structural",
          ),
        ];
      });
    },
  },
];

export const evaluateRules = (
  rules: readonly ScannerRule[],
  observation: ScannerObservation,
  input: ScannerInput,
): readonly AuditFinding[] =>
  rules.flatMap((rule) => rule.evaluate(observation, input));

/** Default policy for a web-page audit. */
export const defaultAuditOptions: AuditOptions = {
  concurrency: 4,
  policy: {
    titleMinLength: 10,
    titleMaxLength: 70,
    descriptionMinLength: 50,
    descriptionMaxLength: 160,
    requireCanonical: true,
  },
};
