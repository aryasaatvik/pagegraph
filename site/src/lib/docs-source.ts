import { loader } from "fumadocs-core/source";
import { docs } from "fumadocs-mdx:collections/server";

/** Every docs page, keyed by URL under /docs. Server and build only. */
export const docsSource = loader({ baseUrl: "/docs", source: docs.toFumadocsSource() });

export interface DocsEntry {
  url: string;
  title: string;
  description: string;
  crumb: string;
  related: string[];
  /** The nearest ancestor docs page: a folder index, else /docs. */
  parent: string | undefined;
}

export function docsEntries(): DocsEntry[] {
  const pages = docsSource.getPages();
  const urls = new Set(pages.map((page) => page.url));
  const parentOf = (url: string): string | undefined => {
    if (url === "/docs") return undefined;
    const segments = url.split("/");
    for (let end = segments.length - 1; end > 2; end--) {
      const candidate = segments.slice(0, end).join("/");
      if (urls.has(candidate)) return candidate;
    }
    return "/docs";
  };
  return pages.map((page) => ({
    url: page.url,
    title: page.data.title,
    description: page.data.description,
    crumb: page.data.crumb ?? page.data.title,
    related: page.data.related ?? [],
    parent: parentOf(page.url),
  }));
}
