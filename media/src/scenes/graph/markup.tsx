import type { SceneMarkup } from "../../scene";
import { Card, Header, Line, Node, Scene } from "../parts";
import { fixtureRobots, graphPages } from "../source";

/** Node positions; widths follow the mono advance (64px of chrome plus 12.6px a character). */
export const layout: Record<(typeof graphPages)[number], { x: number; y: number }> = {
  "/": { x: 140, y: 590 },
  "/pricing": { x: 470, y: 410 },
  "/help": { x: 470, y: 590 },
  "/terms": { x: 470, y: 770 },
  "/blog/second": { x: 830, y: 500 },
  "/blog/first": { x: 830, y: 680 },
};
export const nodeWidth = (path: string) => 64 + 12.6 * path.length;

const left = (path: keyof typeof layout) => ({ x: layout[path].x, y: layout[path].y + 28 });
const right = (path: keyof typeof layout) => ({
  x: layout[path].x + nodeWidth(path),
  y: layout[path].y + 28,
});

/** A horizontal S-curve from one node side to another; its arrowhead is drawn separately. */
function curve(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const mid = (from.x + to.x) / 2;
  return `M${from.x} ${from.y}C${mid} ${from.y} ${mid} ${to.y} ${to.x} ${to.y}`;
}

export const outputs = [
  { label: "sitemap.xml", value: "6 <loc> entries" },
  { label: "robots.txt", value: fixtureRobots.join("\n") },
  { label: "<head>", value: "seo.head, from the same declarations" },
  { label: "llms.txt", value: "graph titles and descriptions" },
  { label: "pagegraph check", value: "the CI gate reads the same graph" },
] as const;

/** The fixture app's graph and everything derived from it. */
export const graph: SceneMarkup = {
  id: "graph",
  render: (size) => (
    <Scene size={size}>
      <Header chapter="02 · Graph" />
      <h1
        className="pg-h pg-abs"
        style={{ left: 120, top: 160, fontSize: 72, whiteSpace: "nowrap" }}
      >
        <Line a="title">One graph, built in your Vite pipeline.</Line>
      </h1>
      <p data-a="sub" className="pg-sub pg-abs" style={{ left: 120, top: 250 }}>
        <span className="pg-mono">pagegraph()</span> evaluates route files and collections with your
        aliases and defines.
      </p>
      <div
        data-a="collection"
        className="pg-abs"
        style={{
          left: 806,
          top: 466,
          width: 290,
          height: 300,
          border: "1.5px dashed var(--pg-line-strong)",
          borderRadius: 14,
        }}
      >
        <span className="pg-edge-label" style={{ left: 18, top: -14 }}>
          collection · blog
        </span>
      </div>
      <svg className="pg-edges" width={size.width} height={size.height}>
        <path
          data-a="edge"
          d={curve(left("/pricing"), right("/"))}
          stroke="var(--pg-ink)"
          strokeWidth="2"
          fill="none"
          pathLength={1}
        />
        <path
          data-a="edge"
          d={curve(left("/blog/second"), right("/pricing"))}
          stroke="var(--pg-lime)"
          strokeWidth="2"
          fill="none"
          pathLength={1}
        />
        <path
          data-a="edge"
          d={curve(left("/blog/first"), right("/pricing"))}
          stroke="var(--pg-lime)"
          strokeWidth="2"
          fill="none"
          pathLength={1}
        />
        {[
          { to: right("/"), color: "var(--pg-ink)" },
          { to: right("/pricing"), color: "var(--pg-lime)" },
        ].map(({ to, color }) => (
          <path key={to.x} data-a="edge-head" d={`M${to.x} ${to.y}l13 -7v14z`} fill={color} />
        ))}
      </svg>
      <span data-a="edge-label" className="pg-edge-label" style={{ left: 250, top: 488 }}>
        crumb-parent
      </span>
      <span
        data-a="edge-label"
        className="pg-edge-label pg-lime"
        style={{ left: 668, top: 586, color: "var(--pg-lime)" }}
      >
        related
      </span>
      {graphPages.map((path) => (
        <Node
          key={path}
          path={path}
          x={layout[path].x}
          y={layout[path].y}
          tone={path === "/pricing" ? "declared" : undefined}
        />
      ))}
      <i
        data-a="divider"
        className="pg-abs"
        style={{
          left: 1180,
          top: 340,
          width: 1.5,
          height: 600,
          background: "var(--pg-line-strong)",
          transformOrigin: "center top",
        }}
      />
      <div
        className="pg-abs"
        style={{
          left: 1230,
          top: 340,
          width: 570,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {outputs.map((output) => (
          <Card
            key={output.label}
            a="output"
            label={output.label}
            style={{ position: "relative", padding: "16px 22px" }}
          >
            <div className="pg-mono" style={{ fontSize: 18, lineHeight: 1.45, whiteSpace: "pre" }}>
              {output.value}
            </div>
          </Card>
        ))}
      </div>
      <p data-a="note" className="pg-note pg-abs" style={{ left: 120, top: 968, margin: 0 }}>
        robotsTxt and sitemapXml serve the graph from one-line Start server routes.
      </p>
    </Scene>
  ),
};
