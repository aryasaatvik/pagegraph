import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { open as openFile, stat as statFile } from "node:fs/promises";
import { basename, normalize, resolve } from "node:path";

import {
  Generator,
  getConfig,
  type GeneratorEvent,
  type GeneratorPlugin,
  type RouteNode,
} from "@tanstack/router-generator";
import type { Plugin } from "vite";

/**
 * Derives a route-config module from the parsed TanStack route tree.
 *
 * The route tree is the single source of truth for which paths exist; this
 * plugin projects it into the small config the host consumes at runtime:
 * - `robotsExclusions` — path prefixes disallowed in robots.txt (feed them to
 *   `renderRobots`).
 * - `reservedSegments` — top-level path segments the app must not hand out (an
 *   org slug, a tenant name). Derived from the full public route surface — the
 *   `publicGroups` route groups plus the group-less `extraPublicRoutes` — which
 *   is parsed here but not emitted: "which pages are public" already has a
 *   canonical runtime answer in the SEO graph.
 *
 * It also enforces that every page in `enforceCoverageIn` declares its SEO: a
 * page leaf missing both `staticData` and `head` fails dev startup and build.
 *
 * **Why we run our own Generator.** The parse must come from
 * `@tanstack/router-generator` itself — a second, hand-rolled scanner would
 * drift from TanStack's group/param/layout conventions. But routing our plugin
 * through TanStack Start does not work: `start-plugin-core` builds its own
 * generator-plugin array and drops `router.plugins` on the floor
 * (tanstack/router#7768 — `plugins` is not public API there), and even when
 * forced through, the router unplugin wraps `generator.run()` in
 * `catch (e) { console.error(e) }`, so a plugin can never fail a build.
 *
 * So we instantiate `Generator` ourselves — `config.plugins` is natively
 * honored on our own instance, and because we own the `.run()` call site a
 * coverage violation throws straight out of `buildStart`. Cost: route files are
 * parsed twice at startup (~40 files, milliseconds) — the host's router plugin
 * still owns the real `routeTree.gen.ts`; ours is a shadow parse whose route
 * tree is thrown away (see {@link inMemoryWriteFs}).
 *
 * `onRouteTreeChanged` fires on every generator run, but the config is written
 * only when its content changes, and the output path lives outside the routes
 * directory, so regeneration never feeds back into the watcher.
 */

const PLUGIN_NAME = "seo-route-config";

/** Match a route's group folder (`filePath` is relative to the routes directory). */
function groupOf(filePath: string, groups: ReadonlyArray<string>): string | undefined {
  return groups.find((group) => filePath.startsWith(`${group}/`));
}

/**
 * A page leaf is a `.tsx` route file that is not a `route.tsx` layout. This
 * excludes layout wrappers, `.ts` server routes (robots.txt / sitemap.xml /
 * markdown mirrors), and any other non-page file — matching the leaves that
 * contribute a crawlable URL.
 */
function isPageLeaf(node: RouteNode): boolean {
  return node.filePath.endsWith(".tsx") && basename(node.filePath) !== "route.tsx";
}

/**
 * Convert a group-prefixed routePath (e.g. "/(marketing)/blog/$slug") into the
 * public URL form used by route-config ("/blog/*"): drop the group segment,
 * collapse the first dynamic/splat segment and everything after it to "*", and
 * trim the index trailing slash.
 */
function routePathToPublicUrl(routePath: string): string {
  const stripped = routePath.replace(/^\/\([^)]+\)/, "");
  if (stripped === "" || stripped === "/") return "/";

  const segments = stripped.split("/");
  const dynamicIndex = segments.findIndex((segment) => segment.startsWith("$"));
  if (dynamicIndex !== -1) {
    return `${segments.slice(0, dynamicIndex).join("/")}/*`;
  }

  return stripped.endsWith("/") ? stripped.slice(0, -1) : stripped;
}

/**
 * First path segment of each route, reserved so it can't be claimed as an org
 * slug. Strip the leading slash and a trailing "/*", then take the first
 * segment ("/features/email" -> "features").
 */
