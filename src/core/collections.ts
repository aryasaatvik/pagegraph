/**
 * Content collections — pages a param route renders from content (MDX, a CMS,
 * a manifest) — in the shape the graph reads. Works with any source whose
 * pages carry a URL, which covers Fumadocs `loader().getPages()` directly.
 */

import type { PublicPath } from "./declare";
import type { SeoCollection, SeoEdge, SeoInstance, SeoSource } from "./graph";

/** What a page contributes: its instance metadata plus the paths it links to deliberately. */
export interface ContentEntry extends Omit<SeoInstance, "path"> {
  /** Defaults to the page's `url`. */
  readonly path?: string | undefined;
  /** Deliberate cross-links, emitted as `related` edges from this page. */
  readonly related?: ReadonlyArray<string> | undefined;
}

export interface ContentCollectionOptions<Page> {
  /** The param route these pages render through, e.g. `/blog/$slug`. */
  readonly route: PublicPath;
  /** The `source` label stamped on every node, e.g. `"blog"`. */
  readonly source: SeoSource;
  readonly pages: ReadonlyArray<Page>;
  /** Map one page to its entry; decode frontmatter here. */
  readonly entry: (page: Page) => ContentEntry;
  /** Edges beyond `related` (crumb parents, collection membership). */
  readonly edges?: ReadonlyArray<SeoEdge> | undefined;
}

export function contentCollection<Page extends { readonly url: string }>(
  options: ContentCollectionOptions<Page>,
): SeoCollection {
  const entries = options.pages.map((page) => {
    const entry = options.entry(page);
    return { ...entry, path: entry.path ?? page.url };
  });
  return {
    route: options.route,
    source: options.source,
    instances: entries.map(({ related: _related, ...instance }) => instance),
    edges: [
      ...entries.flatMap((entry) =>
        [...new Set(entry.related ?? [])].map((to): SeoEdge => ({ from: entry.path, to, type: "related" })),
      ),
      ...(options.edges ?? []),
    ],
  };
}
