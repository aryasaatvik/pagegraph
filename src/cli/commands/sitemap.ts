import * as Effect from "effect/Effect";
import * as Command from "effect/cli/Command";

import { renderSitemap } from "../../core/projections";
import { acquireLoadedGraph, loadSeoConfig } from "../load-config";
import { indexableFlag, indexableOf, originFlag, originOf, printText } from "../output";

export const sitemapCommand = Command.make("sitemap", {
  origin: originFlag,
  indexable: indexableFlag,
}).pipe(
  Command.withDescription("Render sitemap.xml from the graph (the exact server-route output)"),
  Command.withExamples([
    {
      command: "pagegraph sitemap",
      description: "The sitemap XML, under the origin from the loaded graph",
    },
    {
      command: "pagegraph sitemap --origin https://preview.example.com --no-indexable",
      description: "Sitemap body is host-independent; robots.txt is what gates crawling",
    },
  ]),
  Command.withHandler(
    Effect.fnUntraced(function* ({ origin, indexable }) {
      const config = yield* loadSeoConfig;
      const loaded = yield* Effect.scoped(acquireLoadedGraph(config));
      yield* printText(
        renderSitemap(loaded.graph, {
          origin: originOf(origin, loaded.site.origin),
          indexable: indexableOf(indexable, loaded.site.indexable),
        }),
      );
    }),
  ),
);
