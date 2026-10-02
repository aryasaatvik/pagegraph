import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/(legal)/terms")({
  staticData: { seo: { kind: "page", sitemap: { priority: 0.3, changeFrequency: "monthly" }, head: { title: "Terms | Example", description: "The terms page." } } },
});
