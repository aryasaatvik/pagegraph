import { createFileRoute } from "@tanstack/react-router";

import { seoHead } from "@/seo";

export const Route = createFileRoute("/(marketing)/blog/$slug")({
  staticData: {
    seo: {
      kind: "article",
      titleTemplate: "%s | Example Blog",
      sitemap: { priority: 0.7, changeFrequency: "weekly" },
    },
  },
  head: (ctx) => seoHead(ctx, { title: String(ctx.params.slug), description: "A post." }),
});
