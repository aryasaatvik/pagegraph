/**
 * The graph as JSON, for shipping a build-time graph to a runtime that cannot
 * rebuild it (a Worker serving sitemap.xml). Node order is preserved — the
 * sitemap lists collection instances in collection order — and a function
 * `crumb` (render-time only) is dropped.
 */

import type { SeoEdge, SeoGraph, SeoNode, SeoSource } from "./graph";

export interface SeoGraphJson {
  readonly nodes: ReadonlyArray<SeoNode>;
  readonly edges: ReadonlyArray<SeoEdge>;
  readonly collisions?: ReadonlyArray<{ readonly path: string; readonly sources: ReadonlyArray<SeoSource> }> | undefined;
}

export function graphToJson(graph: SeoGraph): SeoGraphJson {
  return {
    nodes: [...graph.nodes.values()].map((node) => ({
      ...node,
      // `node.head` carries the head as data; the declaration's render-only
      // fields (JSON-LD, Open Graph overrides) stay in the route module.
      policy: {
        ...node.policy,
        crumb: typeof node.policy.crumb === "function" ? undefined : node.policy.crumb,
        head: undefined,
      },
    })),
    edges: graph.edges,
    collisions: graph.collisions,
  };
}

export function graphFromJson(json: SeoGraphJson): SeoGraph {
  return {
    nodes: new Map(json.nodes.map((node) => [node.path, node])),
    edges: [...json.edges],
    collisions: json.collisions,
  };
}
