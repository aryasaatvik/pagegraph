/**
 * `pagegraph/config` — the `pagegraph` CLI's configuration surface.
 *
 * The CLI is a set of pure views over one graph, but *acquiring* that graph is
 * host knowledge: only the app knows where its graph module lives and what its
 * module needs to evaluate. So the app declares it once in a `pagegraph.config.ts` at
 * its root, which the CLI discovers from the working directory:
 *
 * ```ts
 * // pagegraph.config.ts
 * import { defineSeoConfig, viteGraphLoader } from "pagegraph/config";
 * import { routeConfig } from "./lib/route-config";
 *
 * export default defineSeoConfig({
 *   loadGraph: viteGraphLoader({
 *     root: import.meta.dirname,
 *     entry: "/lib/seo/graph.ts",
 *     site: { origin: "https://example.com", indexable: true, robots: { disallow: routeConfig.robotsExclusions } },
 *   }),
 * });
 * ```
 *
 * Nothing here imports Effect. The CLI needs it (an optional peer dependency),
 * but a config file must not: it is the app's file, and the app may not be an
 * Effect app.
 */

export type { GraphLoaderEnvironment, GraphLoaderInput, LoadedSeoGraph, SeoGraphLoader, SiteRuntime, ViteGraphLoaderOptions } from "./vite-graph-loader";
export { viteGraphLoader } from "./vite-graph-loader";

export { loadPageHeads } from "./page-heads";

import type { CoverageRule } from "../core/checks";
import type { ContentPolicy } from "../core/content";
import type { FreshnessPolicy } from "../core/freshness";
import type { SeoGraphLoader } from "./vite-graph-loader";

export interface SeoWorkflowOpenCodeConfig {
  /** Project-owned OpenCode configuration directory, relative to the project root. */
  readonly configDirectory: string;
  /** Default `provider/model` used by agentic workflows. */
  readonly defaultModel: string;
  /** Per-workflow `provider/model` overrides. */
  readonly models?: Readonly<Record<string, string>> | undefined;
  /** Per-completion deadline in milliseconds, including JSON repair; defaults to 180000. */
  readonly timeoutMs?: number | undefined;
}

export interface SeoWorkflowContextConfig {
  /** Durable project context included in every workflow prompt. */
  readonly files?: ReadonlyArray<string> | undefined;
  /** Additional context files keyed by workflow id. */
  readonly byWorkflow?: Readonly<Record<string, ReadonlyArray<string>>> | undefined;
}

export interface SeoWorkflowConfig {
  readonly opencode: SeoWorkflowOpenCodeConfig;
  readonly context?: SeoWorkflowContextConfig | undefined;
  /** Ignored run-artifact directory, relative to the project root. */
  readonly runsDirectory?: string | undefined;
}

export interface SeoCliConfig {
  /**
   * Last-mile robots.txt override, forwarded to `renderRobots` as `transform`.
   * Runs for indexable and preview hosts.
   */
  readonly transform?: ((robots: string) => string) | undefined;
  /**
   * Contextual-link coverage policy for `pagegraph check`: every sitemap-eligible
   * page matching a rule's `path` glob needs at least `minInbound` incoming
   * `related` edges. A `--require-inbound` flag overrides this per invocation.
   */
  readonly coverage?: ReadonlyArray<CoverageRule> | undefined;
  /**
   * Rendered content policy for `pagegraph check --site`: word-count floors per
   * path glob. The heading, structured-data, robots, and canonical rules need no
   * configuration.
   */
  readonly content?: ContentPolicy | undefined;
  /**
   * Freshness policy: sitemap-eligible pages whose declared `modifiedAt` (or an
   * instance's `publishedAt`) is older than `maxAgeDays` are editorial
   * `stale-page` findings in `pagegraph check` and the refresh queue in
   * `pagegraph stale`.
   */
  readonly freshness?: FreshnessPolicy | undefined;
  /** Agentic workflow host, context, and artifact settings. */
  readonly workflows?: SeoWorkflowConfig | undefined;
  /** How the CLI gets the graph. {@link viteGraphLoader} covers the Vite-app case. */
  readonly loadGraph: SeoGraphLoader;
}

/** Identity — it exists for the type inference and the editor completions. */
export const defineSeoConfig = (config: SeoCliConfig): SeoCliConfig => config;
