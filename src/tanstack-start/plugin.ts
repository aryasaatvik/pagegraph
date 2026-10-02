/**
 * The `pagegraph()` Vite plugin for TanStack Start.
 *
 * The graph is built once per build (and on change in dev) inside the app's own
 * Vite pipeline, then shipped to the server runtime as `virtual:pagegraph/runtime`.
 * The Worker never rebuilds it and never imports build code.
 *
 * Route modules and content collections are evaluated in a dedicated Node
 * environment, `pagegraph`, that shares the app's plugins, aliases, and
 * `define`s. Two settings make that safe:
 * - its `resolve.noExternal` is cleared, so TanStack Start's packages load from
 *   node_modules, where their virtual router entry is an inert stub. Bundled (as
 *   the app's server bundles them), they would pull in the whole route tree.
 * - only route files that declare `staticData` are evaluated, one by one, never
 *   `routeTree.gen.ts`.
 *
 * Dev reuses the dev server's `pagegraph` environment. A build, the CLI, and
 * `loadPageHeads` resolve the app's Vite config in serve mode and create only
 * that environment ({@link evaluateAppGraph}), so there is one evaluation path.
 */

import {
  createRunnableDevEnvironment,
  type Plugin,
  type ResolvedConfig,
  type RunnableDevEnvironment,
  type ViteDevServer,
} from "vite";

import type { SeoGraph } from "../core/graph";
import { graphToJson } from "../core/wire";
import { seoRouteConfig } from "../vite/route-config";
import { evaluateGraph, type GraphModuleRunner, type PagegraphOptions, type SiteRuntime } from "./graph";
import { evaluateAppGraph } from "./load";

export const GRAPH_ENVIRONMENT = "pagegraph";
export const PLUGIN_NAME = "pagegraph";
const RUNTIME_ID = "virtual:pagegraph/runtime";
const RESOLVED_RUNTIME_ID = `\0${RUNTIME_ID}`;
/** The runtime entry imports the virtual module, so dep pre-bundling must leave it to this plugin. */
const RUNTIME_ENTRY = "pagegraph/tanstack-start/server";

export interface AppGraph {
  readonly graph: SeoGraph;
  readonly site: SiteRuntime;
}

/** What the plugin exposes to {@link evaluateAppGraph} through `plugin.api`. */
export interface PagegraphPluginApi {
  readonly options: PagegraphOptions;
  readonly evaluate: (runner: GraphModuleRunner, root: string) => Promise<AppGraph>;
}

const runtimeModule = ({ graph, site }: AppGraph): string =>
  `export const graph = ${JSON.stringify(graphToJson(graph))};\nexport const site = ${JSON.stringify(site)};\n`;

export function pagegraph(options: PagegraphOptions): Array<Plugin> {
  const api: PagegraphPluginApi = {
    options,
    evaluate: (runner, root) => evaluateGraph(runner, root, options),
  };
  let config: ResolvedConfig | undefined;
  let server: ViteDevServer | undefined;
  let current: Promise<AppGraph> | undefined;

  const graphPlugin: Plugin & { api: PagegraphPluginApi } = {
    name: PLUGIN_NAME,
    api,
    config(_, { command }) {
      // A build evaluates through evaluateAppGraph, which resolves the config in serve mode.
      if (command !== "serve") return;
      return {
        environments: {
          [GRAPH_ENVIRONMENT]: {
            consumer: "server",
            dev: { createEnvironment: (name, environmentConfig) => createRunnableDevEnvironment(name, environmentConfig) },
          },
        },
      };
    },
    configEnvironment(name, environmentConfig) {
      if (name === GRAPH_ENVIRONMENT) {
        environmentConfig.resolve ??= {};
        environmentConfig.resolve.noExternal = [];
        return;
      }
      environmentConfig.optimizeDeps ??= {};
      environmentConfig.optimizeDeps.exclude = [...(environmentConfig.optimizeDeps.exclude ?? []), RUNTIME_ENTRY];
    },
    configResolved(resolved) {
      config = resolved;
    },
    configureServer(devServer) {
      server = devServer;
      const routesDirectory = `${devServer.config.root}/${options.routesDirectory ?? "src/routes"}/`;
      devServer.watcher.on("all", (_event, file) => {
        const environment = devServer.environments[GRAPH_ENVIRONMENT];
        const evaluated = environment?.moduleGraph.getModulesByFile(file) !== undefined;
        if (!evaluated && !file.startsWith(routesDirectory)) return;
        current = undefined;
        for (const other of Object.values(devServer.environments)) {
          if (other.name === GRAPH_ENVIRONMENT) continue;
          const runtime = other.moduleGraph.getModuleById(RESOLVED_RUNTIME_ID);
          if (runtime !== undefined) void other.reloadModule(runtime);
        }
      });
    },
    resolveId: {
      filter: { id: /^virtual:pagegraph\/runtime$/ },
      handler: () => RESOLVED_RUNTIME_ID,
    },
    load: {
      filter: { id: /^\0virtual:pagegraph\/runtime$/ },
      async handler() {
        // A page evaluated for the graph may import the runtime; it never serves from it.
        if (this.environment.name === GRAPH_ENVIRONMENT) return "export const graph = null;\nexport const site = null;\n";
        current ??= acquire();
        return runtimeModule(await current);
      },
    },
  };

  const acquire = async (): Promise<AppGraph> => {
    if (config === undefined) throw new Error(`[${PLUGIN_NAME}] the graph was requested before Vite resolved its config`);
    if (server === undefined) {
      if (config.configFile === undefined) {
        throw new Error(`[${PLUGIN_NAME}] a build needs a Vite config file to evaluate the graph from`);
      }
      return evaluateAppGraph({ root: config.root, configFile: config.configFile, mode: config.mode });
    }
    const environment = server.environments[GRAPH_ENVIRONMENT] as RunnableDevEnvironment;
    // Re-evaluate from scratch: content and route modules may have changed.
    environment.runner.clearCache();
    return api.evaluate(environment.runner, config.root);
  };

  return options.routeConfig === undefined
    ? [graphPlugin]
    : [graphPlugin, seoRouteConfig({ ...options.routeConfig, routesDirectory: options.routesDirectory })];
}
