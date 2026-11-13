import { createServerFn } from "@tanstack/react-start";

/** One page of this site's SeoGraph, as the landing page's graph window draws it. */
export interface GraphViewNode {
  path: string;
  /** The shipped <title>, after any title template. */
  title: string;
  /** The page's own title, before the template. */
  heading: string;
  description: string | undefined;
  /** "route" for a static route's staticData.seo; a collection name for content pages. */
  source: string;
  crumb: string;
  parent: string | undefined;
  priority: number | undefined;
  lastmod: string | undefined;
  /** The Markdown twin the build serves for this page, when it declares one. */
  markdown: string | undefined;
}

export interface GraphView {
  origin: string;
  nodes: GraphViewNode[];
  related: Array<[from: string, to: string]>;
  crumbEdges: number;
}

/**
 * The graph PageGraph built for this deployment, projected for display: concrete pages in
 * depth-first breadcrumb order, crumb parents, and related edges. Read at prerender, so the
 * landing page ships the graph of the build that served it.
 */
export const getGraphView = createServerFn({ method: "GET" }).handler(
  async (): Promise<GraphView> => {
    // Imported here: route files are also evaluated by the graph build, where the runtime has no graph.
    const { seoGraph, seoSite } = await import("pagegraph/tanstack-start/server");
    const { docsEntries } = await import("./docs-source");
    // Collection policies carry no crumb; the docs page reads it from frontmatter, and so does this view.
    const docsCrumbs = new Map(docsEntries().map((entry) => [entry.url, entry.crumb]));
    const graph = seoGraph();
    const pages = [...graph.nodes.values()].filter(
      (node) => !node.path.includes("$") && node.policy.sitemap !== false && node.head?.title,
    );
    const known = new Set(pages.map((node) => node.path));
    const parentOf = new Map<string, string>();
    for (const edge of graph.edges)
      if (edge.type === "crumb-parent" && known.has(edge.from) && known.has(edge.to))
        parentOf.set(edge.from, edge.to);

    const children = new Map<string | undefined, string[]>();
    for (const node of pages) {
      const parent = parentOf.get(node.path);
      children.set(parent, [...(children.get(parent) ?? []), node.path]);
    }
    for (const list of children.values()) list.sort();
    const ordered: string[] = [];
    const walk = (path: string) => {
      ordered.push(path);
      for (const child of children.get(path) ?? []) walk(child);
    };
    for (const root of children.get(undefined) ?? []) walk(root);

    const nodes = ordered.map((path): GraphViewNode => {
      const node = graph.nodes.get(path)!;
      const sitemap = node.policy.sitemap === false ? undefined : node.policy.sitemap;
      const title = node.head?.title ?? path;
      const crumb =
        typeof node.policy.crumb === "string" ? node.policy.crumb : docsCrumbs.get(node.path);
      return {
        path,
        title,
        heading: node.instance?.title ?? title,
        description: node.head?.description,
        source: node.source,
        crumb: crumb ?? node.instance?.title ?? title,
        parent: parentOf.get(path),
        priority: sitemap?.priority,
        lastmod: node.instance?.modifiedAt ?? node.policy.modifiedAt,
        markdown:
          node.markdown === undefined ? undefined : path === "/" ? "/index.md" : `${path}.md`,
      };
    });
    const related = graph.edges
      .filter((edge) => edge.type === "related" && known.has(edge.from) && known.has(edge.to))
      .map((edge): [string, string] => [edge.from, edge.to]);
    return { origin: seoSite().origin, nodes, related, crumbEdges: parentOf.size };
  },
);
