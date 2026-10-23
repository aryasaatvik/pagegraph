import type { SceneMarkup } from "../../scene";
import { Kicker, Line, Scene } from "../parts";

/** Places a hand-maintained site repeats one page's path. Illustrative, not pagegraph output. */
export const copies = [
  { label: "<head>", value: "canonical example.com/pricing" },
  { label: "sitemap.xml", value: "<loc>example.com/pricing</loc>" },
  { label: "JSON-LD", value: '"item": "example.com/pricing"' },
  { label: "og tags", value: "og:url example.com/pricing" },
  { label: "blog posts", value: 'related: ["/pricing"]' },
  { label: "llms.txt", value: "[Pricing](example.com/pricing.md)" },
] as const;

const offsets = [0, 70, 20, 96, 10, 58];

/** The maintenance problem, in type alone. */
export const hook: SceneMarkup = {
  id: "hook",
  render: (size) => (
    <Scene size={size}>
      <Kicker a="kicker" lime style={{ position: "absolute", left: 120, top: 196 }}>
        For TanStack Start and TanStack Router
      </Kicker>
      <div className="pg-abs" style={{ left: 120, top: 262, display: "flex", gap: 40 }}>
        <span className="pg-mono" style={{ position: "relative", fontSize: 92, fontWeight: 600 }}>
          <span data-a="route">/pricing</span>
          <i
            data-a="strike"
            className="pg-abs"
            style={{
              left: -6,
              right: -6,
              top: "52%",
              height: 7,
              background: "var(--pg-coral)",
              transformOrigin: "left center",
            }}
          />
        </span>
        <span
          data-a="renamed"
          className="pg-mono pg-lime"
          style={{ fontSize: 92, fontWeight: 600 }}
        >
          /plans
        </span>
      </div>
      <div
        className="pg-abs"
        style={{
          left: 1010,
          top: 186,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 14,
        }}
      >
        {copies.map((copy, index) => (
          <span
            key={copy.label}
            data-a="copy"
            className="pg-chip"
            style={{ marginLeft: offsets[index], height: 58 }}
          >
            <i data-a="copy-dot" />
            <span className="pg-kicker" style={{ width: 150, fontSize: 16 }}>
              {copy.label}
            </span>
            <span data-a="copy-value">{copy.value}</span>
          </span>
        ))}
      </div>
      <h1
        className="pg-h pg-abs"
        style={{ left: 120, top: 718, fontSize: 96, whiteSpace: "nowrap", lineHeight: 1.08 }}
      >
        <Line a="headline">Rename one route.</Line>
        <Line a="headline">
          <span className="pg-soft">Every copy of its SEO has to follow.</span>
        </Line>
      </h1>
    </Scene>
  ),
};
