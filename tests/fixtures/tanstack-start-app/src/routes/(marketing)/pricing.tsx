import { createFileRoute } from "@tanstack/react-router";

import { seo } from "@/seo";

export const Route = createFileRoute("/(marketing)/pricing")({
  staticData: {
    seo: {
      kind: "page",
      crumb: "Pricing",
      sitemap: { priority: 0.9, changeFrequency: "monthly" },
      head: {
        title: "Pricing | Example",
        description: "Simple pricing.",
        faqs: [{ question: "Is there a free plan?", answer: "Yes." }],
      },
    },
  },
  head: seo.head,
});
