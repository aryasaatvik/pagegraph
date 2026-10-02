import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_docs/help")({
  staticData: { seo: { kind: "page", sitemap: { priority: 0.5, changeFrequency: "monthly" }, head: { title: "Help | Example", description: "The help page." } } },
});
