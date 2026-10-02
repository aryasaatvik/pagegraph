/**
 * `pagegraph/tanstack-start` — build-only. Register {@link pagegraph} in
 * `vite.config.ts`; serve the graph with `pagegraph/tanstack-start/server`.
 */

export { pagegraph } from "./plugin";
export type { AppGraph, PagegraphOptions, RobotsPolicy, SiteRuntime } from "./graph";
export { evaluateAppGraph, tanstackStartGraph } from "./load";
export type { EvaluateAppGraphOptions } from "./load";
