/**
 * Build the graph from the app's own modules, evaluated in the `pagegraph`
 * Vite environment: one module per route file that declares `staticData`, plus
 * the app's collections module. Never the route tree, which reaches every
 * route — including app routes that only resolve inside the server runtime.
 */

import { relative, resolve } from "node:path";

import type { ClaimsOptions } from "../decide/families/claims";

import type { RouteNode } from "@tanstack/router-generator";

import { globToRegExp } from "../core/checks";
import { buildSeoGraph, type SeoCollection, type SeoGraph, type SeoRouteNode } from "../core/graph";
import type { RobotsConfig } from "../core/projections";
import { deriveRouteConfig, resolveOptions, type SeoRouteConfigOptions } from "../vite/route-config";
import { scanRoutes, type ScannedRoutes } from "./routes";
import { decodeFacts, type Facts } from "../markdown/facts";

/** The robots.txt policy a build serves; `origin` and indexability come from {@link SiteRuntime}. */
export type RobotsPolicy = Pick<RobotsConfig, "disallow" | "contentSignal" | "directives">;

/** The graph and the site runtime one evaluation produces. */
export interface AppGraph {
  readonly graph: SeoGraph;
  readonly site: SiteRuntime;
  readonly markdown: { readonly origin: string } | null;
  readonly facts: Facts | undefined;
}

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
  /** Canonical origin for rendered documents; serverEntry is relative to the Vite root. */
  readonly markdown?: { readonly origin: string; readonly serverEntry?: string | undefined } | undefined;
  /** Committed claims answers gate the rendered documents and graph heads at build time. */
  readonly claims?: ClaimsOptions | undefined;
  /** Root-relative module exporting the code-owned document facts. */
  readonly facts?: string | undefined;
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
  const route = module["Route"] as { options?: SeoRouteNode["options"] } | undefined;
  if (route?.options === undefined) throw new Error(`${file} has no \`Route\` export`);
  const data = route.options.staticData;
  return data === undefined ? undefined : { seo: data.seo, markdown: data.markdown, llms: data.llms };
};

const loadCollections = async (
  runner: GraphModuleRunner,
  root: string,
  fullPath: string,
): Promise<ReadonlyArray<SeoCollection>> => {
  const path = relative(root, fullPath);
  const module = await runner.import(fullPath).catch((cause: unknown) => {
    throw new Error(`pagegraph could not evaluate ${path}: ${messageOf(cause)}`, { cause });
  });
  const exported = module["collections"];
  if (exported === undefined) throw new Error(`${path} has no \`collections\` export`);
  const collections: unknown = typeof exported === "function" ? await (exported as () => unknown)() : exported;
  if (!Array.isArray(collections)) throw new Error(`${path} \`collections\` must be an array or return one`);
  return collections as ReadonlyArray<SeoCollection>;
};

/** What one evaluation loads: the scanned route tree and the modules that feed the graph. */
export interface GraphPlan {
  readonly root: string;
  readonly options: PagegraphOptions;
  readonly scan: ScannedRoutes;
  /** Absolute paths of the route files that declare `staticData`, plus `__root`. */
  readonly routeFiles: ReadonlyArray<string>;
  /** Absolute path of the collections module, when configured. */
  readonly collectionsFile: string | undefined;
  readonly factsFile: string | undefined;
}

/** Scan the routes directory and pick the modules an evaluation loads. */
export async function planGraph(root: string, options: PagegraphOptions): Promise<GraphPlan> {
  const scan = await scanRoutes(root, options.routesDirectory ?? "src/routes");
  const excluded = (options.exclude ?? []).map(globToRegExp);
  const participates = (node: RouteNode): boolean =>
    GRAPH_ROUTE_TYPES.has(node._fsRouteType) &&
    (node._fsRouteType === "__root" || node.createFileRouteProps?.has("staticData") === true) &&
    !excluded.some((pattern) => pattern.test(node.filePath));
  return {
    root,
    options,
    scan,
    routeFiles: [scan.root, ...scan.nodes].filter(participates).map((node) => node.fullPath),
    collectionsFile: options.collections === undefined ? undefined : resolve(root, options.collections),
    factsFile: options.facts === undefined ? undefined : resolve(root, options.facts),
  };
}

/**
 * A route node's path relative to its parent, as the router matches it: route
 * groups, pathless layouts, and trailing underscores contribute no segment.
 */
const publicSegment = (node: RouteNode): string | undefined =>
  node.isNonPath === true || node.cleanedPath === undefined || node.cleanedPath === "" ? undefined : node.cleanedPath;

/** Evaluate a plan's modules through `runner`, then build the graph and the site runtime. */
export async function evaluateGraph(runner: GraphModuleRunner, plan: GraphPlan): Promise<AppGraph> {
  const { root, options, scan } = plan;
  const staticData = new Map(
    await Promise.all(
      plan.routeFiles.map(async (fullPath) => {
        const file = relative(root, fullPath);
        const routeFile = relative(resolve(root, options.routesDirectory ?? "src/routes"), fullPath);
        const module = await runner.import(fullPath).catch((cause: unknown) => {
          throw new Error(
            `pagegraph could not evaluate ${file} in the graph environment: ${messageOf(cause)}\n` +
              `If it is an app surface rather than a public page, add "${routeFile}" to pagegraph({ exclude }).`,
            { cause },
          );
        });
        return [fullPath, routeStaticData(module, file)] as const;
      }),
    ),
  );

  const walkable = (node: RouteNode): SeoRouteNode => ({
    options: { path: publicSegment(node), staticData: staticData.get(node.fullPath) },
    children: (node.children ?? []).map(walkable),
  });
  const routeTree: SeoRouteNode = {
    options: { staticData: staticData.get(scan.root.fullPath) },
    children: scan.tree.map(walkable),
  };

  const collections =
    plan.collectionsFile === undefined ? [] : await loadCollections(runner, root, plan.collectionsFile);
  const graph = buildSeoGraph({ routeTree, collections });

  const exclusions =
    options.routeConfig === undefined
      ? []
      : deriveRouteConfig(
          scan.nodes,
          resolveOptions({ ...options.routeConfig, routesDirectory: options.routesDirectory }),
        ).robotsExclusions;
  const site: SiteRuntime = {
    origin: options.origin,
    indexable: options.indexable ?? true,
    robots: {
      disallow: [...new Set([...exclusions, ...(options.robots?.disallow ?? [])])].sort(),
      contentSignal: options.robots?.contentSignal,
      directives: options.robots?.directives,
    },
  };
  let facts: Facts | undefined;
  if (plan.factsFile !== undefined) {
    const path = relative(root, plan.factsFile);
    try {
      const module = await runner.import(plan.factsFile);
      if (module["facts"] === undefined) throw new Error(`${path} has no \`facts\` export`);
      facts = decodeFacts(module["facts"]);
    } catch (cause) {
      throw new Error(`pagegraph could not evaluate ${path}: ${messageOf(cause)}`, { cause });
    }
  }
  return { graph, site, markdown: options.markdown === undefined ? null : { origin: options.markdown.origin }, facts };
}
