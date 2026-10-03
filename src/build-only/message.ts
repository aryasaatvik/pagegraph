/**
 * Build-only entries resolve here under the `workerd`, `worker`, and `browser`
 * export conditions. They load the app through Vite, parse routes with a native
 * parser, or drive Node I/O, so a runtime bundle that reaches one would fail at
 * request time with an unrelated crash. Throwing at import names the mistake.
 */
export const buildOnlyError = (entry: string): Error =>
  new Error(
    `"${entry}" is build-time only and cannot be imported from a Worker or browser bundle. ` +
      `Keep it in vite.config.ts, pagegraph.config.ts, or other build/CLI modules, and import runtime ` +
      `helpers (renderSitemap, renderRobots, pageHeads, the graph types) from "pagegraph".`,
  );