function extractReservedSegments(routes: ReadonlyArray<string>): Array<string> {
  const segments = new Set<string>();
  for (const route of routes) {
    const first = route.replace(/^\//, "").replace(/\/\*$/, "").split("/")[0];
    if (first) segments.add(first);
  }
  return Array.from(segments).sort();
}

/**
 * robots.txt disallow prefixes are directory prefixes, so a splat route
 * ("/reset-password/*") disallows the whole subtree ("/reset-password").
 */
function normalizeRoutePrefix(route: string): string {
  const cleaned = route.replace(/\/\*$/, "");
  return cleaned === "" ? "/" : cleaned;
}

interface RouteConfigShape {
  robotsExclusions: Array<string>;
  reservedSegments: Array<string>;
}

function deriveRouteConfig(
  routeNodes: ReadonlyArray<RouteNode>,
  options: ResolvedOptions,
): RouteConfigShape {
  const publicUrls = new Set<string>(options.extraPublicRoutes);
  const disallowedUrls = new Set<string>();

  for (const node of routeNodes) {
    const group = groupOf(node.filePath, options.publicGroups);
    if (group === undefined || !isPageLeaf(node) || node.routePath === undefined) continue;
    const url = routePathToPublicUrl(node.routePath);
    publicUrls.add(url);
    if (options.disallowGroups.includes(group)) disallowedUrls.add(url);
  }

  const reservedSegments = [
    ...extractReservedSegments([...publicUrls].sort()),
    ...options.reservedExtras,
  ].sort();

  const robotsExclusions = [
    ...new Set([...options.alwaysDisallow, ...[...disallowedUrls].map(normalizeRoutePrefix)]),
  ].sort();

  return { robotsExclusions, reservedSegments };
}

/**
 * Every page in an enforced group must declare its search presence. A leaf that
 * passes neither `staticData` (from which the SEO graph reads `staticData.seo`)
 * nor `head` has no path to correct metadata.
 */
function findCoverageViolations(
  routeNodes: ReadonlyArray<RouteNode>,
  options: ResolvedOptions,
): Array<string> {
  const violations: Array<string> = [];
  for (const node of routeNodes) {
    const group = groupOf(node.filePath, options.enforceCoverageIn);
    if (group === undefined || !isPageLeaf(node)) continue;

    const props = node.createFileRouteProps;
    if (props?.has("staticData") || props?.has("head")) continue;

    violations.push(`${node.filePath} (${group} page)`);
  }
  return violations;
}

function coverageMessage(violations: ReadonlyArray<string>): string {
  return (
    `[${PLUGIN_NAME}] ${violations.length} page(s) declare neither staticData nor ` +
    `head. Every page in an SEO-enforced route group must declare its SEO — add ` +
    `staticData: { seo: ... } or a head() to each route:\n  - ${violations.join("\n  - ")}`
  );
}

const HEADER =
  `// Auto-generated by the ${PLUGIN_NAME} Vite plugin.\n` +
  "// DO NOT EDIT MANUALLY — regenerated from the route tree on every dev/build.\n";

function renderRouteConfig(config: RouteConfigShape): string {
  return `${HEADER}
export const routeConfig = ${JSON.stringify(config, null, 2)} as const;

export type RouteConfig = typeof routeConfig;
`;
}

function routeConfigGeneratorPlugin(options: ResolvedOptions): GeneratorPlugin {
  const { outputPath } = options;
  return {
    name: PLUGIN_NAME,
    init() {
      // The caller passes an explicit absolute output path, so a relocated routes
      // directory can never silently retarget the write. Guard the parent directory
      // here so a bad path fails at startup, not mid-watch.
      if (!existsSync(resolve(outputPath, ".."))) {
        throw new Error(
          `[${PLUGIN_NAME}] output directory does not exist: ${resolve(outputPath, "..")}`,
        );
      }
    },
    onRouteTreeChanged({ routeNodes }) {
      const violations = findCoverageViolations(routeNodes, options);
      if (violations.length > 0) throw new Error(coverageMessage(violations));

      const content = renderRouteConfig(deriveRouteConfig(routeNodes, options));
      const existing = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : undefined;
      if (existing !== content) writeFileSync(outputPath, content);
    },
  };
}

/**
 * A `Generator` filesystem that reads real files but keeps every write in
 * memory, so our shadow parse cannot touch the repo.
 *
 * The Generator writes through `safeFileWrite`: `writeFile(<tmp>)`, then
 * `rename(<tmp>, <dest>)`. Two destinations exist, and neither may land:
 * - the route tree — we point it at a throwaway path and hold it in memory, so
 *   the only route tree on disk stays the one the host's router plugin writes;
 * - route source files — the Generator normalizes them (`createFileRoute` ids,
 *   code-split transforms). The host's generator already did that with its own
 *   config; ours is not the host's, so such a write is dropped rather than
 *   allowed to fight it.
 *
 * Reads and stats of real files go to disk, which keeps the Generator's mtime
 * cache honest: a route edited mid-watch is always seen.
 */
function inMemoryWriteFs(routeTreePath: string) {
  const written = new Map<string, { content: string; mtimeMs: bigint }>();
  let clock = 0n;
  const tick = () => (clock += 1n);

  return {
    /**
     * The in-memory route tree is invisible to the watcher, so nothing else can
     * mark it stale. Bumping its mtime before each run is what makes the
     * Generator rebuild the tree — and therefore re-fire `onRouteTreeChanged`
     * — on every run, not only when the set of routes changes. Coverage and the
     * derived config depend on route *contents* (`staticData` / `head`), which
     * leave the route tree itself untouched.
     */
    touchRouteTree() {
      const file = written.get(routeTreePath);
      if (file) written.set(routeTreePath, { content: file.content, mtimeMs: tick() });
    },
    fs: {
      async stat(filePath: string) {
        const file = written.get(filePath);
        if (file) return { mtimeMs: file.mtimeMs, mode: 0o100644, uid: 0, gid: 0 };
        const real = await statFile(filePath, { bigint: true });
        return {
          mtimeMs: real.mtimeMs,
          mode: Number(real.mode),
          uid: Number(real.uid),
          gid: Number(real.gid),
        };
      },
      async readFile(filePath: string) {
        const file = written.get(filePath);
        if (file) return { stat: { mtimeMs: file.mtimeMs }, fileContent: file.content };
        if (!existsSync(filePath)) return "file-not-existing" as const;
        const handle = await openFile(filePath, "r");
        const fileStat = await handle.stat({ bigint: true });
        const fileContent = (await handle.readFile()).toString();
        await handle.close();
        return { stat: { mtimeMs: fileStat.mtimeMs }, fileContent };
      },
      async writeFile(filePath: string, content: string) {
        written.set(filePath, { content, mtimeMs: tick() });
      },
      async rename(oldPath: string, newPath: string) {
        const file = written.get(oldPath);
        written.delete(oldPath);
        // Anything but the throwaway route tree — i.e. a route source file — is
        // dropped here, which is the whole point: this generator never writes.
        if (file && newPath === routeTreePath) {
          written.set(newPath, { content: file.content, mtimeMs: tick() });
        }
      },
      async chmod() {},
      async chown() {},
    },
  };
}

export interface SeoRouteConfigOptions {
  /** Absolute path the generated route-config module is written to. */
  outputPath: string;
  /** Route groups whose page leaves form the public surface. Include the parens. */
  publicGroups: ReadonlyArray<string>;
  /** Route groups where every page leaf must declare `staticData` or `head`. */
  enforceCoverageIn: ReadonlyArray<string>;
  /** Route groups whose page paths are disallowed in robots.txt (e.g. auth). */
  disallowGroups?: ReadonlyArray<string> | undefined;
  /** Public routes that live outside any group folder, so nothing discovers them. */
  extraPublicRoutes?: ReadonlyArray<string> | undefined;
  /** Reserved top-level segments that are not route-tree paths (e.g. an api mount). */
  reservedExtras?: ReadonlyArray<string> | undefined;
  /** Prefixes always disallowed in robots.txt, route tree or not. */
  alwaysDisallow?: ReadonlyArray<string> | undefined;
  /** Routes directory, relative to the Vite root. Defaults to `src/routes`. */
  routesDirectory?: string | undefined;
}

interface ResolvedOptions {
  outputPath: string;
  publicGroups: ReadonlyArray<string>;
  enforceCoverageIn: ReadonlyArray<string>;
  disallowGroups: ReadonlyArray<string>;
  extraPublicRoutes: ReadonlyArray<string>;
  reservedExtras: ReadonlyArray<string>;
  alwaysDisallow: ReadonlyArray<string>;
  routesDirectory: string;
}

function resolveOptions(options: SeoRouteConfigOptions): ResolvedOptions {
  return {
    outputPath: options.outputPath,
    publicGroups: options.publicGroups,
    enforceCoverageIn: options.enforceCoverageIn,
    disallowGroups: options.disallowGroups ?? [],
    extraPublicRoutes: options.extraPublicRoutes ?? [],
    reservedExtras: options.reservedExtras ?? [],
    alwaysDisallow: options.alwaysDisallow ?? [],
    routesDirectory: options.routesDirectory ?? "src/routes",
  };
}

/**
 * Vite plugin that runs its own `@tanstack/router-generator` instance over the
 * routes directory and derives the route-config module from the result.
 */
export function seoRouteConfig(options: SeoRouteConfigOptions): Plugin {
  const resolved = resolveOptions(options);

  let generator: Generator | undefined;
  let touchRouteTree: (() => void) | undefined;
  let routesDirectory: string | undefined;

  /**
   * A throw here propagates: it fails `vite build` and dev startup, which is
   * the reason we own this call site instead of registering through Start.
   */
  const run = async (event?: GeneratorEvent) => {
    if (generator === undefined || touchRouteTree === undefined) {
      throw new Error(`[${PLUGIN_NAME}] generator was not initialized by configResolved`);
    }
    touchRouteTree();
    await generator.run(event);
  };

  return {
    name: PLUGIN_NAME,
    enforce: "pre",
    configResolved(config) {
      const root = config.root;
      // The route tree we generate is a byproduct we never want on disk; park it
      // (and the generator's temp files) inside node_modules so a stray write
      // could never show up as a repo change.
      const cacheDirectory = resolve(root, `node_modules/.cache/${PLUGIN_NAME}`);
      routesDirectory = resolve(root, resolved.routesDirectory);
      const generatorConfig = getConfig(
        {
          routesDirectory,
          generatedRouteTree: resolve(cacheDirectory, "route-tree.gen.ts"),
          tmpDir: resolve(cacheDirectory, "tmp"),
          plugins: [routeConfigGeneratorPlugin(resolved)],
          // The route tree is thrown away — skip its type emission and its
          // prettier pass.
          disableTypes: true,
          enableRouteTreeFormatting: false,
          // The host's generator is the one that reports on the route tree; this
          // second pass over the same files would only echo it.
          disableLogging: true,
        },
        root,
      );

      const memory = inMemoryWriteFs(generatorConfig.generatedRouteTree);
      touchRouteTree = memory.touchRouteTree;
      generator = new Generator({ config: generatorConfig, root, fs: memory.fs });
    },
    async buildStart() {
      await run();
    },
    // Vite watches the whole project, but only a route file can change the tree
    // or a route's declared options. Without this guard every CSS/component edit
    // would re-run the generator and its coverage pass (`touchRouteTree` forces
    // a rebuild, so the Generator's own short-circuit can't absorb them).
    async watchChange(id, { event }) {
      const file = normalize(id);
      if (routesDirectory === undefined || !file.startsWith(routesDirectory)) return;
      await run({ path: file, type: event });
    },
  };
}
