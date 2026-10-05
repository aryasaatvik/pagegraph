/**
 * The declaration surface: what a route says about itself in
 * `staticData.seo`. Everything else in this package derives from it.
 *
 * Consumers supply valid route paths, page kinds, and authored fact ids by
 * augmenting {@link Register}, the same pattern TanStack Router uses for its own
 * typed registry. Unaugmented, these fall back to `string`, so the package
 * compiles and behaves on its own.
 */

import type { AnyRouteMatch } from "@tanstack/react-router";
import type { Graph, Thing, WithContext } from "schema-dts";

/**
 * Consumer-augmented registry.
 *
 * ```ts
 * declare module "pagegraph" {
 *   interface Register {
 *     paths: FileRouteTypes["fullPaths"];
 *     kinds: "page" | "article" | "hub";
 *     facts: typeof facts;
 *   }
 * }
 * ```
 */
export interface Register {}

/** Every public full path in the consumer's route tree (type-only; erased at runtime). */
export type PublicPath = Register extends { paths: infer P extends string } ? P : string;

/** The consumer's page taxonomy. A label: nothing in the core branches on it. */
export type SeoKind = Register extends { kinds: infer K extends string } ? K : string;

export interface SitemapPolicy {
  priority: number;
  changeFrequency: "weekly" | "monthly";
}

/** A question and answer the page shows and marks up as FAQPage. */
export interface SeoFaq {
  question: string;
  answer: string;
  category?: string | undefined;
  isHighlighted?: boolean | undefined;
}

/** A top-level JSON-LD entity or graph ready to serialize into a script element. */
export type JsonLdDocument = WithContext<Thing> | Graph;

/** A consumer-owned social image, as an absolute URL or site-relative asset path. */
export interface SeoImage {
  readonly url: string;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly alt?: string | undefined;
}

/**
 * The document head a page ships. A static route declares it once in
 * `staticData.seo.head` and renders it with `seo.head` from `pagegraph/react`;
 * the graph, `pageHeads`, and the checks read the same title, description, and
 * FAQs. A dynamic route passes it to `seoHead(ctx, head)` from its `head()`.
 */
export interface SeoPageHead {
  /**
   * The page title. A route that declares {@link RouteSeo.titleTemplate} gets
   * it applied; otherwise this is the full `<title>`.
   */
  title: string;
  description: string;
  /** Social image override; takes precedence over article.image and the site resolver. */
  image?: SeoImage | undefined;
  ogTitle?: string | undefined;
  ogDescription?: string | undefined;
  /** Override of the route's robots policy. */
  robots?: string | undefined;
  article?:
    | {
        publishedAt: string;
        modifiedAt?: string | undefined;
        author?: { name: string; url?: string | undefined } | undefined;
        image?: string | undefined;
        tags?: ReadonlyArray<string> | undefined;
      }
    | undefined;
  faqs?: ReadonlyArray<SeoFaq> | undefined;
  service?: { name: string; description?: string | undefined; serviceType: string } | undefined;
  /** Standalone keywords meta for non-article pages; article pages derive it from tags. */
  keywords?: ReadonlyArray<string> | undefined;
  /** Visible canonical pages rendered as an ordered collection on this page. */
  itemList?: { name: string; items: ReadonlyArray<{ name: string; url: string }> } | undefined;
  /** Additional schema.org documents for this route. */
  jsonLd?: ReadonlyArray<JsonLdDocument> | undefined;
  /**
   * Explicit canonical path (used for canonical + og:url instead of the match pathname).
   * For routes whose canonical is computed independently of the URL, e.g. a docs splat
   * that derives it from the resolved slug segments in its loader.
   */
  canonicalPath?: string | undefined;
  /**
   * Explicit breadcrumb trail for the BreadcrumbList JSON-LD, overriding the match-chain
   * trail. For routes whose hierarchy lives outside the route tree. Each `path` is a URL path.
   */
  breadcrumbs?: ReadonlyArray<{ name: string; path: string }> | undefined;
}

export interface RouteSeo {
  kind: SeoKind;
  /** Breadcrumb label; fn form reads the match (e.g. loaderData frontmatter title). */
  crumb?: string | ((match: AnyRouteMatch) => string) | undefined;
  /** false = excluded from sitemap. Absent on non-indexable kinds is fine. */
  sitemap?: SitemapPolicy | false | undefined;
  /** meta robots value, e.g. "noindex, follow" on a hub page. */
  robots?: string | undefined;
  /** Typed cross-link edges. */
  related?: ReadonlyArray<PublicPath> | undefined;
  /** How OTHER pages render a card for this page. */
  link?: { title: string; description: string } | undefined;
  /** This route is a redirect/alias. */
  redirectTo?: PublicPath | undefined;
  /**
   * When this page's content last changed meaningfully, as an ISO 8601 date.
   * Feeds the sitemap `<lastmod>` and the freshness report. Content instances
   * carry their own dates instead; a param route's value is never inherited.
   */
  modifiedAt?: string | undefined;
  /** A static page's head, rendered by `seo.head`; the graph and `pageHeads` read it. */
  head?: SeoPageHead | undefined;
  /**
   * Full-title template for pages rendered through this route, with `%s` for the
   * page's own title (e.g. `"%s | Example Blog"`). `seoHead` applies it to the
   * title a dynamic route passes, and the graph applies it to the instances a
   * collection routes through it, so the suffix lives in one place.
   */
  titleTemplate?: string | undefined;
}

/** Apply a {@link RouteSeo.titleTemplate}; no template means the title is already full. */
export function applyTitleTemplate(template: string | undefined, title: string): string {
  // A replacer function keeps `$&` and friends in the title literal.
  return template === undefined ? title : template.replaceAll("%s", () => title);
}

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    seo?: RouteSeo | undefined;
    /** How this route supplies its authored document. */
    markdown?: "rendered" | "source" | undefined;
    /** Group label for this page in llms.txt. */
    llms?: string | undefined;
  }
}
