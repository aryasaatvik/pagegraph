/**
 * Evaluate an app's graph outside a running dev server — for a build, the
 * CLI (`pagegraph.config.ts`), and build-time head loading — through the same
 * `pagegraph` environment the dev server uses.
 */

import { createRunnableDevEnvironment, resolveConfig, type Plugin } from "vite";

import type { LoadedSeoGraph, SeoGraphLoader } from "../config/vite-graph-loader";
import { withCleanStdout } from "../config/vite-graph-loader";
import { evaluateGraph, planGraph, type AppGraph } from "./graph";
import type { PagegraphPluginApi } from "./plugin";

const GRAPH_ENVIRONMENT = "pagegraph";

export interface EvaluateAppGraphOptions {
  /** The app's Vite root. */
  readonly root: string;
  /** The app's Vite config file. Defaults to Vite's lookup from `root`. */
  readonly configFile?: string | undefined;
  /**
   * Vite mode the config is evaluated in. Origins and other build constants come
   * from it, so the CLI defaults to `production` to describe the deployed site.
   */
  readonly mode?: string | undefined;
}

const pluginApi = (plugins: ReadonlyArray<Plugin>, configFile: string | undefined): PagegraphPluginApi => {
  const plugin = plugins.find((candidate) => candidate.name === "pagegraph") as (Plugin & { api?: PagegraphPluginApi }) | undefined;
  if (plugin?.api === undefined) {
    throw new Error(`${configFile ?? "The Vite config"} does not register pagegraph() from "pagegraph/tanstack-start".`);
  }
  return plugin.api;
};

/**
 * Resolve the app's Vite config in serve mode, evaluate the graph in its
 * `pagegraph` environment, and release it — the dev server's evaluation path
 * without a server. A config that branches on `command` sees `serve`; pass
 * `mode` for the deployment the graph should describe.
 */
export async function evaluateAppGraph(options: EvaluateAppGraphOptions): Promise<AppGraph> {
  const config = await resolveConfig(
    { root: options.root, configFile: options.configFile, mode: options.mode, logLevel: "error" },
    "serve",
  );
  const api = pluginApi(config.plugins, config.configFile);
  const environment = createRunnableDevEnvironment(GRAPH_ENVIRONMENT, config, { hot: false });
  await environment.init();
  try {
    // Content plugins (Fumadocs, MDX) generate their virtual sources at buildStart.
    await environment.pluginContainer.buildStart({});
    return await evaluateGraph(environment.runner, await planGraph(config.root, api.options));
  } finally {
    await environment.close();
  }
}

/**
 * A `pagegraph.config.ts` graph loader for a TanStack Start app: the same graph the
 * `pagegraph()` plugin ships to the runtime, with its robots policy.
 *
 * ```ts
 * export default defineSeoConfig({
 *   origin: "https://example.com",
 *   loadGraph: tanstackStartGraph({ root: import.meta.dirname }),
 * });
 * ```
 */
export const tanstackStartGraph =
  (options: EvaluateAppGraphOptions): SeoGraphLoader =>
  async (): Promise<LoadedSeoGraph> => {
    const { graph, site } = await withCleanStdout(() =>
      evaluateAppGraph({ ...options, mode: options.mode ?? "production" }),
    );
    return { graph, robots: site.robots, dispose: async () => {} };
  };
