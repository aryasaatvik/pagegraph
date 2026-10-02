/**
 * Build the graph from the app's own modules, evaluated in the `pagegraph`
 * Vite environment: one module per route file that declares `staticData`, plus
 * the app's collections module. Never the route tree, which reaches every
 * route — including app routes that only resolve inside the server runtime.
 */

import { relative, resolve } from "node:path";

import type { RouteNode } from "@tanstack/router-generator";

import { globToRegExp } from "../core/checks";
import type { RouteSeo } from "../core/declare";
import { buildSeoGraph, type SeoCollection, type SeoGraph, type SeoRouteNode } from "../core/graph";
import type { RobotsConfig } from "../core/projections";
import { deriveRouteConfig, resolveOptions, type SeoRouteConfigOptions } from "../vite/route-config";
import { scanRoutes } from "./routes";

/** The robots.txt policy a build serves; `origin` and indexability come from {@link SiteRuntime}. */
export type RobotsPolicy = Pick<RobotsConfig, "disallow" | "contentSignal" | "directives">;

/** Site identity and robots policy, baked into the runtime module per build. */
export interface SiteRuntime {
  readonly origin: string;
  readonly indexable: boolean;
  readonly robots: RobotsPolicy;
}

export interface PagegraphOptions {
  /** This build's canonical origin, no trailing slash, e.g. `https://example.com`. */
  readonly origin: string;
  /**
   * Whether this build's host may be indexed. A non-indexable build serves a
   * disallow-all robots.txt with no Sitemap line. Defaults to `true`.
   */
  readonly indexable?: boolean | undefined;
  readonly robots?:
    | {
        /** Path prefixes disallowed on an indexable host, beyond the route-config exclusions. */
        readonly disallow?: ReadonlyArray<string> | undefined;
        /** `Content-Signal` value for an indexable host, e.g. `"search=yes, ai-input=yes, ai-train=yes"`. */
        readonly contentSignal?: string | undefined;
        /** Extra lines in the `User-agent: *` group on an indexable host. */
        readonly directives?: ReadonlyArray<string> | undefined;
      }
    | undefined;
  /**
   * Root-relative module whose `collections` export is a `SeoCollection[]`, or a
   * function returning one (sync or async). It runs in the app's Vite pipeline,
   * so content virtual modules (Fumadocs, MDX) and path aliases resolve.
   */
  readonly collections?: string | undefined;
  /**
   * Route files (globs relative to the routes directory) never evaluated for the
   * graph: app surfaces that declare `staticData` but import server-runtime-only
   * modules. Their paths stay out of the graph.
   */
  readonly exclude?: ReadonlyArray<string> | undefined;
  /** Relative to the Vite root. Defaults to `src/routes`. */
  readonly routesDirectory?: string | undefined;
  /**
   * Generate the route-config module and enforce per-group SEO coverage (the
   * `seoRouteConfig` gate). Its robots exclusions join `robots.disallow`.
   */
  readonly routeConfig?: Omit<SeoRouteConfigOptions, "routesDirectory"> | undefined;
}

/** Imports a module through the `pagegraph` environment's module runner. */
export interface GraphModuleRunner {
  import(url: string): Promise<Record<string, unknown>>;
}


const GRAPH_ROUTE_TYPES = new Set(["__root", "static", "layout", "pathless_layout"]);

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const routeStaticData = (module: Record<string, unknown>, file: string): SeoRouteNode["options"]["staticData"] => {
  const route = module["Route"] as { options?: { staticData?: { seo?: RouteSeo } } } | undefined;
  if (route?.options === undefined) throw new Error(`${file} has no \`Route\` export`);
  return route.options.staticData;
};

const loadCollections = async (runner: GraphModuleRunner, root: string, path: string): Promise<ReadonlyArray<SeoCollection>> => {
  const module = await runner.import(resolve(root, path)).catch((cause: unknown) => {
    throw new Error(`pagegraph could not evaluate ${path}: ${messageOf(cause)}`, { cause });
  });
  const exported = module["collections"];
  if (exported === undefined) throw new Error(`${path} has no \`collections\` export`);
  const collections: unknown = typeof exported === "function" ? await (exported as () => unknown)() : exported;
  if (!Array.isArray(collections)) throw new Error(`${path} \`collections\` must be an array or return one`);
  return collections as ReadonlyArray<SeoCollection>;
};

/** Evaluate route declarations and collections, then build the graph and the site runtime. */
export async function evaluateGraph(
  runner: GraphModuleRunner,
  root: string,
  options: PagegraphOptions,
): Promise<{ readonly graph: SeoGraph; readonly site: SiteRuntime }> {
  const routesDirectory = options.routesDirectory ?? "src/routes";
  const scan = await scanRoutes(root, routesDirectory);
  const excluded = (options.exclude ?? []).map(globToRegExp);
  const participates = (node: RouteNode): boolean =>
    GRAPH_ROUTE_TYPES.has(node._fsRouteType) &&
    (node._fsRouteType === "__root" || node.createFileRouteProps?.has("staticData") === true) &&
    !excluded.some((pattern) => pattern.test(node.filePath));

  const loaded = [scan.root, ...scan.nodes].filter(participates);
  const staticData = new Map(
    await Promise.all(
      loaded.map(async (node) => {
        const file = relative(root, node.fullPath);
        const module = await runner.import(node.fullPath).catch((cause: unknown) => {
          throw new Error(
            `pagegraph could not evaluate ${file} in the graph environment: ${messageOf(cause)}\n` +
              `If it is an app surface rather than a public page, add "${node.filePath}" to pagegraph({ exclude }).`,
            { cause },
          );
        });
        return [node.fullPath, routeStaticData(module, file)] as const;
      }),
    ),
  );

  const walkable = (node: RouteNode): SeoRouteNode => ({
    options: { path: node.isNonPath === true ? undefined : node.path, staticData: staticData.get(node.fullPath) },
    children: (node.children ?? []).map(walkable),
  });
  const routeTree: SeoRouteNode = {
    options: { staticData: staticData.get(scan.root.fullPath) },
    children: scan.tree.map(walkable),
  };

  const collections = options.collections === undefined ? [] : await loadCollections(runner, root, options.collections);
  const graph = buildSeoGraph({ routeTree, collections });

  const exclusions =
    options.routeConfig === undefined
      ? []
      : deriveRouteConfig(scan.nodes, resolveOptions({ ...options.routeConfig, routesDirectory })).robotsExclusions;
  const site: SiteRuntime = {
    origin: options.origin,
    indexable: options.indexable ?? true,
    robots: {
      disallow: [...new Set([...exclusions, ...(options.robots?.disallow ?? [])])].sort(),
      contentSignal: options.robots?.contentSignal,
      directives: options.robots?.directives,
    },
  };
  return { graph, site };
}
