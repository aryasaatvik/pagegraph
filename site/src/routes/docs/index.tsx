import { createFileRoute, Link } from "@tanstack/react-router";
import browserCollections from "fumadocs-mdx:collections/browser";
import { createElement, useId } from "react";

import { DocsLayout } from "../../components/docs-layout";
import { getDocsPage, type DocsPageData } from "../../lib/docs-data";
import { seo } from "../../lib/seo";

const clientLoader = browserCollections.docs.createClientLoader({
  component({ default: MDX }, props: { data: DocsPageData; query: string }) {
    return (
      <DocsLayout data={props.data}>
        <DocsSearch data={props.data} query={props.query} />
        {props.query === "" && <MDX />}
      </DocsLayout>
    );
  },
});

/** Filters every docs page by title and description; the WebSite JSON-LD search target. */
function DocsSearch({ data, query }: { data: DocsPageData; query: string }) {
  const id = useId();
  const navigate = Route.useNavigate();
  const needle = query.trim().toLowerCase();
  const matches =
    needle === ""
      ? []
      : data.nav
          .flatMap((group) => group.links)
          .filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(needle));
  return (
    <search className="docs-search">
      <label htmlFor={id}>Search the docs</label>
      <input
        id={id}
        type="search"
        value={query}
        placeholder="sitemap, check, og image…"
        autoComplete="off"
        onChange={(event) =>
          navigate({ search: { q: event.target.value || undefined }, replace: true })
        }
      />
      {needle !== "" && (
        <div aria-live="polite">
          <p className="docs-count">
            {matches.length === 0
              ? `No page mentions "${query.trim()}". Try a shorter word.`
              : `${matches.length} ${matches.length === 1 ? "page" : "pages"}`}
          </p>
          <ul className="results">
            {matches.map((item) => (
              <li key={item.url}>
                <Link to={item.url}>
                  <b>{item.title}</b>
                  <span>{item.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </search>
  );
}

export const Route = createFileRoute("/docs/")({
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search.q === "string" && search.q !== "" ? { q: search.q } : {},
  staticData: {
    markdown: "source",
    llms: "Docs",
    seo: {
      kind: "page",
      crumb: "Docs",
      sitemap: { priority: 0.9, changeFrequency: "monthly" },
      link: {
        title: "PageGraph docs",
        description: "Tutorial, how-to guides, reference and concepts.",
      },
      head: {
        title: "Docs | PageGraph",
        description:
          "Learn PageGraph: a tutorial, how-to guides, the CLI and configuration reference, and how the route graph works.",
      },
    },
  },
  loader: async () => {
    const data = await getDocsPage({ data: "" });
    await clientLoader.preload(data.path);
    return data;
  },
  head: seo.head,
  component: DocsIndex,
});

function DocsIndex() {
  const data = Route.useLoaderData();
  const { q } = Route.useSearch();
  return createElement(clientLoader.getComponent(data.path), { data, query: q ?? "" });
}
