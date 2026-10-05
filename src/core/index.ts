/**
 * `pagegraph` — declare SEO once on the route; the sitemap, robots.txt, the
 * cross-link graph and the check engine all derive from that declaration.
 *
 * This entry is the pure core: zero runtime dependencies, no React, no I/O.
 * Importing it also installs the `staticData.seo` augmentation on TanStack
 * Router's `StaticDataRouteOption`.
 */

export { applyTitleTemplate } from "./declare";
export type { JsonLdDocument, PublicPath, Register, RouteSeo, SeoFaq, SeoKind, SeoImage, SeoPageHead, SitemapPolicy } from "./declare";

export { buildSeoGraph, resolveOgImage } from "./graph";
export type {
  BuildSeoGraphInput,
  OgImageNode,
  OgImageResolver,
  SeoCollection,
  SeoEdge,
  SeoEdgeType,
  SeoGraph,
  SeoInstance,
  SeoNode,
  SeoNodeHead,
  SeoRouteNode,
  SeoSource,
} from "./graph";

export { contentCollection } from "./collections";
export type { ContentCollectionOptions, ContentEntry } from "./collections";

export { graphFromJson, graphToJson } from "./wire";
export type { SeoGraphJson } from "./wire";

export {
  contentSignal,
  inspectNode,
  isSitemapEligible,
  lastModified,
  renderRobots,
  renderSitemap,
} from "./projections";
export type { NodeReport, ProjectionConfig, RobotsConfig } from "./projections";

export {
  checkCoverage,
  checkFreshness,
  checkGraph,
  checkRenderedCoverage,
  hasStructuralViolations,
} from "./checks";
export type { CheckGraphOptions, CoverageRule, OgImagePolicy, Severity, Violation } from "./checks";

export {
  checkPageContent,
  checkRenderedContent,
  extractPageContent,
  renderedCheckTargets,
} from "./content";
export type {
  ContentCheckOptions,
  ContentFinding,
  ContentPolicy,
  ContentRuleName,
  Heading,
  JsonLdNode,
  PageContent,
  RenderedDocument,
  WordCountRule,
} from "./content";

export { freshnessReport } from "./freshness";
export type { FreshnessEntry, FreshnessPolicy, FreshnessReport } from "./freshness";

export {
  candidateSourceText,
  decodeRenderedEdges,
  generateLinkCandidates,
  matchesClusterFilter,
  undirectedEdgeKey,
} from "./link-candidates";
export type {
  LinkCandidateOptions,
  LinkCandidatePair,
  LinkCandidateResult,
  LinkClusterSummary,
} from "./link-candidates";

export { hasBlockingIssues, inspectHtml } from "./inspect-html";
export type { JsonLdReport, LiveHeadReport } from "./inspect-html";

export { pageHeads, selectPageHeadNodes } from "./page-heads";
export type { PageHead, PageHeadsOptions } from "./page-heads";

export { resolveRouteLink } from "./resolve-route-link";

export {
  buildRenderedGraph,
  decodeRenderedEdgeArtifact,
  diffLinkGraph,
  extractAnchors,
  normalizePath,
  RENDERED_EDGE_ARTIFACT_SCHEMA_VERSION,
  renderedGraphFromEdges,
} from "./links";
export type {
  Anchor,
  AnchorRegion,
  LinkEdge,
  LinkGraphDiff,
  RenderedEdgeArtifact,
  RenderedEdgeArtifactCrawl,
  RenderedEdgeFailure,
  RenderedGraph,
  RenderedPage,
  SimpleEdge,
} from "./links";

export * from "../markdown/index";
