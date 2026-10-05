/**
 * `pagegraph/tanstack-start/server` — runtime. Serves the graph the
 * `pagegraph()` plugin built for this deployment:
 *
 * ```ts
 * // src/routes/robots[.]txt.ts
 * export const Route = createFileRoute("/robots.txt")({ server: { handlers: { GET: robotsTxt } } });
 * ```
 */

import { graph as graphJson, site as siteRuntime, markdown } from "virtual:pagegraph/runtime";

import type { SeoGraph } from "../core/graph";
import { renderRobots, renderSitemap } from "../core/projections";
import { graphFromJson } from "../core/wire";
import type { SiteRuntime } from "./graph";
import { llmsMarkdown } from "../markdown/llms";

let decoded: SeoGraph | undefined;

const unavailable = (): Error =>
  new Error(
    "pagegraph/tanstack-start/server has no graph: register pagegraph() from \"pagegraph/tanstack-start\" in vite.config.ts. " +
      "(Inside the graph environment itself, the graph is still being built.)",
  );

/** The deployment's SEO graph. */
export function seoGraph(): SeoGraph {
  if (graphJson === null) throw unavailable();
  decoded ??= graphFromJson(graphJson);
  return decoded;
}

/** The deployment's origin, indexability, and robots policy. */
export function seoSite(): SiteRuntime {
  if (siteRuntime === null) throw unavailable();
  return siteRuntime;
}

/** `GET /robots.txt`: the robots policy on an indexable host, disallow-all otherwise. */
export function robotsTxt(): Response {
  const site = seoSite();
  return new Response(renderRobots(seoGraph(), { origin: site.origin, indexable: site.indexable, ...site.robots }), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": site.indexable ? "public, max-age=86400" : "public, max-age=3600",
    },
  });
}

/** `GET /sitemap.xml`. */
export function sitemapXml(): Response {
  const site = seoSite();
  return new Response(renderSitemap(seoGraph(), { origin: site.origin, indexable: site.indexable }), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/** Generated llms.txt groups, using graph metadata without rendering pages. */
export function llmsSection(): string {
  if (markdown === null)
    throw new Error('llmsSection requires pagegraph({ markdown: { origin } }) in vite.config.ts');
  const pages = [...seoGraph().nodes.values()]
    .filter((node) => !node.path.includes("$") && (node.markdown === "rendered" || node.llms !== undefined))
    .map((node) => {
      if (node.head?.title === undefined || node.head.description === undefined)
        throw new Error(`Markdown page ${node.path} must declare a graph head with title and description for llms.txt`);
      return {
        document: { path: node.path, title: node.head.title, description: node.head.description },
        ...(node.llms === undefined ? {} : { llms: node.llms }),
      };
    });
  return llmsMarkdown(pages, markdown.origin);
}

/** `GET /llms.txt`: graph-derived links to rendered and explicitly grouped Markdown pages. */
export function llmsTxt(options: { sections?: ReadonlyArray<string> } = {}): () => Response {
  return () => new Response(
    [llmsSection().trimEnd(), ...(options.sections ?? []).map((section) => section.trim())]
      .filter(Boolean).join("\n\n") + "\n",
    { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } },
  );
}
