import { contentCollection } from "pagegraph";

import { docsEntries } from "./docs-source";

/** Docs pages render through /docs/$; /docs itself is its own route. */
export const collections = () => {
  const pages = docsEntries().filter((entry) => entry.url !== "/docs");
  return [
    contentCollection({
      route: "/docs/$",
      source: "docs",
      pages,
      entry: (entry) => ({
        title: entry.title,
        description: entry.description,
        related: entry.related,
      }),
      edges: pages.flatMap((entry) =>
        entry.parent === undefined
          ? []
          : [{ from: entry.url, to: entry.parent, type: "crumb-parent" as const }],
      ),
    }),
  ];
};
