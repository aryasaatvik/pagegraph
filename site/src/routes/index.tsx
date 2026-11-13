import { createFileRoute } from "@tanstack/react-router";
import { DocumentProvider, Section, Title } from "pagegraph/react";

import { seo } from "../lib/seo";

export const Route = createFileRoute("/")({
  staticData: {
    markdown: "rendered",
    llms: "Pages",
    seo: {
      kind: "page",
      crumb: "Home",
      sitemap: { priority: 1, changeFrequency: "weekly" },
      head: {
        title: "PageGraph: route-declared SEO for TanStack Start",
        description:
          "Head tags, sitemap, robots.txt, JSON-LD and a CI gate for TanStack Start, from one declaration per route.",
      },
    },
  },
  head: seo.head,
  component: () => (
    <DocumentProvider>
      <Section kind="hero" id="hero">
        <h1>
          <Title>Declare SEO on the route. PageGraph derives the rest.</Title>
        </h1>
      </Section>
    </DocumentProvider>
  ),
});
