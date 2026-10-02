import { createFileRoute } from "@tanstack/react-router";

import { seo } from "@/seo";

export const Route = createFileRoute("/(marketing)/")({
  staticData: {
    seo: {
      kind: "page",
      sitemap: { priority: 1, changeFrequency: "weekly" },
      head: { title: `${import.meta.env.VITE_BRAND} — home`, description: "The home page." },
    },
  },
  head: seo.head,
});
