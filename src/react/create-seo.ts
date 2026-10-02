/**
 * The render layer: one route's SEO declaration plus its per-instance content,
 * composed into the meta/link descriptors TanStack Router renders into <head>,
 * with the JSON-LD that page warrants.
 *
 * {@link createSeo} binds the site identity once (see `site.ts`) and returns
 * the bound API, so a route file calls `seoHead(ctx, instance)` and never sees
 * an origin or a brand name.
 */

import type { AnyRouteMatch, MetaDescriptor } from "@tanstack/react-router";

import { applyTitleTemplate, type SeoPageHead } from "../core/declare";

import { resolveCrumbTrail } from "./breadcrumbs";
import type { JsonLdDocument, JsonLdEntry } from "./json-ld-composition";
import { absoluteUrl, type SeoConfig } from "./site";
import { createJsonLd, type JsonLd } from "./json-ld";

/** Structural subset of TanStack's head() ctx — the leaf match plus the full chain. */
export interface SeoHeadCtx {
  matches: ReadonlyArray<AnyRouteMatch>;
  match: AnyRouteMatch;
}

export interface SeoHead {
  meta: NonNullable<AnyRouteMatch["meta"]>;
  links: Array<{ rel: "canonical"; href: string }>;
}

/** The render API, bound to one site identity. */
export interface Seo extends JsonLd {
  seoHead: (ctx: SeoHeadCtx, instance: SeoPageHead) => SeoHead;
  /**
   * `head()` for a static route that declares its head in `staticData.seo.head`:
   *
   * ```ts
   * createFileRoute("/pricing")({
   *   staticData: { seo: { kind: "page", sitemap, head: { title, description, faqs } } },
   *   head: seo.head,
   * })
   * ```
   *
   * The graph, `pageHeads`, and the checks read the same declaration.
   *
   * Generic so TanStack infers nothing from it: a `head` typed with
   * `AnyRouteMatch` would make the route's search and loader types `any`, and
   * that spreads through the route tree.
   */
  head: <Ctx extends SeoHeadCtx>(ctx: Ctx) => SeoHead;
}

/** Strip a trailing slash from a pathname, keeping the root "/" intact. */
function normalizePathname(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

export function createSeo(config: SeoConfig): Seo {
  const { origin, site } = config;
  const jsonLd = createJsonLd(config);

  const seoHead = (ctx: SeoHeadCtx, instance: SeoPageHead): SeoHead => {
    const canonical = `${origin}${instance.canonicalPath ?? normalizePathname(ctx.match.pathname)}`;
    const title = applyTitleTemplate(ctx.match.staticData.seo?.titleTemplate, instance.title);
    const resolvedOgTitle = instance.ogTitle ?? title;
    const resolvedOgDescription =
      instance.ogDescription ?? instance.description;
    const routeSeo = ctx.match.staticData.seo;
    const { article } = instance;
    const jsonLdEntries: Array<JsonLdEntry> = [];

    const meta: Array<MetaDescriptor> = [
      { title },
      { name: "description", content: instance.description },
      { property: "og:title", content: resolvedOgTitle },
      { property: "og:description", content: resolvedOgDescription },
      { property: "og:type", content: article ? "article" : "website" },
      { property: "og:url", content: canonical },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: resolvedOgTitle },
      { name: "twitter:description", content: resolvedOgDescription },
    ];

    const robots = instance.robots ?? routeSeo?.robots;
    if (robots !== undefined) {
      meta.push({ name: "robots", content: robots });
    }

    if (article) {
      if (article.tags?.length) {
        meta.push({ name: "keywords", content: article.tags.join(", ") });
      }
      meta.push(
        { property: "article:published_time", content: article.publishedAt },
        {
          property: "article:modified_time",
          content: article.modifiedAt ?? article.publishedAt,
        },
      );
      if (article.image !== undefined) {
        const imageUrl = absoluteUrl(origin, article.image);
        meta.push(
          { property: "og:image", content: imageUrl },
          { name: "twitter:image", content: imageUrl },
        );
      }
    }

    if (article) {
      jsonLdEntries.push({
        kind: "article",
        source: "generated",
        document: jsonLd.generateArticleSchema({
          headline: resolvedOgTitle,
          description: instance.description,
          image: article.image,
          datePublished: article.publishedAt,
          dateModified: article.modifiedAt ?? article.publishedAt,
          author: article.author ?? site.defaultAuthor,
          url: canonical,
        }),
      });
    }

    if (!article && instance.keywords) {
      meta.push({ name: "keywords", content: instance.keywords.join(", ") });
    }

    if (instance.service) {
      jsonLdEntries.push({
        kind: "service",
        source: "generated",
        document: jsonLd.generateServiceSchema({
          name: instance.service.name,
          description: instance.service.description ?? instance.description,
          serviceType: instance.service.serviceType,
        }),
      });
    }

    if (instance.faqs) {
      jsonLdEntries.push({
        kind: "faq",
        source: "generated",
        document: jsonLd.generateFAQPageSchema([...instance.faqs]),
      });
    }

    if (instance.itemList) {
      jsonLdEntries.push({
        kind: "item-list",
        source: "generated",
        document: jsonLd.generateItemListSchema(
          instance.itemList.name,
          instance.itemList.items,
        ),
      });
    }

    // TanStack accumulates every matched route's head output. Only the current leaf
    // owns the BreadcrumbList; otherwise each parent repeats a progressively stale
    // trail alongside the leaf's canonical trail on nested pages.
    const isLeafMatch = ctx.matches.at(-1)?.id === ctx.match.id;
    const trail = isLeafMatch
      ? (instance.breadcrumbs ?? resolveCrumbTrail(ctx.matches))
      : [];
    if (trail.length >= 2) {
      jsonLdEntries.push({
        kind: "breadcrumb",
        source: "generated",
        document: jsonLd.generateBreadcrumbSchema(
          trail.map((item) => ({ name: item.name, url: item.path })),
        ),
      });
    }

    if (instance.jsonLd) {
      jsonLdEntries.push(
        ...instance.jsonLd.map(
          (document): JsonLdEntry => ({
            kind: "custom",
            source: "page",
            document,
          }),
        ),
      );
    }

    for (const document of jsonLd.composeJsonLd(jsonLdEntries, { canonical })) {
      meta.push({ "script:ld+json": document });
    }

    // React's head types (JSX.IntrinsicElements['meta']) model only <meta> attributes;
    // TanStack renders `script:ld+json` entries as JSON-LD <script> tags at runtime. The
    // installed @tanstack/react-router augments leaf head meta to those JSX attributes, so
    // the JSON-LD entries are asserted to it (same pattern as an inline root JSON-LD).
    const head: SeoHead = {
      meta: meta as NonNullable<AnyRouteMatch["meta"]>,
      links: [{ rel: "canonical", href: canonical }],
    };
    return config.transformHead === undefined ? head : config.transformHead(head);
  };

  const head = <Ctx extends SeoHeadCtx>(ctx: Ctx): SeoHead => {
    const declared = ctx.match.staticData.seo?.head;
    if (declared === undefined) {
      throw new Error(`seo.head needs staticData.seo.head on route ${ctx.match.routeId}`);
    }
    return seoHead(ctx, declared);
  };

  return { seoHead, head, ...jsonLd };
}
