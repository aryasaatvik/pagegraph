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
 * Dev imports those modules through the environment's module runner and
 * re-evaluates after a change reaches it. A build builds the environment first
 * (a `buildApp` hook that runs before the framework's) with the build's own
 * config and plugins, then imports the output. The CLI and `loadPageHeads` use
 * {@link evaluateAppGraph}, which runs the dev path without a server.
 */

import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createRunnableDevEnvironment,
  type BuildEnvironment,
  type Plugin,
  type RunnableDevEnvironment,
  type ViteBuilder,
  type ViteDevServer,
} from "vite";

import { graphToJson } from "../core/wire";
import { seoRouteConfig } from "../vite/route-config";
import { evaluateGraph, planGraph, type AppGraph, type GraphModuleRunner, type GraphPlan, type PagegraphOptions } from "./graph";

export const GRAPH_ENVIRONMENT = "pagegraph";
export const PLUGIN_NAME = "pagegraph";
const RUNTIME_ID = "virtual:pagegraph/runtime";
const RESOLVED_RUNTIME_ID = `\0${RUNTIME_ID}`;
const ENTRY_ID = "virtual:pagegraph/entry";
const RESOLVED_ENTRY_ID = `\0${ENTRY_ID}`;
/** The runtime entry imports the virtual module, so dep pre-bundling must leave it to this plugin. */
const RUNTIME_ENTRY = "pagegraph/tanstack-start/server";
/** Where a build writes the graph environment's output, relative to the Vite root. */
const BUILD_DIRECTORY = "node_modules/.cache/pagegraph/build";
/**
 * Runtime-provided modules (`cloudflare:workers`, `bun:sqlite`) stay external in
 * the graph build, so an unexcluded route that imports one fails at evaluation
 * with its file name rather than as an unresolved import.
 */
const RUNTIME_SCHEME = /^(?!node:|data:|file:|virtual:)[a-z][a-z0-9+.-]*:/;

/** What the plugin exposes to {@link evaluateAppGraph} through `plugin.api`. */
export interface PagegraphPluginApi {
  readonly options: PagegraphOptions;
}

const runtimeModule = ({ graph, site }: AppGraph): string =>
  `export const graph = ${JSON.stringify(graphToJson(graph))};\nexport const site = ${JSON.stringify(site)};\n`;

/** The graph environment's build entry: a loader per module the plan evaluates. */
const entryModule = (plan: GraphPlan): string => {
  const files = [...plan.routeFiles, ...(plan.collectionsFile === undefined ? [] : [plan.collectionsFile])];
  const loaders = files.map((file) => `  ${JSON.stringify(file)}: () => import(${JSON.stringify(file)}),`);
  return `export const modules = {\n${loaders.join("\n")}\n};\n`;
};

/** Build the graph environment with the build's config, import its output, and evaluate. */
const buildGraph = async (builder: ViteBuilder, environment: BuildEnvironment, plan: GraphPlan): Promise<AppGraph> => {
  await builder.build(environment);
  const entry = join(resolve(environment.config.root, environment.config.build.outDir), "entry.mjs");
  const { modules } = (await import(pathToFileURL(entry).href)) as {
    modules: Record<string, () => Promise<Record<string, unknown>>>;
  };
  const runner: GraphModuleRunner = {
    import: (file) => {
      const load = modules[file];
      if (load === undefined) throw new Error(`${file} is not in the graph build`);
      return load();
    },
  };
  return evaluateGraph(runner, plan);
};

