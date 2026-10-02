import { createFileRoute } from "@tanstack/react-router";
// Resolves only inside a Worker; the graph excludes this route.
import { env } from "cloudflare:workers";

export const Route = createFileRoute("/app-only")({
  staticData: { seo: { kind: "page", robots: "noindex" } },
  loader: () => env,
});
