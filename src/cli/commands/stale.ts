import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { freshnessReport } from "../../core/freshness";
import { acquireGraph, loadSeoConfig } from "../load-config";
import { jsonFlag, printJson, printText, SeoCliError } from "../output";
import { renderFreshnessReport } from "../render";

const maxAgeDaysFlag = Flag.Int("max-age-days").pipe(
  Flag.withDescription("Days since the last declared change before a page is stale (default: freshness.maxAgeDays)"),
  Flag.optional,
);

export const staleCommand = Command.make("stale", {
  json: jsonFlag,
  maxAgeDays: maxAgeDaysFlag,
}).pipe(
  Command.withDescription(
    "List sitemap pages whose last declared change is older than the freshness policy, oldest first",
  ),
  Command.withExamples([
    { command: "pagegraph stale", description: "The refresh queue under seo.config.ts freshness" },
    {
      command: "pagegraph stale --max-age-days 90 --json",
      description: "Pages unchanged for 90 days, as JSON",
    },
  ]),
  Command.withHandler(
    Effect.fnUntraced(function* ({ json, maxAgeDays }) {
      const config = yield* loadSeoConfig;
      const limit = Option.getOrUndefined(maxAgeDays) ?? config.freshness?.maxAgeDays;
      if (limit === undefined) {
        return yield* new SeoCliError({
          message: "Pass --max-age-days or declare `freshness: { maxAgeDays }` in seo.config.ts.",
        });
      }
      if (!Number.isSafeInteger(limit) || limit <= 0) {
        return yield* new SeoCliError({ message: "--max-age-days must be a positive integer" });
      }
      const graph = yield* Effect.scoped(acquireGraph(config));
      const report = freshnessReport(graph, { maxAgeDays: limit }, new Date());
      if (json) yield* printJson(report);
      else yield* printText(renderFreshnessReport(report));
    }),
  ),
);
