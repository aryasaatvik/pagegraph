/**
 * Evaluate an app's graph outside a running dev server — for a build, the
 * CLI (`pagegraph.config.ts`), and build-time head loading — through the same
 * `pagegraph` environment the dev server uses.
 */

import { resolve } from "node:path";
import { decodeFacts, type Facts } from "../markdown/facts";

import { createRunnableDevEnvironment, resolveConfig, type Plugin } from "vite";

import type { LoadedSeoGraph, SeoGraphLoader } from "../config/vite-graph-loader";
import { withCleanStdout } from "../config/vite-graph-loader";
import { evaluateGraph, planGraph, type AppGraph, type PagegraphOptions } from "./graph";
import type { PagegraphPluginApi } from "./plugin";

const GRAPH_ENVIRONMENT = "pagegraph";

const cliEnvironmentOverride = (command: "serve" | "build") =>
  command === "build" ? { [GRAPH_ENVIRONMENT]: { isBundled: false } } : undefined;

export interface EvaluateAppGraphOptions {
  /** The app's Vite root. */
  readonly root: string;
  /** Vite command to evaluate. Graph evaluation defaults to `serve`. */
  readonly command?: "serve" | "build" | undefined;
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

/** Read the plugin's authored settings without evaluating routes or starting a server. */
export function loadPagegraphOptions(options: EvaluateAppGraphOptions): Promise<PagegraphOptions>;
export function loadPagegraphOptions(options: EvaluateAppGraphOptions, required: false): Promise<PagegraphOptions | undefined>;
export async function loadPagegraphOptions(options: EvaluateAppGraphOptions, required = true): Promise<PagegraphOptions | undefined> {
  return withCleanStdout(async () => {
    const config = await resolveConfig(
      { root: options.root, configFile: options.configFile, mode: options.mode ?? "production", logLevel: "error" },
      options.command ?? "build",
    );
    if (!required && !config.plugins.some((plugin) => plugin.name === "pagegraph")) return undefined;
    return pluginApi(config.plugins, config.configFile).options;
  });
}

/** Facts use the app's Vite module pipeline while claims never need route discovery. */
export async function loadPagegraphFacts(options: EvaluateAppGraphOptions): Promise<Facts> {
  const command = options.command ?? "build";
  return withCleanStdout(async () => {
    const config = await resolveConfig(
      {
        root: options.root,
        configFile: options.configFile,
        mode: options.mode ?? "production",
        logLevel: "error",
        environments: cliEnvironmentOverride(command),
      },
      command,
    );
    const settings = pluginApi(config.plugins, config.configFile).options;
    if (settings.facts === undefined) return {};
    const environment = createRunnableDevEnvironment(GRAPH_ENVIRONMENT, config, { hot: false });
    await environment.init();
    try {
      await environment.pluginContainer.buildStart({});
      const module = await environment.runner.import(resolve(config.root, settings.facts));
      return decodeFacts(module["facts"]);
    } finally { await environment.close(); }
  });
}

/**
 * Resolve the app's Vite config, evaluate the graph in its `pagegraph`
 * environment, and release it. The command defaults to `serve`; callers can
 * request `build` to match the deployed site configuration.
 */
export async function evaluateAppGraph(options: EvaluateAppGraphOptions): Promise<AppGraph & { readonly pagegraph: NonNullable<LoadedSeoGraph["pagegraph"]> }> {
  const command = options.command ?? "serve";
  const config = await resolveConfig(
    {
      root: options.root,
      configFile: options.configFile,
      mode: options.mode,
      logLevel: "error",
      environments: cliEnvironmentOverride(command),
    },
    command,
  );
  const api = pluginApi(config.plugins, config.configFile);
  const environment = createRunnableDevEnvironment(GRAPH_ENVIRONMENT, config, { hot: false });
  await environment.init();
  try {
    // Content plugins (Fumadocs, MDX) generate their virtual sources at buildStart.
    await environment.pluginContainer.buildStart({});
    const app = await evaluateGraph(environment.runner, await planGraph(config.root, api.options));
    return { ...app, pagegraph: { root: config.root, options: api.options, facts: app.facts ?? {} } };
  } finally {
    await environment.close();
  }
}

/**
 * A `pagegraph.config.ts` graph loader for a TanStack Start app. It uses the
 * built site's identity by default; pass `command: "serve"` for a dev host.
 *
 * ```ts
 * export default defineSeoConfig({
 *   loadGraph: tanstackStartGraph({ root: import.meta.dirname }),
 * });
 * ```
 */
export const tanstackStartGraph =
  (options: EvaluateAppGraphOptions): SeoGraphLoader =>
  async (): Promise<LoadedSeoGraph> => {
    const { graph, site, pagegraph } = await withCleanStdout(() =>
      evaluateAppGraph({
        ...options,
        command: options.command ?? "build",
        mode: options.mode ?? "production",
      }),
    );
    return { graph, site, pagegraph, dispose: async () => {} };
  };
