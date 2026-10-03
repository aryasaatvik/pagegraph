import * as Effect from "effect/Effect";
import * as Command from "effect/cli/Command";

import { renderRobots } from "../../core/projections";
import { acquireLoadedGraph, loadSeoConfig } from "../load-config";
import { indexableFlag, indexableOf, originFlag, originOf, printText } from "../output";

export const robotsCommand = Command.make("robots", {
  origin: originFlag,
  indexable: indexableFlag,
}).pipe(
  Command.withDescription("Render robots.txt from the graph (the exact server-route output)"),
  Command.withExamples([
    { command: "pagegraph robots", description: "The robots.txt, under the origin from the loaded graph" },
    {
      command: "pagegraph robots --origin https://preview.example.com --no-indexable",
      description: "Disallow-all with no Sitemap line — the preview posture",
    },
  ]),
  Command.withHandler(
    Effect.fnUntraced(function* ({ origin, indexable }) {
      const config = yield* loadSeoConfig;
      const loaded = yield* Effect.scoped(acquireLoadedGraph(config));
      yield* printText(
        renderRobots(loaded.graph, {
          origin: originOf(origin, loaded.site.origin),
          indexable: indexableOf(indexable, loaded.site.indexable),
          ...loaded.site.robots,
          transform: config.transform,
        }),
      );
    }),
  ),
);
