import type { SceneMarkup } from "../../scene";
import { Header, Scene } from "../parts";

/** Where a broken declaration surfaces, in the order a change meets each gate. */
export const gates = [
  {
    stage: "Type check",
    when: "Opt in: augment Register",
    items: [
      "With your route paths registered, related and redirectTo accept only real routes.",
      "Renaming a route turns a stale related or redirectTo into a compile error.",
    ],
  },
  {
    stage: "Vite build",
    when: "pagegraph() plugin",
    items: [
      "A route file that cannot evaluate is named, with how to exclude it.",
      "Opt in: routeConfig.enforceCoverageIn fails a page in those groups that declares neither staticData nor head.",
      "Opt in: claims replays committed answers; a missing answer or a violation fails the build.",
    ],
  },
  {
    stage: "pagegraph check",
    when: "CI, through pagegraph.config.ts",
    items: [
      "Structural violations exit 1: dead or duplicate edges, path collisions, sitemap contradictions, invalid dates, missing OG images.",
      "Editorial findings warn: shared titles and descriptions, description length, stale pages.",
      "--site also checks each declared page's rendered HTML.",
    ],
  },
  {
    stage: "Served site",
    when: "pagegraph links verify <url>",
    items: [
      "Crawls served HTML: real depth, orphan pages, and declared versus rendered links.",
      "--assert-coverage holds contextual-link coverage rules against the served anchors.",
    ],
  },
] as const;

/** Infographic: the gates, left to right. */
export const gatesStill: SceneMarkup = {
  id: "gates-still",
  render: (size) => (
    <Scene size={size}>
      <Header chapter="Where drift is caught" />
      <h1
        className="pg-h pg-abs"
        style={{ left: 120, top: 150, fontSize: 64, whiteSpace: "nowrap" }}
      >
        Where a broken declaration surfaces
      </h1>
      <p className="pg-sub pg-abs" style={{ left: 120, top: 228, fontSize: 26 }}>
        Each gate reads the same declarations. The ones marked opt in run only when configured.
      </p>
      <i
        className="pg-abs"
        style={{
          left: 120,
          top: 334,
          width: 1680,
          height: 1.5,
          background: "var(--pg-line-strong)",
        }}
      />
      <div
        className="pg-abs"
        style={{ left: 120, top: 316, width: 1680, display: "flex", gap: 32 }}
      >
        {gates.map((gate, index) => (
          <section key={gate.stage} style={{ flex: "1 1 0", minWidth: 0 }}>
            <span
              className="pg-badge pg-badge--lime"
              style={{
                height: 36,
                minWidth: 36,
                padding: 0,
                justifyContent: "center",
                borderRadius: 18,
              }}
            >
              {index + 1}
            </span>
            <h2 className="pg-h" style={{ marginTop: 28, fontSize: 48, fontWeight: 700 }}>
              {gate.stage}
            </h2>
            <div className="pg-meta" style={{ marginTop: 12 }}>
              {gate.when}
            </div>
            <ul
              style={{
                margin: "32px 0 0",
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 30,
              }}
            >
              {gate.items.map((item) => (
                <li
                  key={item}
                  style={{
                    fontSize: 25,
                    lineHeight: 1.4,
                    paddingLeft: 18,
                    borderLeft: `3px solid ${item.startsWith("Opt in") ? "var(--pg-line-strong)" : "var(--pg-lime)"}`,
                  }}
                >
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="pg-note pg-abs" style={{ left: 120, top: 984, margin: 0 }}>
        These gates check declarations and served pages. None of them measures search rankings.
      </p>
    </Scene>
  ),
};
