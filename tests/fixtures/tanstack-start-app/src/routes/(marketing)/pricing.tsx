import { createFileRoute } from "@tanstack/react-router";

import { seo } from "@/seo";

export const Route = createFileRoute("/(marketing)/pricing")({
  staticData: {
    seo: {
      kind: "page",
      link: { title: "Pricing", description: "Simple pricing." },
      crumb: "Pricing",
      sitemap: { priority: 0.9, changeFrequency: "monthly" },
      head: {
        image: { url: "/og/pricing.png", width: 1200, height: 630, alt: "Example pricing" },
        title: "Pricing | Example",
        description: "Simple pricing.",
        faqs: [{ question: "Is there a free plan?", answer: "Yes." }],
      },
    },
  },
  head: seo.head,
});
