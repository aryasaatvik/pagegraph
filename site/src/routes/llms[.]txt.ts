import { createFileRoute } from "@tanstack/react-router";
import { llmsSection } from "pagegraph/tanstack-start/server";

const intro = `# PageGraph

> Route-declared SEO for TanStack Start and TanStack Router: head tags, sitemap, robots.txt, JSON-LD and a CI gate from one declaration per route.

Install with \`bun add pagegraph\`. Source and issues: https://github.com/aryasaatvik/pagegraph`;

/** llms.txt: the intro, then the groups PageGraph derives from every page's `llms` declaration. */
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(`${intro}\n\n${llmsSection().trim()}\n`, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        }),
    },
  },
});
