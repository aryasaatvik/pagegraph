import type { SceneMarkup } from "../../scene";
import { Header, Scene } from "../parts";

/** Package entries by where they run. `tests/copy.test.ts` checks them against package.json. */
export const runtimeEntries = [
  {
    entry: "pagegraph",
    does: "Graph, sitemap and robots renderers, page heads, checks, facts, Markdown",
  },
  {
    entry: "pagegraph/react",
    does: "createSeo and seo.head, Breadcrumbs, JSON-LD, authored page primitives",
  },
  {
    entry: "pagegraph/tanstack-start/server",
    does: "robotsTxt, sitemapXml, and llmsTxt route handlers",
  },
  {
    entry: "pagegraph/tanstack-start/markdown",
    does: "markdownRequest, the Start server capture adapter",
  },
  { entry: "pagegraph/tanstack-start/react", does: "The capture-aware Link" },
  { entry: "pagegraph/tanstack-start/prerender-worker", does: "The non-deployed prerender Worker" },
] as const;

export const buildEntries = [
  { entry: "pagegraph/tanstack-start", does: "The pagegraph() Vite plugin and tanstackStartGraph" },
  { entry: "pagegraph/vite", does: "The seoRouteConfig coverage gate for Router-only apps" },
  { entry: "pagegraph/config", does: "defineSeoConfig, viteGraphLoader, loadPageHeads" },
  { entry: "pagegraph/claims", does: "Claims inputs and committed claims checks" },
  { entry: "pagegraph/audit", does: "Audit services, scanners, rules, and report schemas" },
  { entry: "pagegraph/oxlint", does: "The no-bare-text and t-children lint rules" },
  {
    entry: "pagegraph (bin)",
    does: "The CLI, on Bun, with its own Effect and Pi runtimes bundled",
  },
] as const;

function Column({
  x,
  title,
  where,
  entries,
  lime,
}: {
  x: number;
  title: string;
  where: string;
  entries: ReadonlyArray<{ entry: string; does: string }>;
  lime?: boolean;
}) {
  return (
    <section className="pg-abs" style={{ left: x, top: 316, width: 790 }}>
      <h2 className="pg-h" style={{ fontSize: 40, fontWeight: 700 }}>
        {title}
      </h2>
      <div className="pg-meta" style={{ marginTop: 12 }}>
        {where}
      </div>
      <ul style={{ margin: "26px 0 0", padding: 0, listStyle: "none" }}>
        {entries.map((entry) => (
          <li
            key={entry.entry}
            style={{
              padding: "10px 0",
              borderTop: "1.5px solid var(--pg-line)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <span
              className="pg-mono"
              style={{
                fontSize: 21,
                fontWeight: 600,
                color: lime ? "var(--pg-lime)" : "var(--pg-ink)",
              }}
            >
              {entry.entry}
            </span>
            <span className="pg-soft" style={{ fontSize: 19 }}>
              {entry.does}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Infographic: runtime entries beside build-only entries. */
export const runtimeStill: SceneMarkup = {
  id: "runtime-still",
  render: (size) => (
    <Scene size={size}>
      <Header chapter="What runs where" />
      <h1
        className="pg-h pg-abs"
        style={{ left: 120, top: 150, fontSize: 64, whiteSpace: "nowrap" }}
      >
        Runtime entries stay portable. Build code stays out.
      </h1>
      <p className="pg-sub pg-abs" style={{ left: 120, top: 228, fontSize: 26 }}>
        Every entry belongs to one place. The plugin ships the graph to the server runtime as data.
      </p>
      <Column
        x={120}
        title="Runtime"
        where="Worker · SSR · browser"
        entries={runtimeEntries}
        lime
      />
      <i
        className="pg-abs"
        style={{
          left: 960,
          top: 316,
          width: 1.5,
          height: 620,
          background: "var(--pg-line-strong)",
        }}
      />
      <Column
        x={1010}
        title="Build and CLI"
        where="vite.config.ts · pagegraph.config.ts · Bun"
        entries={buildEntries}
      />
      <p className="pg-note pg-abs" style={{ left: 120, top: 966, width: 790, margin: 0 }}>
        Runtime entries have no dependencies beyond their listed peers; a test pins each entry's
        import graph.
      </p>
      <p className="pg-note pg-abs" style={{ left: 1010, top: 966, width: 790, margin: 0 }}>
        Under workerd, worker, and browser conditions, build entries resolve to a stub that throws
        an error naming the entry.
      </p>
    </Scene>
  ),
};
