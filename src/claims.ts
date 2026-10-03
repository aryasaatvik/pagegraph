import { resolve } from "node:path";

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { DecisionCacheInvalid } from "./decide/cache";

import type { PageHead } from "./core/page-heads";
import { claimsFamily, claimsInputs, resolveClaimsDocuments, type ClaimsOptions } from "./decide/families/claims";
import type { DecisionBatchReport } from "./decide/record";
import { DecisionCacheMiss, replayDecisions, runDecisions } from "./decide/run";
import type { PageDocument } from "./markdown/document";
import type { Facts } from "./markdown/facts";

export { claimsFamily, claimsInput, claimsInputs, resolveClaimsDocuments } from "./decide/families/claims";
export type { ClaimsInput, ClaimsOptions, ClaimsRules, ClaimsVerdict } from "./decide/families/claims";

export interface ClaimsFinding {
  readonly path: string;
  readonly section: string;
  readonly source: string;
  readonly rule: string;
  readonly probability: number;
}
export interface ClaimsReport {
  readonly version: 1;
  readonly mode: "ask" | "replay";
  readonly pages: number;
  readonly messages: number;
  readonly cached: number;
  readonly asked: number;
  readonly cutoff: number;
  readonly findings: ReadonlyArray<ClaimsFinding>;
}
export class ClaimsFailed extends Data.TaggedError("ClaimsFailed")<{
  readonly message: string;
  readonly findings: ReadonlyArray<ClaimsFinding>;
  readonly report: ClaimsReport;
}> {}

/** Cutoff affects verdicts alone; committed identity belongs to the decision runner. */
export function claimsRunOptions(
  root: string,
  documents: ReadonlyArray<PageDocument>,
  heads: ReadonlyArray<PageHead>,
  facts: Facts,
  options: ClaimsOptions,
) {
  const cutoff = options.cutoff ?? 0.8;
  if (!Number.isFinite(cutoff) || cutoff < 0 || cutoff > 1)
    throw new Error("Claims cutoff must be between 0 and 1");
  if (!options.model.trim()) throw new Error("Claims model is required");
  return {
    family: claimsFamily(options.rules),
    inputs: claimsInputs(documents, heads, facts, options),
    model: options.model,
    threshold: cutoff,
    cache: { directory: resolve(root, ".pagegraph/decisions/claims"), policy: "committed" as const },
  };
}
const ProbabilityAnswers = Schema.Record(Schema.String, Schema.Struct({ probability: Schema.Finite }));
function claimsReport(
  batch: DecisionBatchReport,
  documents: ReadonlyArray<PageDocument>,
  heads: ReadonlyArray<PageHead>,
  facts: Facts,
  options: ClaimsOptions,
  mode: ClaimsReport["mode"],
): ClaimsReport {
  const inputs = claimsInputs(documents, heads, facts, options);
  const sources = new Map(documents.map((document) => [document.path, document]));
  const records = [...batch.resolved, ...batch.review];
  const findings = records.flatMap((record): Array<ClaimsFinding> => {
    const index = Number(record.decisionId.slice("claims:".length));
    const input = inputs[index];
    if (input === undefined) throw new Error(`Unknown claims decision ${record.decisionId}`);
    return Object.entries(Schema.decodeUnknownSync(ProbabilityAnswers)(record.answers))
      .flatMap(([rule, answer]) => answer.probability >= batch.threshold ? [{
        path: input.path, section: input.section.id,
        source: sources.get(input.path)?.sections.find((section) => section.id === input.section.id)?.source ?? input.path,
        rule, probability: answer.probability,
      }] : []);
  });
  const asked = records.filter((record) => record.usage !== undefined).length;
  const resolved = resolveClaimsDocuments(documents, heads, options.excludeHeads);
  return {
    version: 1, mode, pages: resolved.length,
    messages: documents.reduce((count, document) => count + document.messages.length, 0),
    cached: records.length - asked, asked, cutoff: batch.threshold, findings,
  };
}

/** Ask only for absent answers unless refresh is requested, then persist committed answers. */
export const runClaims = Effect.fn("Claims.run")(function* (
  root: string,
  documents: ReadonlyArray<PageDocument>,
  heads: ReadonlyArray<PageHead>,
  facts: Facts,
  options: ClaimsOptions,
  runOptions: { readonly refresh?: boolean } = {},
) {
  const batch = yield* runDecisions({ ...claimsRunOptions(root, documents, heads, facts, options), ...runOptions });
  return claimsReport(batch, documents, heads, facts, options, "ask");
});

/** Offline gates have no model requirement; absent answers and violations fail with author guidance. */
export const replayClaims = Effect.fn("Claims.replay")(function* (
  root: string,
  documents: ReadonlyArray<PageDocument>,
  heads: ReadonlyArray<PageHead>,
  facts: Facts,
  options: ClaimsOptions,
) {
  const batch = yield* replayDecisions(claimsRunOptions(root, documents, heads, facts, options)).pipe(
    Effect.catchTag("DecisionCacheInvalid", (error) => Effect.fail(new DecisionCacheInvalid({
      file: error.file, message: `${error.message} Run pagegraph claims check --refresh and commit the answers.`,
    }))),
    Effect.catchTag("DecisionCacheMiss", (error) => Effect.fail(new DecisionCacheMiss({
      ...error,
      message: `No claims answer for ${error.inputRef} (rules: ${Object.keys(options.rules.decisions).join(", ")}). Run pagegraph claims check and commit the answers.`,
    }))),
  );
  const report = claimsReport(batch, documents, heads, facts, options, "replay");
  if (report.findings.length > 0) return yield* new ClaimsFailed({
    message: report.findings.map((finding) =>
      `Claims violation at ${finding.path} › ${finding.section}: ${finding.rule} (${finding.probability.toFixed(2)}).`,
    ).join("\n") + "\nRun pagegraph claims check and commit the answers.",
    findings: report.findings, report,
  });
  return report;
});
