import handler from "@tanstack/react-start/server-entry";
import { markdownRequest } from "pagegraph/tanstack-start/markdown";

import { SITE_ORIGIN } from "./lib/seo";

/**
 * Docs pages declare `markdown: "source"`: their Markdown twin is the MDX source, processed.
 * `/docs.md` and `/docs/<page>.md` are prerendered into static assets; this serves them in dev
 * and in the prerender pass.
 */
async function docsMarkdown(request: Request): Promise<Response | undefined> {
  const { pathname } = new URL(request.url);
  const match = /^\/docs(\/.+)?\.md$/.exec(pathname);
  if (match === null || (request.method !== "GET" && request.method !== "HEAD")) return undefined;
  const { docsSource } = await import("./lib/docs-source");
  const page = docsSource.getPage((match[1] ?? "").split("/").filter(Boolean));
  if (page === undefined) return undefined;
  const body = await page.data.getText("processed");
  const url = new URL(page.url, SITE_ORIGIN).href;
  return new Response(
    `# ${page.data.title}\n\nURL: ${url}\n\n${page.data.description}\n\n${body.trim()}\n`,
    {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    },
  );
}

export default {
  async fetch(request: Request) {
    return (
      (await markdownRequest(request)) ?? (await docsMarkdown(request)) ?? handler.fetch(request)
    );
  },
};
