import type {
  Article,
  BreadcrumbList,
  FAQPage,
  Graph,
  IdReference,
  ItemList,
  Organization,
  Service,
  Thing,
  WebSite,
  WithContext,
} from "schema-dts";

/** Any schema.org entity accepted by `schema-dts`. */
export type JsonLdNode = Extract<Thing, object>;

import type { JsonLdDocument } from "../core/declare";

export type { JsonLdDocument };

export interface JsonLdEntityIds {
  organization: string;
  website: string;
}

export type JsonLdEntry =
  | {
      kind: "organization";
      source: "generated";
      document: WithContext<Organization>;
    }
  | { kind: "website"; source: "generated"; document: WithContext<WebSite> }
  | { kind: "article"; source: "generated"; document: WithContext<Article> }
  | { kind: "service"; source: "generated"; document: WithContext<Service> }
  | { kind: "faq"; source: "generated"; document: WithContext<FAQPage> }
  | {
      kind: "breadcrumb";
      source: "generated";
      document: WithContext<BreadcrumbList>;
    }
  | { kind: "item-list"; source: "generated"; document: WithContext<ItemList> }
  | { kind: "custom"; source: "site" | "page"; document: JsonLdDocument };

export interface JsonLdTransformContext {
  /** Canonical site origin configured through `createSeo`. */
  origin: string;
  /** Stable identifiers for the plugin's generated site entities. */
  entityIds: JsonLdEntityIds;
  /** Canonical page URL when composition happens for a route. */
  canonical?: string | undefined;
}

/** Return no document to suppress an entry, one to replace it, or an array to expand it. */
export type JsonLdTransformResult =
  | JsonLdDocument
  | ReadonlyArray<JsonLdDocument>
  | false
  | null
  | undefined;

export type JsonLdTransform = (
  entry: JsonLdEntry,
  context: JsonLdTransformContext,
) => JsonLdTransformResult;

export interface SeoJsonLdConfig {
  /** Custom entities included by `generateSiteGraphSchema`. */
  site?:
    | ReadonlyArray<JsonLdDocument>
    | ((entityIds: JsonLdEntityIds) => ReadonlyArray<JsonLdDocument>)
    | undefined;
  /** Open composition hook for generated and custom entries. */
  transform?: JsonLdTransform | undefined;
}

/** Add the schema.org context to an entity while preserving its concrete type. */
export function defineJsonLd<const Node extends JsonLdNode & object>(
  node: Node,
): Node & { "@context": "https://schema.org" } {
  return { "@context": "https://schema.org", ...node };
}

/** Reference a canonical entity declared elsewhere in the same graph or page. */
export function jsonLdRef(id: string): IdReference {
  return { "@id": id };
}

/** Extend a generated or custom document without rebuilding its existing properties. */
export function extendJsonLd<
  const Document extends JsonLdDocument,
  const Extension extends object,
>(document: Document, extension: Extension): Document & Extension {
  return { ...(document as unknown as object), ...extension } as Document &
    Extension;
}

const documentNodes = (document: JsonLdDocument): ReadonlyArray<JsonLdNode> => {
  if ("@graph" in document) {
    return document["@graph"] as ReadonlyArray<JsonLdNode>;
  }
  const { "@context": _context, ...node } = document as unknown as Record<
    string,
    unknown
  >;
  return [node as JsonLdNode];
};

/** Compose related schema.org documents into one graph without nested `@context` values. */
export function jsonLdGraph(documents: ReadonlyArray<JsonLdDocument>): Graph {
  return {
    "@context": "https://schema.org",
    "@graph": documents.flatMap(documentNodes),
  };
}

/** Apply an optional zero/one/many transform while preserving entry order. */
export function composeJsonLd(
  entries: ReadonlyArray<JsonLdEntry>,
  context: JsonLdTransformContext,
  transform?: JsonLdTransform,
): Array<JsonLdDocument> {
  if (transform === undefined) {
    return entries.map((entry) => entry.document as JsonLdDocument);
  }

  return entries.flatMap((entry) => {
    const result = transform(entry, context);
    if (result === undefined || result === null || result === false) return [];
    return Array.isArray(result) ? [...result] : [result as JsonLdDocument];
  });
}
