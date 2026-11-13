import { createFileRoute } from "@tanstack/react-router";
import browserCollections from "fumadocs-mdx:collections/browser";
import { createElement } from "react";

import { DocsLayout } from "../../components/docs-layout";
import { getDocsPage, type DocsPageData } from "../../lib/docs-data";
import { seoHead } from "../../lib/seo";

const clientLoader = browserCollections.docs.createClientLoader({
  component({ default: MDX }, props: { data: DocsPageData }) {
    return (
      <DocsLayout data={props.data}>
        <MDX />
      </DocsLayout>
    );
  },
});

export const Route = createFileRoute("/docs/$")({
  staticData: {
    markdown: "source",
    llms: "Docs",
    seo: {
      kind: "page",
      titleTemplate: "%s | PageGraph docs",
      sitemap: { priority: 0.8, changeFrequency: "monthly" },
    },
  },
  loader: async ({ params }) => {
    const data = await getDocsPage({ data: params._splat ?? "" });
    await clientLoader.preload(data.path);
    return data;
  },
  head: (ctx) =>
    ctx.loaderData === undefined
      ? {}
      : seoHead(ctx, {
          title: ctx.loaderData.title,
          description: ctx.loaderData.description,
          breadcrumbs: ctx.loaderData.breadcrumbs,
        }),
  component: DocsPage,
});

function DocsPage() {
  const data = Route.useLoaderData();
  return createElement(clientLoader.getComponent(data.path), { data });
}
