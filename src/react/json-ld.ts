/**
 * JSON-LD structured-data generators.
 *
 * schema.org payloads typed against `schema-dts`, which is a types-only devDep —
 * it erases at build, so this module keeps the entry's zero-runtime-dep rule.
 * The brand values (name, logo, sameAs, the Organization description) are the
 * host's, and arrive through {@link SeoConfig}; the schema construction is ours.
 *
 * @see https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data
 * @see https://schema.org/
 */

import type {
  Article,
  BreadcrumbList,
  FAQPage,
  Graph,
  ItemList,
  Organization,
  Person,
  Question,
  Service,
  WebSite,
  WithContext,
} from "schema-dts";

import {
  composeJsonLd as composeEntries,
  jsonLdGraph,
  jsonLdRef,
  type JsonLdDocument,
  type JsonLdEntityIds,
  type JsonLdEntry,
} from "./json-ld-composition";
import type { SeoFaq } from "../core/declare";
import { absoluteUrl, type SeoConfig } from "./site";

export interface ServiceParams {
  name: string;
  description: string;
  serviceType: string;
  provider?: string | undefined;
  areaServed?: string | undefined;
}


export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface ItemListEntry {
  name: string;
  url: string;
}

export interface ArticleParams {
  headline: string;
  description: string;
  image?: string | undefined;
  datePublished: string;
  dateModified?: string | undefined;
  author: {
    name: string;
    url?: string | undefined;
  };
  url: string;
}

/** The JSON-LD generators, bound to one site identity. */
export interface JsonLd {
  readonly entityIds: JsonLdEntityIds;
  /** Brand entity for the Knowledge Graph. Render site-wide (root layout). */
  generateOrganizationSchema: () => WithContext<Organization>;
  /** WebSite entity with a sitelinks search box. Render on the homepage. */
  generateWebsiteSchema: () => WithContext<WebSite>;
  generateServiceSchema: (params: ServiceParams) => WithContext<Service>;
  generateFAQPageSchema: (faqs: SeoFaq[]) => WithContext<FAQPage>;
  generateBreadcrumbSchema: (
    items: BreadcrumbItem[],
  ) => WithContext<BreadcrumbList>;
  /** Describe a visibly rendered, ordered collection of canonical pages. */
  generateItemListSchema: (
    name: string,
    items: ReadonlyArray<ItemListEntry>,
  ) => WithContext<ItemList>;
  generateArticleSchema: (params: ArticleParams) => WithContext<Article>;
  /** Compose the Organization, WebSite, and configured site entities into one graph. */
  generateSiteGraphSchema: () => Graph | undefined;
  /** Apply the configured transform to generated or custom entries. */
  composeJsonLd: (
    entries: ReadonlyArray<JsonLdEntry>,
    context?: { canonical?: string | undefined },
  ) => Array<JsonLdDocument>;
}

export function createJsonLd(config: SeoConfig): JsonLd {
  const { origin, site, organization, website } = config;
  const organizationId = `${origin}/#organization`;
  const websiteId = `${origin}/#website`;
  const entityIds = { organization: organizationId, website: websiteId };

  const generateOrganizationSchema = (): WithContext<Organization> => ({
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": organizationId,
    name: site.name,
    ...(organization.legalName === undefined
      ? {}
      : { legalName: organization.legalName }),
    url: origin,
    logo: absoluteUrl(origin, site.logo),
    description: organization.description,
    sameAs: [...organization.sameAs],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: organization.contactPoint.contactType,
      email: organization.contactPoint.email,
    },
    ...(organization.address === undefined
      ? {}
      : {
          address: {
            "@type": "PostalAddress" as const,
            ...organization.address,
          },
        }),
  });

  const generateWebsiteSchema = (): WithContext<WebSite> => ({
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": websiteId,
    name: site.name,
    url: origin,
    publisher: jsonLdRef(organizationId),
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: absoluteUrl(origin, website.searchPath),
      },
      query: "required name=search_term_string",
    },
  });

  const generateServiceSchema = (
    params: ServiceParams,
  ): WithContext<Service> => ({
    "@context": "https://schema.org",
    "@type": "Service",
    name: params.name,
    description: params.description,
    serviceType: params.serviceType,
    provider: {
      "@type": "Organization",
      ...(params.provider === undefined
        ? { "@id": organizationId, url: origin }
        : {}),
      name: params.provider ?? site.name,
    },
    areaServed: params.areaServed ?? "Worldwide",
  });

  const generateFAQPageSchema = (faqs: SeoFaq[]): WithContext<FAQPage> => {
    const questions: Question[] = faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    }));

    return {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: questions,
    };
  };

  const generateBreadcrumbSchema = (
    items: BreadcrumbItem[],
  ): WithContext<BreadcrumbList> => ({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${origin}${item.url}`,
    })),
  });

  const generateItemListSchema = (
    name: string,
    items: ReadonlyArray<ItemListEntry>,
  ): WithContext<ItemList> => ({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: `${origin}${item.url}`,
    })),
  });

  const generateArticleSchema = (
    params: ArticleParams,
  ): WithContext<Article> => {
    const authorSchema: Person = {
      "@type": "Person",
      name: params.author.name,
      ...(params.author.url && { url: params.author.url }),
    };

    return {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: params.headline,
      description: params.description,
      // Deliberately NOT absolutized: a declared instance image lands verbatim
      // (og:image is where the absolute form is required, and seoHead does that).
      image: params.image ?? absoluteUrl(origin, site.defaultImage),
      datePublished: params.datePublished,
      dateModified: params.dateModified ?? params.datePublished,
      author: authorSchema,
      publisher: {
        "@type": "Organization",
        "@id": organizationId,
        name: site.name,
        logo: {
          "@type": "ImageObject",
          url: absoluteUrl(origin, site.publisherLogo),
        },
      },
      mainEntityOfPage: {
        "@type": "WebPage",
        "@id": params.url,
      },
    };
  };

  const composeJsonLd: JsonLd["composeJsonLd"] = (entries, context = {}) =>
    composeEntries(
      entries,
      {
        origin,
        entityIds,
        ...(context.canonical === undefined
          ? {}
          : { canonical: context.canonical }),
      },
      config.jsonLd?.transform,
    );

  const generateSiteGraphSchema = (): Graph | undefined => {
    const configuredSite =
      typeof config.jsonLd?.site === "function"
        ? config.jsonLd.site(entityIds)
        : (config.jsonLd?.site ?? []);
    const entries: Array<JsonLdEntry> = [
      {
        kind: "organization",
        source: "generated",
        document: generateOrganizationSchema(),
      },
      {
        kind: "website",
        source: "generated",
        document: generateWebsiteSchema(),
      },
      ...configuredSite.map(
        (document): JsonLdEntry => ({
          kind: "custom",
          source: "site",
          document,
        }),
      ),
    ];
    const documents = composeJsonLd(entries);
    return documents.length === 0 ? undefined : jsonLdGraph(documents);
  };

  return {
    entityIds,
    generateOrganizationSchema,
    generateWebsiteSchema,
    generateServiceSchema,
    generateFAQPageSchema,
    generateBreadcrumbSchema,
    generateItemListSchema,
    generateArticleSchema,
    generateSiteGraphSchema,
    composeJsonLd,
  };
}
