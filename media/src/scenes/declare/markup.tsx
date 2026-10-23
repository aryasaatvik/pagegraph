import type { SceneMarkup } from "../../scene";
import { Arrow, Card, Code, Header, Line, Rows, Scene } from "../parts";
import { graphEdges, pricingHead, pricingLines, pricingRoute, pricingSitemap } from "../source";

const range = (name: keyof typeof pricingLines) => ({
  from: pricingLines[name][0],
  to: pricingLines[name][1],
});

/** The real pricing declaration, with each output it feeds. */
export const declare: SceneMarkup = {
  id: "declare",
  render: (size) => (
    <Scene size={size}>
      <Header chapter="01 · Declare" />
      <h1
        className="pg-h pg-abs"
        style={{ left: 120, top: 160, fontSize: 72, whiteSpace: "nowrap" }}
      >
        <Line a="title">Declare it once, on the route.</Line>
      </h1>
      <p data-a="sub" className="pg-sub pg-abs" style={{ left: 120, top: 250 }}>
        <span className="pg-mono pg-lime">staticData.seo</span> holds the crawl policy and the head
        together. <span className="pg-mono">seo.head</span> renders it.
      </p>
      <Code
        code={pricingRoute.code}
        file="src/routes/(marketing)/pricing.tsx"
        fontSize={18}
        lineHeight={30}
        box={{ left: 120, top: 330, width: 1060, height: 614 }}
        highlights={[
          { a: "hi-head", from: range("head").from, to: range("head").to },
          { a: "hi-render", ...range("render") },
          { a: "hi-sitemap", ...range("sitemap") },
          { a: "hi-crumb", ...range("crumb") },
          { a: "hi-link", ...range("link") },
        ]}
      />
      <Card
        a="out-head"
        tone="lime"
        label="<head> from seo.head"
        style={{ left: 1220, top: 330, width: 580, height: 270 }}
      >
        <div style={{ fontSize: 17 }}>
          <Rows rows={pricingHead.map((row) => ({ name: row.name, value: row.value }))} />
        </div>
      </Card>
      <Card
        a="out-sitemap"
        label="sitemap.xml"
        style={{ left: 1220, top: 616, width: 580, height: 150 }}
      >
        <div className="pg-mono" style={{ fontSize: 17, lineHeight: 1.55 }}>
          {pricingSitemap.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </Card>
      <Card a="out-graph" label="graph" style={{ left: 1220, top: 782, width: 580, height: 158 }}>
        <Rows
          rows={[
            {
              name: graphEdges[0].type,
              value: (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  {graphEdges[0].from}
                  <Arrow size={20} color="var(--pg-soft)" />
                  {graphEdges[0].to}
                </span>
              ),
            },
            { name: "link card", value: "Pricing · Simple pricing." },
          ]}
        />
      </Card>
      <p data-a="note" className="pg-note pg-abs" style={{ left: 120, top: 968, margin: 0 }}>
        The graph and the checks read this same declaration.
      </p>
    </Scene>
  ),
};
