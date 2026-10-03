declare module "virtual:pagegraph/runtime" {
  import type { SeoGraphJson } from "../core/wire";
  import type { Facts } from "../markdown/facts";
  import type { SiteRuntime } from "./graph";

  /** `null` inside the `pagegraph` environment, where the graph is being built. */
  export const graph: SeoGraphJson | null;
  export const site: SiteRuntime | null;
  export const markdown: { readonly origin: string } | null;
  export const facts: Facts | undefined;
}


declare module "virtual:pagegraph/prerender-server" {
  const server: { fetch(request: Request): Response | Promise<Response> };
  export default server;
}
