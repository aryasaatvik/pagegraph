/**
 * Freshness: how long ago each indexable page last changed, by the dates its
 * declaration carries ({@link lastModified}). Pure — the caller injects `now`,
 * so a test and the CLI read the same verdict from the same graph.
 *
 * Only sitemap-eligible pages are judged: a noindex or redirect page is not a
 * refresh candidate. A page with no date is reported as `undated` rather than
 * stale, because age cannot be inferred; the sitemap omits its `<lastmod>` too.
 */

import type { SeoKind } from "./declare";
import type { SeoGraph, SeoSource } from "./graph";
import { isSitemapEligible, lastModified, parseDeclaredDate } from "./projections";

/** Project policy: pages whose last change is older than this are stale. */
export interface FreshnessPolicy {
  readonly maxAgeDays: number;
}

export interface FreshnessEntry {
  readonly path: string;
  readonly kind: SeoKind;
  readonly source: SeoSource;
  /** The declared date, normalized to ISO 8601. */
  readonly lastModified: string;
  /** Whole days between `lastModified` and the report's `asOf`. */
  readonly ageDays: number;
}

export interface FreshnessReport {
  readonly asOf: string;
  readonly maxAgeDays: number;
  /** Pages older than `maxAgeDays`, oldest first: the refresh queue. */
  readonly stale: ReadonlyArray<FreshnessEntry>;
  /** Dated pages within `maxAgeDays`, newest first. */
  readonly fresh: ReadonlyArray<FreshnessEntry>;
  /** Sitemap-eligible pages that declare no date, in graph order. */
  readonly undated: ReadonlyArray<string>;
}

const DAY_MS = 86_400_000;

/**
 * Split the graph's sitemap-eligible pages into stale, fresh, and undated.
 * A date that does not parse is left out; the `invalid-date` check owns it.
 */
export function freshnessReport(
  graph: SeoGraph,
  policy: FreshnessPolicy,
  now: Date,
): FreshnessReport {
  const stale: Array<FreshnessEntry> = [];
  const fresh: Array<FreshnessEntry> = [];
  const undated: Array<string> = [];

  for (const node of graph.nodes.values()) {
    if (!isSitemapEligible(node)) continue;
    const declared = lastModified(node);
    if (declared === undefined) {
      undated.push(node.path);
      continue;
    }
    const time = parseDeclaredDate(declared);
    if (time === undefined) continue;
    const entry: FreshnessEntry = {
      path: node.path,
      kind: node.kind,
      source: node.source,
      lastModified: new Date(time).toISOString(),
      ageDays: Math.max(0, Math.floor((now.getTime() - time) / DAY_MS)),
    };
    (entry.ageDays > policy.maxAgeDays ? stale : fresh).push(entry);
  }

  stale.sort((a, b) => b.ageDays - a.ageDays || (a.path < b.path ? -1 : 1));
  fresh.sort((a, b) => a.ageDays - b.ageDays || (a.path < b.path ? -1 : 1));
  return { asOf: now.toISOString(), maxAgeDays: policy.maxAgeDays, stale, fresh, undated };
}
