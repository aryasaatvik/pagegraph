/**
 * SEO graph — the derived model that projections (sitemap, robots), the CLI, and
 * the check engine all read from. Built from route declarations (`staticData.seo`)
 * plus consumer-supplied content collections. This module is pure: no React, no
 * env, no knowledge of where instances come from. Origins and env-derived values
 * are injected by the callers of the projections, never read here.
 *
 * A node is one of:
 *  - a structural route (`source: "route"`), keyed by its normalized full path,
 *    merging a layout route's declaration (crumb) with its index child's (kind,
 *    sitemap policy) when both resolve to the same URL;
 *  - a content instance (`source` = the collection's label), keyed by the page URL
 *    and carrying page-level metadata.
 *
 * Edges: `crumb-parent` (breadcrumb ancestry), `related` (deliberate cross-links),
 * `collection-member` (membership in a curated set), and `redirect` (route aliases).
 * The route walk emits crumb/related/redirect edges from declarations; a collection
 * may declare any additional edges its instances need.
 */

import type { AnyRoute } from "@tanstack/react-router";

import { applyTitleTemplate, type PublicPath, type RouteSeo, type SeoKind } from "./declare";

/**
 * Where a node came from: `"route"` for a structural route declaration, or the
 * `source` label of the collection that produced the instance (e.g. "blog").
 */
export type SeoSource = string;

export interface SeoNode {
  /** Canonical path, no origin (e.g. "/pricing", "/blog/my-post"). */
  path: string;
  kind: SeoKind;
  source: SeoSource;
  /** Route-declared authored-document mode, inherited by collection instances. */
  markdown?: "rendered" | "source" | undefined;
  /** Group label for llms.txt, inherited by collection instances. */
  llms?: string | undefined;
  /** Route-declared policy, or synthesized (kind + inherited sitemap) for instances. */
  policy: RouteSeo;
  /**
   * The head the page ships: a static route's declared `head`, or an instance's
   * title (through its route's `titleTemplate`) and description. Absent when the
   * route computes its head at request time and no collection supplies it.
   */
  head?: SeoNodeHead | undefined;
  instance?:
    | {
        title: string;
        description?: string | undefined;
        publishedAt?: string | undefined;
        modifiedAt?: string | undefined;
      }
    | undefined;
}

/**
 * A node's head as graph data: the full title, description, and FAQ text. An
 * instance without a description still carries its title.
 */
export interface SeoNodeHead {
  readonly title: string;
  readonly description?: string | undefined;
  readonly faqs?: ReadonlyArray<{ readonly question: string; readonly answer: string }> | undefined;
}

export type SeoEdgeType = "crumb-parent" | "related" | "redirect" | "collection-member";

export interface SeoEdge {
  from: string;
  to: string;
  type: SeoEdgeType;
}

export interface SeoGraph {
  nodes: Map<string, SeoNode>;
  edges: Array<SeoEdge>;
  /** Exact-path ownership conflicts encountered while assembling graph sources. */
  collisions?: ReadonlyArray<{ path: string; sources: ReadonlyArray<SeoSource> }> | undefined;
}

/** One concrete page produced by a collection. */
export interface SeoInstance {
  /** Canonical path of the page (e.g. "/blog/my-post"). */
  readonly path: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly publishedAt?: string | undefined;
  readonly modifiedAt?: string | undefined;
}

export interface SeoCollection {
  /**
   * The param route these instances render through (e.g. "/blog/$slug"). Instances
   * inherit this route's declared policy (kind + sitemap) — the graph reads it from
   * the structural node, so declarations stay the single source of truth.
   */
  readonly route: PublicPath;
  /** The `source` stamped on every node this collection produces (e.g. "blog"). */
  readonly source: SeoSource;
  readonly instances: ReadonlyArray<SeoInstance>;
  /** Edges the collection declares between its instances and the rest of the graph. */
  readonly edges?: ReadonlyArray<SeoEdge> | undefined;
}

/**
 * The structural route shape the graph walks: a TanStack route tree has it
 * before `init()`, and an adapter can build it from parsed route files.
 */
export interface SeoRouteNode {
  readonly options: {
    readonly path?: string | undefined;
    readonly staticData?:
      | {
          readonly seo?: RouteSeo | undefined;
          readonly markdown?: SeoNode["markdown"];
          readonly llms?: SeoNode["llms"];
        }
      | undefined;
  };
  readonly children?: ReadonlyArray<SeoRouteNode> | undefined;
}

export interface BuildSeoGraphInput {
  readonly routeTree: AnyRoute | SeoRouteNode;
  readonly collections?: ReadonlyArray<SeoCollection> | undefined;
}

/** Kind for instances whose collection route carries no declaration to inherit. */
const FALLBACK_KIND: SeoKind = "page";


/**
 * Join a child's local path onto its parent's computed full path with the same
 * semantics as TanStack's route init (relative segments, index "/" inherits the
 * parent, pathless/group routes are transparent), then normalize trailing slashes.
 */
function joinPath(parent: string, seg: string | undefined): string {
  if (seg === undefined) return parent; // pathless layout / route group
  if (seg === "/") return parent; // index route resolves to its parent's URL
  const trimmed = seg.replace(/^\/+/, "").replace(/\/+$/, "");
  const joined = `${parent === "/" ? "" : parent}/${trimmed}`;
  return joined.replace(/\/{2,}/g, "/");
}

/** A route's declared head as graph data: templated title, description, and plain FAQs. */
function declaredHead(seo: RouteSeo): SeoNodeHead | undefined {
  if (seo.head === undefined) return undefined;
  return {
    title: applyTitleTemplate(seo.titleTemplate, seo.head.title),
    description: seo.head.description,
    faqs: seo.head.faqs?.map(({ question, answer }) => ({ question, answer })),
  };
}

