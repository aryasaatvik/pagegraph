import { readFile } from "node:fs/promises";

import type { SeoWorkflowContextConfig } from "../config";
import type { SeoGraph } from "../core/graph";
import { serializeGraph, serializeNode } from "../cli/serialize";
import type { WorkflowGraphNeighborhood, WorkflowId, WorkflowTargetOptions } from "./model";
import { resolveRepositoryReadPath, type RepositoryReadOptions } from "./repository-paths";

const matches = (value: string, pattern: string): boolean => {
  if (pattern === value) return true;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(value);
};

export const selectGraph = (graph: SeoGraph, options: WorkflowTargetOptions): SeoGraph => {
  const selected = [...graph.nodes.values()].filter(
    (node) =>
      (options.pages.length === 0 || options.pages.some((pattern) => matches(node.path, pattern))) &&
      (options.kinds.length === 0 || options.kinds.includes(node.kind)),
  );
  const paths = new Set(selected.slice(0, options.limit).map((node) => node.path));
  return {
    nodes: new Map(selected.slice(0, options.limit).map((node) => [node.path, node])),
    edges: graph.edges.filter((edge) => paths.has(edge.from) && paths.has(edge.to)),
    collisions: graph.collisions,
  };
};

const selectNeighborhood = (graph: SeoGraph, targetPaths: ReadonlySet<string>): WorkflowGraphNeighborhood => {
  const inbound: Array<WorkflowGraphNeighborhood["inbound"][number]> = [];
  const outbound: Array<WorkflowGraphNeighborhood["outbound"][number]> = [];

  for (const edge of graph.edges) {
    if (targetPaths.has(edge.to) && !targetPaths.has(edge.from)) {
      const node = graph.nodes.get(edge.from);
      if (node !== undefined) inbound.push({ edge, node: serializeNode(node) });
    }
    if (targetPaths.has(edge.from) && !targetPaths.has(edge.to)) {
      const node = graph.nodes.get(edge.to);
      if (node !== undefined) outbound.push({ edge, node: serializeNode(node) });
    }
  }

  return { inbound, outbound };
};

export const collectContextFiles = async (
  root: string,
  workflow: WorkflowId,
  context: SeoWorkflowContextConfig | undefined,
  readOptions?: RepositoryReadOptions,
): Promise<ReadonlyArray<{ readonly path: string; readonly content: string }>> => {
  const paths = [...(context?.files ?? []), ...(context?.byWorkflow?.[workflow] ?? [])];
  return Promise.all([...new Set(paths)].map(async (path) => ({
    path, content: await readFile(await resolveRepositoryReadPath(root, path, readOptions), "utf8"),
  })));
};

export const collectWorkflowEvidence = async (
  graph: SeoGraph,
  options: WorkflowTargetOptions,
  root: string,
  workflow: WorkflowId,
  context: SeoWorkflowContextConfig | undefined,
  readOptions?: RepositoryReadOptions,
) => {
  const selected = selectGraph(graph, options);
  return {
    graph: serializeGraph(selected),
    neighborhood: selectNeighborhood(graph, new Set(selected.nodes.keys())),
    sources: await collectContextFiles(root, workflow, context, readOptions),
  };
};
