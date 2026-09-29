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

import type { PublicPath, RouteSeo, SeoKind } from "./declare";

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
  /** Route-declared policy, or synthesized (kind + inherited sitemap) for instances. */
  policy: RouteSeo;
  instance?:
    | {
        title: string;
        description?: string | undefined;
        publishedAt?: string | undefined;
        modifiedAt?: string | undefined;
      }
    | undefined;
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

export interface BuildSeoGraphInput {
  readonly routeTree: AnyRoute;
  readonly collections?: ReadonlyArray<SeoCollection> | undefined;
}

/** Kind for instances whose collection route carries no declaration to inherit. */
const FALLBACK_KIND: SeoKind = "page";

/** Structural view of a route we walk — the fields present before router init(). */
interface WalkableRoute {
  readonly options: {
    readonly path?: string | undefined;
    readonly staticData?: { readonly seo?: RouteSeo | undefined } | undefined;
  };
  readonly children?: ReadonlyArray<WalkableRoute> | undefined;
}

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
  };
}

/**
 * Walk the route tree building structural nodes and crumb-parent edges. `crumbStack`
 * holds the paths of crumb-declaring ancestors so each crumb node links to its nearest
 * crumb ancestor down the real route-parent chain (matching render-time breadcrumbs).
 */
function walkRoutes(
  route: WalkableRoute,
  parentPath: string,
  isRoot: boolean,
  nodes: Map<string, SeoNode>,
  edges: Array<SeoEdge>,
  crumbStack: Array<string>,
): void {
  const path = isRoot ? "/" : joinPath(parentPath, route.options.path);
  const seo = route.options.staticData?.seo;

  if (seo) {
    const existing = nodes.get(path);
    if (existing) {
      existing.policy = mergeSeo(existing.policy, seo);
      existing.kind = existing.policy.kind;
    } else {
      nodes.set(path, { path, kind: seo.kind, source: "route", policy: { ...seo } });
    }

    const nearestCrumbAncestor = crumbStack[crumbStack.length - 1];
    if (seo.crumb !== undefined && nearestCrumbAncestor !== undefined) {
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
      policy: { kind, sitemap },
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

  walkRoutes(input.routeTree as unknown as WalkableRoute, "/", true, nodes, edges, []);

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
