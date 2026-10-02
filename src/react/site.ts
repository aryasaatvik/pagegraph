/**
 * Site identity — the values a package cannot know about its host.
 *
 * Bound once through {@link createSeo}, so the ~30 route call sites that render
 * a head never thread an origin or a brand name through their arguments.
 * Everything here is a *value*; the schema construction it feeds lives in
 * `json-ld.ts`.
 */

import type { SeoHead } from "./create-seo";
import type { SeoJsonLdConfig } from "./json-ld-composition";

/** Absolute URL for an origin-relative path; an already-absolute URL passes through. */
export function absoluteUrl(origin: string, pathOrUrl: string): string {
  return pathOrUrl.startsWith("http") ? pathOrUrl : `${origin}${pathOrUrl}`;
}

export interface SeoSite {
  /** Brand name: Organization/WebSite `name`, Article publisher, Service provider default. */
  name: string;
  /** Organization `logo`. Origin-relative path or absolute URL. */
  logo: string;
  /** Article `publisher.logo` (Google wants an ImageObject distinct from the brand mark). */
  publisherLogo: string;
  /** Article `image` when the instance declares none. */
  defaultImage: string;
  /** Article `author` when the instance declares none. */
  defaultAuthor: { name: string; url?: string | undefined };
}

/** Public mailing address rendered as a schema.org PostalAddress. */
export interface SeoPostalAddress {
  streetAddress: string;
  addressLocality: string;
  addressRegion: string;
  postalCode: string;
  addressCountry: string;
}

/** The site-wide Organization entity (Knowledge Graph). */
export interface SeoOrganization {
  legalName?: string | undefined;
  description: string;
  sameAs: ReadonlyArray<string>;
  contactPoint: { contactType: string; email: string };
  address?: SeoPostalAddress | undefined;
}

/** The site-wide WebSite entity (sitelinks search box). */
export interface SeoWebsite {
  /** Origin-relative search target carrying the `{search_term_string}` placeholder. */
  searchPath: string;
}

export interface SeoConfig {
  /** Canonical origin, no trailing slash — e.g. `https://example.com`. */
  origin: string;
  site: SeoSite;
  organization: SeoOrganization;
  website: SeoWebsite;
  jsonLd?: SeoJsonLdConfig | undefined;
  /**
   * Last-mile override for every head `seoHead` renders, e.g. to append
   * site-specific meta. Runs after the canonical, title template, and JSON-LD.
   */
  transformHead?: ((head: SeoHead) => SeoHead) | undefined;
}
