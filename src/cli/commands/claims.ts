import { TypeSafeClient, TypeSafeDecisionModel } from "@effect/ai-typesafe";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Command from "effect/cli/Command";
import * as Flag from "effect/cli/Flag";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import { replayClaims, runClaims, type ClaimsReport } from "../../claims";
import { readMarkdownCapture } from "../../markdown/documents";
import { loadPagegraphFacts, loadPagegraphOptions } from "../../tanstack-start/load";
import { jsonFlag, printJson, printText, SeoCliError } from "../output";
import { cliOperation, devFlag, findViteRoot, markdownCapture, markdownSettings } from "./markdown";

export function renderClaimsReport(report: ClaimsReport): string {
  return [
    `Checked ${report.pages} page(s) · ${report.messages} messages · ${report.cached} cached · ${report.asked} asked`,
    ...report.findings.map((finding) => `${finding.path} › ${finding.section} · ${finding.rule} ${finding.probability.toFixed(2)} · ${finding.source}`),
    `${report.findings.length} violation(s) at or above ${report.cutoff}.`,
  ].join("\n");
}

/** An app without a Vite config retains the standalone graph-only check contract. */
export const replayConfiguredClaims = Effect.fn("CLI.replayConfiguredClaims")(function* () {
  const root = findViteRoot();
  if (root === undefined) return undefined;
  const options = yield* cliOperation(() => loadPagegraphOptions({ root }));
  if (options.claims === undefined) return undefined;
  if (options.markdown === undefined)
    return yield* new SeoCliError({ message: "Claims require markdown capture in pagegraph() in the Vite config." });
  const markdown = options.markdown;
  const capture = yield* cliOperation(() => readMarkdownCapture(root, markdown.origin));
  const facts = yield* cliOperation(() => loadPagegraphFacts({ root }));
  return yield* replayClaims(root, capture.documents, capture.heads, facts, options.claims).pipe(
    Effect.catchTag("ClaimsFailed", (error) => Effect.succeed(error.report)),
    Effect.mapError((error) => new SeoCliError({ message: error.message })),
  );
});

const checkCommand = Command.make("check", {
  refresh: Flag.Boolean("refresh").pipe(Flag.withDefault(false), Flag.withDescription("Ask again and replace every committed answer")),
  dev: devFlag, json: jsonFlag,
}).pipe(
  Command.withDescription("Check authored claims; ask the configured model only for cache misses"),
  Command.withHandler(Effect.fnUntraced(function* ({ refresh, dev, json }) {
    const { root, options, markdown } = yield* markdownSettings();
    const claims = options.claims;
    if (claims === undefined)
      return yield* new SeoCliError({ message: "Claims are not configured in pagegraph() in the Vite config." });
    const capture = yield* markdownCapture(root, markdown.origin, dev);
    const facts = yield* cliOperation(() => loadPagegraphFacts({ root }));
    const ask = Effect.suspend(() => {
      const id = claims.model.startsWith("typesafe/") ? claims.model.slice("typesafe/".length) : claims.model;
      const layer = TypeSafeDecisionModel.model(id === "jev" ? "jev-latest" : id).pipe(
        Layer.provide(TypeSafeClient.layerConfig()), Layer.provide(FetchHttpClient.layer),
      );
      return runClaims(root, capture.documents, capture.heads, facts, claims, { refresh }).pipe(Effect.provide(layer));
    });
    const report = yield* (refresh ? ask : replayClaims(root, capture.documents, capture.heads, facts, claims).pipe(
      Effect.catchTag("ClaimsFailed", (error) => Effect.succeed(error.report)),
      Effect.catchTag("DecisionCacheMiss", () => ask),
    )).pipe(Effect.mapError((error) => new SeoCliError({ message: String(error) })));
    yield* json ? printJson(report) : printText(renderClaimsReport(report));
    if (report.findings.length > 0)
      return yield* new SeoCliError({ message: `${report.findings.length} claims violation(s); see the report above. Run pagegraph claims check after correcting the claims.` });
  })),
);

export const claimsCommandGroup = Command.make("claims").pipe(
  Command.withDescription("Validate authored claims with committed decision answers"),
  Command.withSubcommands([checkCommand]),
);
