/**
 * Config discovery and graph acquisition for the `pagegraph` CLI.
 *
 * The CLI knows how to *view* a graph; the host knows how to *produce* one. That
 * seam is a `pagegraph.config.ts` at the app root, found by walking up from the working
 * directory — so `bun run pagegraph check` works from anywhere inside the app.
 *
 * The config is a TypeScript module the CLI imports directly, which is one of the
 * reasons the `bin` runs under Bun (the other being the synchronous fd-1 flush in
 * `main.ts`).
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import type * as Scope from "effect/Scope";

import type { LoadedSeoGraph, SeoCliConfig } from "../config";
import type { CoverageRule } from "../core/checks";
import type { SeoGraph } from "../core/graph";
import { SeoCliError } from "./output";

const CONFIG_FILENAMES = ["pagegraph.config.ts", "pagegraph.config.js", "pagegraph.config.mjs"] as const;
const LEGACY_CONFIG_FILENAMES = ["seo.config.ts", "seo.config.js", "seo.config.mjs"] as const;

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** First `pagegraph.config.*` at or above `from`, or undefined at the filesystem root. */
const findConfigFile = (from: string): string | undefined => {
  let directory = resolve(from);
  for (;;) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = join(directory, filename);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
};

/** Find an old config only to provide the explicit breaking-rename error. */
const findLegacyConfigFile = (from: string): string | undefined => {
  let directory = resolve(from);
  for (;;) {
    for (const filename of LEGACY_CONFIG_FILENAMES) {
      const candidate = join(directory, filename);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
};

const configNotFoundMessage = (cwd: string): string => {
  if (findLegacyConfigFile(cwd) !== undefined) {
    return "seo.config.ts was renamed to pagegraph.config.ts; rename the file";
  }
  return `No ${CONFIG_FILENAMES[0]} in ${cwd} or any parent directory. Create one that exports \`defineSeoConfig({ loadGraph })\` from "pagegraph/config".`;
};

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every(Predicate.isString);

const isCoverageRules = (value: unknown): value is ReadonlyArray<CoverageRule> =>
  Array.isArray(value) &&
  value.every(
    (rule) =>
      Predicate.isObject(rule) &&
      Predicate.isString(rule["path"]) &&
      Number.isSafeInteger(rule["minInbound"]) &&
      (rule["minInbound"] as number) > 0,
  );

const isPositiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

const isContentPolicy = (value: unknown): boolean =>
  Predicate.isObject(value) &&
  (value["minWords"] === undefined ||
    (Array.isArray(value["minWords"]) &&
      value["minWords"].every(
        (rule) =>
          Predicate.isObject(rule) &&
          Predicate.isString(rule["path"]) &&
          isPositiveInteger(rule["minWords"]),
      )));

const isFreshnessPolicy = (value: unknown): boolean =>
  Predicate.isObject(value) && isPositiveInteger(value["maxAgeDays"]);

const isStringRecord = (value: unknown): value is Readonly<Record<string, string>> =>
  Predicate.isObject(value) && Object.values(value).every(Predicate.isString);

const isWorkflowTimeout = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 2_147_483_647;

const isStringArrayRecord = (
  value: unknown,
): value is Readonly<Record<string, ReadonlyArray<string>>> =>
  Predicate.isObject(value) && Object.values(value).every(isStringArray);

const isWorkflowConfig = (value: unknown): boolean => {
  if (!Predicate.isObject(value) || !Predicate.isObject(value["opencode"])) return false;
  const opencode = value["opencode"];
  const context = value["context"];
  return (
    Predicate.isString(opencode["configDirectory"]) &&
    Predicate.isString(opencode["defaultModel"]) &&
    (opencode["models"] === undefined || isStringRecord(opencode["models"])) &&
    (opencode["timeoutMs"] === undefined || isWorkflowTimeout(opencode["timeoutMs"])) &&
    (context === undefined ||
      (Predicate.isObject(context) &&
        (context["files"] === undefined || isStringArray(context["files"])) &&
        (context["byWorkflow"] === undefined || isStringArrayRecord(context["byWorkflow"])))) &&
    (value["runsDirectory"] === undefined || Predicate.isString(value["runsDirectory"]))
  );
};

const CLI_CONFIG_FIELDS = new Set([
  "loadGraph",
  "transform",
  "coverage",
  "content",
  "freshness",
  "workflows",
]);

/**
 * `pagegraph.config.ts` is the consumer's file and may be plain JS, so its types are
 * a suggestion, not a guarantee. Check every field the CLI consumes at this boundary.
 */
const isSeoCliConfig = (value: unknown): value is SeoCliConfig =>
  Predicate.isObject(value) &&
  Object.keys(value).every((key) => CLI_CONFIG_FIELDS.has(key)) &&
  Predicate.isFunction(value["loadGraph"]) &&
  (value["transform"] === undefined || Predicate.isFunction(value["transform"])) &&
  (value["coverage"] === undefined || isCoverageRules(value["coverage"])) &&
  (value["content"] === undefined || isContentPolicy(value["content"])) &&
  (value["freshness"] === undefined || isFreshnessPolicy(value["freshness"])) &&
  (value["workflows"] === undefined || isWorkflowConfig(value["workflows"]));

/** Import and validate one config path. */
const loadConfigFile = (configPath: string): Effect.Effect<SeoCliConfig, SeoCliError> =>
  Effect.gen(function* () {
    yield* Effect.logDebug(`Loading SEO config from ${configPath}`);

    const module = yield* Effect.tryPromise({
      try: () => import(pathToFileURL(configPath).href) as Promise<{ default?: unknown }>,
      catch: (cause) =>
        new SeoCliError({ message: `Could not load ${configPath}: ${messageOf(cause)}` }),
    });

    if (!isSeoCliConfig(module.default)) {
      const duplicatedField = Predicate.isObject(module.default)
        ? Object.keys(module.default).find((key) => !CLI_CONFIG_FIELDS.has(key))
        : undefined;
      return yield* new SeoCliError({
        message: duplicatedField === undefined
          ? `${configPath} must default-export defineSeoConfig({ loadGraph }).`
          : `${configPath} contains unsupported field "${duplicatedField}"; pagegraph.config.ts accepts only CLI fields, while site identity and plugin options belong to the graph loader and pagegraph() in vite.config.ts.`,
      });
    }
    return module.default;
  });

/**
 * Load the app's `pagegraph.config.ts`. Cheap to run more than once per process: the
 * ESM cache evaluates the config module exactly once.
 */
export const loadSeoConfig: Effect.Effect<SeoCliConfig, SeoCliError> = Effect.gen(function* () {
  const cwd = process.cwd();
  const configPath = findConfigFile(cwd);
  if (configPath === undefined) {
    return yield* new SeoCliError({ message: configNotFoundMessage(cwd) });
  }
  return yield* loadConfigFile(configPath);
});

export interface SeoProjectConfig {
  readonly config: SeoCliConfig;
  readonly configPath: string;
  readonly root: string;
}

/** Load the config together with the project root that owns it. */
export const loadSeoProjectConfig: Effect.Effect<SeoProjectConfig, SeoCliError> = Effect.gen(
  function* () {
    const cwd = process.cwd();
    const configPath = findConfigFile(cwd);
    if (configPath === undefined) {
      return yield* new SeoCliError({ message: configNotFoundMessage(cwd) });
    }
    return { config: yield* loadConfigFile(configPath), configPath, root: dirname(configPath) };
  },
);

/**
 * Like {@link loadSeoConfig}, but `undefined` when no config exists. For a
 * framework-independent command that enriches its report when an app is present
 * without requiring one. A config that exists but fails to load still fails —
 * silence would hide a broken declaration.
 */
export const loadSeoConfigOptional: Effect.Effect<SeoCliConfig | undefined, SeoCliError> =
  Effect.gen(function* () {
    const configPath = findConfigFile(process.cwd());
    if (configPath === undefined) {
      if (findLegacyConfigFile(process.cwd()) !== undefined) {
        return yield* new SeoCliError({ message: configNotFoundMessage(process.cwd()) });
      }
      return undefined;
    }
    return yield* loadConfigFile(configPath);
  });

/**
 * The live SEO graph as a scoped resource: whatever the loader acquired (for
 * {@link viteGraphLoader}, an in-process Vite server) is released when the
 * surrounding `Effect.scoped` exits, on success or failure.
 */
export const acquireLoadedGraph = (
  config: SeoCliConfig,
): Effect.Effect<LoadedSeoGraph, SeoCliError, Scope.Scope> =>
  Effect.gen(function* () {
    yield* Effect.logDebug("Loading the SEO graph…");

    const load = async (): Promise<LoadedSeoGraph> => {
      const loaded: unknown = await config.loadGraph();
      if (!isLoadedSeoGraph(loaded)) {
        let disposeFailure: unknown;
        if (Predicate.isObject(loaded) && Predicate.isFunction(loaded["dispose"])) {
          try {
            await loaded["dispose"]();
          } catch (cause) {
            disposeFailure = cause;
          }
        }
        const contractError = "The graph loader must return { graph, site: { origin, indexable, robots }, dispose }.";
        throw new Error(
          disposeFailure === undefined
            ? contractError
            : `${contractError} Releasing the invalid result also failed: ${messageOf(disposeFailure)}`,
        );
      }
      return loaded;
    };

    const loaded = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: load,
        catch: (cause) => new SeoCliError({ message: messageOf(cause) }),
      }),
      // The graph is already in hand by release time, so a failed dispose must
      // not take the command down with it — a leaked Vite server in a
      // short-lived CLI process is worth a warning, not a crash.
      (acquired) =>
        Effect.promise(() => acquired.dispose()).pipe(
          Effect.catchDefect((defect) =>
            Effect.logWarning(`Could not dispose the SEO graph loader: ${messageOf(defect)}`),
          ),
        ),
    );

    yield* Effect.logDebug(
      `Loaded SEO graph: ${loaded.graph.nodes.size} nodes, ${loaded.graph.edges.length} edges.`,
    );
    return loaded;
  });

