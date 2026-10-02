declare module "virtual:pagegraph/runtime" {
  import type { SeoGraphJson } from "../core/wire";
  import type { SiteRuntime } from "./graph";

  /** `null` inside the `pagegraph` environment, where the graph is being built. */
  export const graph: SeoGraphJson | null;
  export const site: SiteRuntime | null;
}
