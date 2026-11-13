import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

export interface DocsLink {
  url: string;
  title: string;
  description: string;
}

export interface DocsNavGroup {
  label: string;
  links: DocsLink[];
}

export interface DocsPageData {
  url: string;
  /** The MDX file the browser collection renders. */
  path: string;
  title: string;
  description: string;
  breadcrumbs: Array<{ name: string; path: string }>;
  related: DocsLink[];
  toc: Array<{ title: string; url: string; depth: number }>;
  nav: DocsNavGroup[];
  editUrl: string;
}

/** Diátaxis groups, in reading order; a page joins the group of its first segment. */
const GROUPS: Array<[label: string, match: (url: string) => boolean]> = [
  ["Start here", (url) => url === "/docs" || url === "/docs/quick-start"],
  ["How-to guides", (url) => url.startsWith("/docs/guides")],
  ["Reference", (url) => url.startsWith("/docs/reference")],
  ["Explanation", (url) => url.startsWith("/docs/concepts")],
];

export const getDocsPage = createServerFn({ method: "GET" })
  .validator((splat: unknown) => (typeof splat === "string" ? splat : ""))
  .handler(async ({ data: splat }): Promise<DocsPageData> => {
    const { docsEntries, docsSource } = await import("./docs-source");
    const slugs = splat.split("/").filter(Boolean);
    const page = docsSource.getPage(slugs);
    if (page === undefined) throw notFound();
    const entries = docsEntries();
    const byUrl = new Map(entries.map((entry) => [entry.url, entry]));
    const link = (url: string): DocsLink => {
      const entry = byUrl.get(url);
      if (entry === undefined) throw new Error(`${page.url} links to unknown docs page ${url}`);
      return { url, title: entry.title, description: entry.description };
    };
    const crumbs: Array<{ name: string; path: string }> = [];
    for (let entry = byUrl.get(page.url); entry !== undefined;) {
      crumbs.unshift({ name: entry.crumb, path: entry.url });
      entry = entry.parent === undefined ? undefined : byUrl.get(entry.parent);
    }
    crumbs.unshift({ name: "Home", path: "/" });
    return {
      url: page.url,
      path: page.path,
      title: page.data.title,
      description: page.data.description,
      breadcrumbs: crumbs,
      related: (page.data.related ?? []).map(link),
      toc: page.data.toc
        .filter((item) => item.depth <= 3)
        .map((item) => ({ title: String(item.title), url: item.url, depth: item.depth })),
      nav: GROUPS.map(([label, match]) => ({
        label,
        links: entries.filter((entry) => match(entry.url)).map((entry) => link(entry.url)),
      })),
      editUrl: `https://github.com/aryasaatvik/pagegraph/blob/main/site/content/docs/${page.path}`,
    };
  });