const isLoadedSeoGraph = (value: unknown): value is LoadedSeoGraph => {
  if (
    !Predicate.isObject(value) ||
    !Predicate.isObject(value["graph"]) ||
    !(value["graph"]["nodes"] instanceof Map) ||
    !Array.isArray(value["graph"]["edges"]) ||
    !Predicate.isFunction(value["dispose"]) ||
    !Predicate.isObject(value["site"])
  ) return false;
  const site = value["site"];
  const robots = site["robots"];
  let canonicalOrigin = false;
  if (Predicate.isString(site["origin"])) {
    try {
      const url = new URL(site["origin"]);
      canonicalOrigin =
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.origin === site["origin"];
    } catch {
      canonicalOrigin = false;
    }
  }
  return (
    canonicalOrigin &&
    Predicate.isBoolean(site["indexable"]) &&
    Predicate.isObject(robots) &&
    isStringArray(robots["disallow"]) &&
    (robots["contentSignal"] === undefined || Predicate.isString(robots["contentSignal"])) &&
    (robots["directives"] === undefined || isStringArray(robots["directives"]))
  );
};

/** {@link acquireLoadedGraph}, for commands that need only the graph. */
export const acquireGraph = (
  config: SeoCliConfig,
): Effect.Effect<SeoGraph, SeoCliError, Scope.Scope> =>
  Effect.map(acquireLoadedGraph(config), (loaded) => loaded.graph);