/** Merge a route's declaration into an existing same-path node (deeper route wins). */
function mergeSeo(base: RouteSeo, override: RouteSeo): RouteSeo {
  return {
    kind: override.kind,
    crumb: override.crumb ?? base.crumb,
    sitemap: override.sitemap ?? base.sitemap,
    robots: override.robots ?? base.robots,
    related: override.related ?? base.related,
    link: override.link ?? base.link,
    redirectTo: override.redirectTo ?? base.redirectTo,
    modifiedAt: override.modifiedAt ?? base.modifiedAt,
    head: override.head ?? base.head,
    titleTemplate: override.titleTemplate ?? base.titleTemplate,
  };
}

/**
 * Walk the route tree building structural nodes and crumb-parent edges. `crumbStack`
 * holds the paths of crumb-declaring ancestors so each crumb node links to its nearest
 * crumb ancestor down the real route-parent chain (matching render-time breadcrumbs).
 */
function walkRoutes(
  route: SeoRouteNode,
  parentPath: string,
  isRoot: boolean,
  nodes: Map<string, SeoNode>,
  edges: Array<SeoEdge>,
  crumbStack: Array<string>,
): void {
  const path = isRoot ? "/" : joinPath(parentPath, route.options.path);
  const data = route.options.staticData;
  const seo = data?.seo;

  if (seo || data?.markdown !== undefined || data?.llms !== undefined) {
    const existing = nodes.get(path);
    if (existing) {
      if (seo) existing.policy = mergeSeo(existing.policy, seo);
      existing.kind = existing.policy.kind;
      // A head renders with its own route's template, never one merged from a layout.
      existing.head = (seo && declaredHead(seo)) ?? existing.head;
      existing.markdown = data?.markdown ?? existing.markdown;
      existing.llms = data?.llms ?? existing.llms;
    } else {
      const policy = seo ?? { kind: FALLBACK_KIND };
      nodes.set(path, {
        path,
        kind: policy.kind,
        source: "route",
        policy: { ...policy },
        head: seo && declaredHead(seo),
        markdown: data?.markdown,
        llms: data?.llms,
      });
    }

    const nearestCrumbAncestor = crumbStack[crumbStack.length - 1];
    if (seo?.crumb !== undefined && nearestCrumbAncestor !== undefined) {
      edges.push({ from: path, to: nearestCrumbAncestor, type: "crumb-parent" });
    }
  }

  const pushedCrumb = seo?.crumb !== undefined;
  if (pushedCrumb) crumbStack.push(path);
  for (const child of route.children ?? []) {
    walkRoutes(child, path, false, nodes, edges, crumbStack);
  }
  if (pushedCrumb) crumbStack.pop();
}

/**
 * Add one collection's instance nodes, inheriting kind + sitemap policy from the
 * collection route's declaration, then append the edges it declares. A path already
 * owned by another node is a collision: the first owner keeps the path and the
 * conflict is reported (the `path-owner-collision` check turns it into a violation).
 */
function addCollection(
  nodes: Map<string, SeoNode>,
  edges: Array<SeoEdge>,
  collisions: Array<{ path: string; sources: ReadonlyArray<SeoSource> }>,
  collection: SeoCollection,
): void {
  const collectionNode = nodes.get(collection.route);
  const kind = collectionNode?.kind ?? FALLBACK_KIND;
  const sitemap = collectionNode?.policy.sitemap;
  const titleTemplate = collectionNode?.policy.titleTemplate;

  /**
   * Paths this collection lost to an earlier owner. Their instances never enter
   * the graph, so any edge declared out of them would dangle — and the dead-edge
   * check only validates an edge's `to`, so nothing downstream would catch it.
   */
  const rejected = new Set<string>();

  for (const instance of collection.instances) {
    const existing = nodes.get(instance.path);
    if (existing) {
      collisions.push({ path: instance.path, sources: [existing.source, collection.source] });
      rejected.add(instance.path);
      continue;
    }
    nodes.set(instance.path, {
      path: instance.path,
      kind,
      source: collection.source,
      markdown: collectionNode?.markdown,
      llms: collectionNode?.llms,
      policy: { kind, sitemap },
      head: { title: applyTitleTemplate(titleTemplate, instance.title), description: instance.description },
      instance: {
        title: instance.title,
        description: instance.description,
        publishedAt: instance.publishedAt,
        modifiedAt: instance.modifiedAt,
      },
    });
  }

  for (const edge of collection.edges ?? []) {
    if (rejected.has(edge.from)) continue;
    edges.push(edge);
  }
}

/**
 * Build the SEO graph from route declarations and content collections.
 *
 * Synchronous: the caller materializes its collections before calling, so there is
 * no async work here. Callers own the origin.
 */
export function buildSeoGraph(input: BuildSeoGraphInput): SeoGraph {
  const nodes = new Map<string, SeoNode>();
  const edges: Array<SeoEdge> = [];
  const collisions: Array<{ path: string; sources: ReadonlyArray<SeoSource> }> = [];

  walkRoutes(input.routeTree as unknown as SeoRouteNode, "/", true, nodes, edges, []);

  for (const collection of input.collections ?? []) {
    addCollection(nodes, edges, collisions, collection);
  }

  for (const node of nodes.values()) {
    if (node.source !== "route") continue;
    for (const to of node.policy.related ?? []) {
      edges.push({ from: node.path, to, type: "related" });
    }
    if (node.policy.redirectTo !== undefined) {
      edges.push({ from: node.path, to: node.policy.redirectTo, type: "redirect" });
    }
  }

  return { nodes, edges, collisions };
}