export function pagegraph(options: PagegraphOptions): Array<Plugin> {
  const api: PagegraphPluginApi = { options };
  let root = "";
  let server: ViteDevServer | undefined;
  let devEnvironment: RunnableDevEnvironment | undefined;
  /** The plan the graph environment's build entry is generated from. */
  let buildPlan: GraphPlan | undefined;
  let current: Promise<AppGraph> | undefined;
  /** Bumped by every change that reaches the graph; an evaluation that spans one is discarded. */
  let generation = 0;

  const evaluateInDev = async (environment: RunnableDevEnvironment): Promise<AppGraph> => {
    for (;;) {
      const started = generation;
      // Re-evaluate from scratch: content and route modules may have changed.
      environment.runner.clearCache();
      const result = await evaluateGraph(environment.runner, await planGraph(root, options));
      if (started === generation) return result;
    }
  };

  const graphPlugin: Plugin & { api: PagegraphPluginApi } = {
    name: PLUGIN_NAME,
    api,
    // One instance across a build's environments: the graph built in buildApp
    // is the one every environment's runtime module serves.
    sharedDuringBuild: true,
    config() {
      return {
        environments: {
          [GRAPH_ENVIRONMENT]: {
            consumer: "server",
            dev: {
              createEnvironment: (name, environmentConfig) => createRunnableDevEnvironment(name, environmentConfig),
            },
            build: {
              outDir: BUILD_DIRECTORY,
              emptyOutDir: true,
              copyPublicDir: false,
              minify: false,
              rolldownOptions: {
                input: { entry: ENTRY_ID },
                output: { entryFileNames: "[name].mjs", chunkFileNames: "chunks/[name]-[hash].mjs" },
                external: (id) => RUNTIME_SCHEME.test(id),
              },
            },
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
      root = resolved.root;
    },
    configureServer(devServer) {
      server = devServer;
      devEnvironment = devServer.environments[GRAPH_ENVIRONMENT] as RunnableDevEnvironment | undefined;
    },
    // Runs after Vite invalidates the changed file in each environment, so the
    // next evaluation reads fresh modules.
    hotUpdate({ file, modules }) {
      if (this.environment.name !== GRAPH_ENVIRONMENT) return;
      const routesDirectory = resolve(root, options.routesDirectory ?? "src/routes");
      if (modules.length === 0 && !file.startsWith(`${routesDirectory}/`)) return;
      generation += 1;
      current = undefined;
      for (const other of Object.values(server?.environments ?? {})) {
        if (other.name === GRAPH_ENVIRONMENT) continue;
        const runtime = other.moduleGraph.getModuleById(RESOLVED_RUNTIME_ID);
        if (runtime !== undefined) void other.reloadModule(runtime);
      }
    },
    buildApp: {
      order: "pre",
      async handler(builder) {
        const environment = builder.environments[GRAPH_ENVIRONMENT];
        if (environment === undefined) return;
        buildPlan = await planGraph(environment.config.root, options);
        const built = buildGraph(builder, environment, buildPlan);
        current = built;
        await built;
        // Vite builds every environment when a build's app builder builds none;
        // the graph environment must not count, or a plain app would skip the rest.
        environment.isBuilt = false;
      },
    },
    resolveId: {
      filter: { id: /^virtual:pagegraph\/(runtime|entry)$/ },
      handler: (id) => `\0${id}`,
    },
    load: {
      filter: { id: /^\0virtual:pagegraph\/(runtime|entry)$/ },
      async handler(id) {
        if (id === RESOLVED_ENTRY_ID) {
          if (buildPlan === undefined) throw new Error(`[${PLUGIN_NAME}] ${ENTRY_ID} is only built by the pagegraph buildApp hook`);
          return entryModule(buildPlan);
        }
        // A page evaluated for the graph may import the runtime; it never serves from it.
        if (this.environment.name === GRAPH_ENVIRONMENT) return "export const graph = null;\nexport const site = null;\n";
        if (current === undefined) {
          if (devEnvironment === undefined) {
            throw new Error(
              `[${PLUGIN_NAME}] the graph was not built before ${this.environment.name} imported it; build with Vite's app builder (\`vite build\`).`,
            );
          }
          current = evaluateInDev(devEnvironment);
        }
        return runtimeModule(await current);
      },
    },
  };

  return options.routeConfig === undefined
    ? [graphPlugin]
    : [graphPlugin, seoRouteConfig({ ...options.routeConfig, routesDirectory: options.routesDirectory })];
}
