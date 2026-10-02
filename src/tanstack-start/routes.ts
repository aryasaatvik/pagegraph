/**
 * Route discovery for the graph: the router's own generator parses the routes
 * directory (the same parse `routeTree.gen.ts` comes from), into memory only.
 */

import { resolve } from "node:path";

import { Generator, getConfig, type RouteNode } from "@tanstack/router-generator";

import { inMemoryWriteFs } from "../vite/route-config";

export interface ScannedRoutes {
  /** `__root.tsx`. */
  readonly root: RouteNode;
  /** Top-level route nodes, each with its `children`. */
  readonly tree: ReadonlyArray<RouteNode>;
  /** Every route node, flat. */
  readonly nodes: ReadonlyArray<RouteNode>;
}

export async function scanRoutes(root: string, routesDirectory: string): Promise<ScannedRoutes> {
  const cacheDirectory = resolve(root, "node_modules/.cache/pagegraph");
  let scanned: ScannedRoutes | undefined;
  const config = getConfig(
    {
      routesDirectory: resolve(root, routesDirectory),
      generatedRouteTree: resolve(cacheDirectory, "route-tree.gen.ts"),
      tmpDir: resolve(cacheDirectory, "tmp"),
      disableTypes: true,
      enableRouteTreeFormatting: false,
      disableLogging: true,
      plugins: [
        {
          name: "pagegraph:scan",
          onRouteTreeChanged({ routeTree, routeNodes, rootRouteNode }) {
            scanned = { root: rootRouteNode, tree: routeTree, nodes: routeNodes };
          },
        },
      ],
    },
    root,
  );
  const memory = inMemoryWriteFs(config.generatedRouteTree);
  await new Generator({ config, root, fs: memory.fs }).run();
  if (scanned === undefined) {
    throw new Error(`pagegraph found no route tree in ${resolve(root, routesDirectory)}`);
  }
  return scanned;
}
