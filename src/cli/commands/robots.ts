import * as Effect from "effect/Effect";
import * as Command from "effect/cli/Command";

import { renderRobots } from "../../core/projections";
import { acquireLoadedGraph, loadSeoConfig } from "../load-config";
import { indexableFlag, originFlag, originOf, printText, SeoCliError } from "../output";

export const robotsCommand = Command.make("robots", {
  origin: originFlag,
  indexable: indexableFlag,
}).pipe(
  Command.withDescription("Render robots.txt from the graph (the exact server-route output)"),
  Command.withExamples([
    { command: "pagegraph robots", description: "The robots.txt, under the origin from pagegraph.config.ts" },
    {
      command: "pagegraph robots --origin https://preview.example.com --no-indexable",
      description: "Disallow-all with no Sitemap line — the preview posture",
    },
  ]),
  Command.withHandler(
    Effect.fnUntraced(function* ({ origin, indexable }) {
      const config = yield* loadSeoConfig;
      const loaded = yield* Effect.scoped(acquireLoadedGraph(config));
      const declared = config.disallow !== undefined || config.contentSignal !== undefined || config.directives !== undefined;
      if (declared && loaded.robots !== undefined) {
        return yield* new SeoCliError({
          message: "The graph loader supplies the robots policy; remove disallow, contentSignal, and directives from pagegraph.config.ts.",
        });
      }
      const policy = loaded.robots ?? config;
      yield* printText(
        renderRobots(loaded.graph, {
          origin: originOf(origin, config.origin),
          indexable,
          disallow: policy.disallow ?? [],
          contentSignal: policy.contentSignal,
          directives: policy.directives,
          transform: config.transform,
        }),
      );
    }),
  ),
);
