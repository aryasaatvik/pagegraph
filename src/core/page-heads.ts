import type { SeoImage } from "./declare";
import { globToRegExp } from "./checks";
import type { SeoGraph, SeoNode } from "./graph";

/** Plain document metadata, without framework or schema dependencies. */
export interface PageHead {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly image?: SeoImage | undefined;
}

export interface PageHeadsOptions {
  /** Path globs: `*` matches a segment, `**` matches across segments. */
  readonly exclude?: ReadonlyArray<string>;
  /** Exclude noindex pages and redirects. Parameter templates are always excluded. Defaults to true. */
  readonly indexable?: boolean;
}

/** Select page nodes before the host resolves metadata; sitemap-disabled hubs remain pages. */
export function selectPageHeadNodes(graph: SeoGraph, options: PageHeadsOptions = {}): Array<SeoNode> {
  const excludes = (options.exclude ?? []).map(globToRegExp);
  return [...graph.nodes.values()].filter((node) =>
    node.kind !== "layout" &&
    !node.path.includes("$") &&
    (node.policy.sitemap !== undefined || node.instance !== undefined) &&
    !excludes.some((pattern) => pattern.test(node.path)) &&
    (options.indexable === false || (
      node.policy.redirectTo === undefined &&
      !node.policy.robots?.toLowerCase().split(/[\s,]+/).includes("noindex")
    )),
  );
}

/** Extract resolved heads, naming the selected page when metadata is missing or blank. */
export function pageHeads(graph: SeoGraph, options: PageHeadsOptions = {}): Array<PageHead> {
  return selectPageHeadNodes(graph, options).map((node) => {
    const title = node.head?.title;
    const description = node.head?.description;
    if (!title?.trim()) throw new Error(`Invalid page head for ${node.path}: missing title`);
    if (!description?.trim()) throw new Error(`Invalid page head for ${node.path}: missing description`);
    return { path: node.path, title, description, ...(node.head?.image === undefined ? {} : { image: node.head.image }) };
  });
}
