import { createFileRoute } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { DocumentProvider, Fact, Section, T } from "pagegraph/react";

const requestSnapshot = createIsomorphicFn().server(() => getRequest()).client(() => undefined);

export const Route = createFileRoute("/guides/$slug")({
  staticData: { markdown: "rendered", llms: "Guides", seo: { kind: "page" } },
  loader: ({ params, serverContext }) => {
    if (import.meta.env.SSR && serverContext?.fixtureHost !== "forwarded")
      throw new Error("Missing host request context");
    const request = requestSnapshot();
    return {
      title: `Guide: ${params.slug}`,
      description: `Loaded ${params.slug}`,
      personalized: request !== undefined && (
        [...request.headers.keys()].some((name) => name !== "accept") ||
        request.headers.get("accept") !== "text/html" || new URL(request.url).search !== ""
      ),
    };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.title }, { name: "description", content: loaderData?.description }],
  }),
  component: Page,
});

function Page() {
  const data = Route.useLoaderData();
  const { slug } = Route.useParams();
  return (
    <DocumentProvider>
      <Section id="hero" kind="hero">
        <h1 data-slug={slug}>
          {data.personalized ? <T>Personalized text must not enter the snapshot.</T> : <T>Start with <Fact id="emails" /> emails.</T>}
        </h1>
      </Section>
    </DocumentProvider>
  );
}
