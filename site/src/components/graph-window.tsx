import { useLayoutEffect, useMemo, useRef, useState } from "react";

import type { GraphView, GraphViewNode } from "../lib/graph-view";

const ROW = 25;

interface Placed extends GraphViewNode {
  depth: number;
  label: string;
  x: number;
  y: number;
  end: number;
}

function place(view: GraphView, width: number) {
  const indent = width < 420 ? 20 : 24;
  const byPath = new Map(view.nodes.map((node) => [node.path, node]));
  const depthOf = (node: GraphViewNode): number =>
    node.parent === undefined ? 0 : 1 + depthOf(byPath.get(node.parent)!);
  const placed: Placed[] = view.nodes.map((node, index) => {
    const depth = depthOf(node);
    const label = node.path === "/" ? "/" : `/${node.path.split("/").pop()}`;
    const x = 18 + depth * indent;
    return { ...node, depth, label, x, y: 16 + index * ROW, end: x + 14 + label.length * 7.55 };
  });
  const rail = Math.max(...placed.map((node) => node.end)) + 18;
  return {
    placed,
    byPath: new Map(placed.map((node) => [node.path, node])),
    rail,
    room: Math.max(36, width - rail - 10),
    height: 6 + placed.length * ROW,
  };
}

function trail(node: Placed, byPath: Map<string, Placed>): string[] {
  const parent = node.parent === undefined ? undefined : byPath.get(node.parent);
  return parent === undefined ? [node.crumb] : [...trail(parent, byPath), node.crumb];
}

const q = (value: string) => <span className="s">{JSON.stringify(value)}</span>;

function Declaration({ node, related }: { node: Placed; related: string[] }) {
  const lines: Array<[string, React.ReactNode]> = [];
  if (node.source === "route") {
    lines.push(["kind", q("page")], ["crumb", q(node.crumb)]);
    if (node.priority !== undefined)
      lines.push([
        "sitemap",
        <>
          {"{ "}
          <span className="k">priority</span>: <span className="n">{node.priority}</span>
          {" }"}
        </>,
      ]);
  } else {
    lines.push(["title", q(node.heading)]);
  }
  if (related.length > 0)
    lines.push([
      "related",
      <>
        [
        {related.map((path, index) => (
          <span key={path}>
            {index > 0 && ", "}
            {q(path)}
          </span>
        ))}
        ]
      </>,
    ]);
  if (node.source === "route")
    lines.push([
      "head",
      <>
        {"{ "}
        <span className="k">title</span>: {q(node.title)}
        {" }"}
      </>,
    ]);
  else if (node.description !== undefined) lines.push(["description", q(node.description)]);
  return (
    <pre>
      {lines.map(([key, value]) => (
        <span key={key}>
          <span className="k">{key}</span>: {value},{"\n"}
        </span>
      ))}
    </pre>
  );
}

export function GraphWindow({ view }: { view: GraphView }) {
  const holder = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(460);
  const [selected, setSelected] = useState(
    view.nodes.find((node) => node.path === "/docs/quick-start")?.path ?? view.nodes[0]!.path,
  );
  useLayoutEffect(() => {
    const element = holder.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { placed, byPath, rail, room, height } = useMemo(() => place(view, width), [view, width]);
  const maxDy = Math.max(
    1,
    ...view.related.map(([a, b]) => Math.abs(byPath.get(a)!.y - byPath.get(b)!.y)),
  );
  const ports = new Set(view.related.flat());
  const node = byPath.get(selected)!;
  const outgoing = view.related.filter(([from]) => from === selected).map(([, to]) => to);
  const crumbs = trail(node, byPath);
  const touches = (a: string, b: string) => a === selected || b === selected;
  const select = (path: string) => setSelected(path);

  return (
    <div className="window">
      <div className="wbar">
        <span className="path">pagegraph graph</span>
        <span className="key" aria-hidden="true">
          <span>
            <i />
            Breadcrumb
          </span>
          <span>
            <i className="rel" />
            Related link
          </span>
        </span>
      </div>
      <div className="wbody">
        <div className="tree" ref={holder}>
          <svg
            className="graph"
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="group"
            aria-label="This site's route graph. Choose a page to see its declaration."
          >
            {placed
              .filter((child) => child.parent !== undefined)
              .map((child) => {
                const parent = byPath.get(child.parent!)!;
                return (
                  <path
                    key={`crumb:${child.path}`}
                    className={`edge${touches(child.path, parent.path) ? " on" : ""}`}
                    d={`M${parent.x} ${parent.y + 6}V${child.y}H${child.x - 6}`}
                  />
                );
              })}
            {view.related.map(([from, to]) => {
              const a = byPath.get(from)!;
              const b = byPath.get(to)!;
              const reach = 12 + (Math.abs(a.y - b.y) / maxDy) * Math.min(room - 12, 150);
              return (
                <path
                  key={`rel:${from}>${to}`}
                  className={`edge rel${touches(from, to) ? " on" : ""}`}
                  d={`M${rail} ${a.y}C${rail + reach} ${a.y} ${rail + reach} ${b.y} ${rail} ${b.y}`}
                />
              );
            })}
            {[...ports].map((path) => {
              const port = byPath.get(path)!;
              return (
                <g key={`port:${path}`}>
                  <path
                    className={`edge lead${path === selected ? " on" : ""}`}
                    d={`M${port.end + 6} ${port.y}H${rail}`}
                  />
                  <circle className="port" cx={rail} cy={port.y} r={2.25} />
                </g>
              );
            })}
            {placed.map((item) => {
              const size = item.depth === 0 ? 10 : 8.5;
              const on = item.path === selected;
              return (
                <g
                  key={item.path}
                  className={`node${on ? " sel" : ""}`}
                  tabIndex={0}
                  role="button"
                  aria-pressed={on}
                  aria-label={`${item.path}: ${item.title}`}
                  onClick={() => select(item.path)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      select(item.path);
                    }
                  }}
                >
                  <rect
                    className="hit"
                    x={item.x - 10}
                    y={item.y - 11.5}
                    width={item.end - item.x + 14}
                    height={23}
                    rx={4}
                  />
                  <rect
                    className="box"
                    x={item.x - size / 2}
                    y={item.y - size / 2}
                    width={size}
                    height={size}
                  />
                  <text x={item.x + 11} y={item.y + 4.2}>
                    {item.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="panel" aria-live="polite">
          <section>
            <h3>
              {node.source === "route" ? "staticData.seo on " : "Frontmatter of "}
              <code>{node.path}</code>
            </h3>
            <Declaration node={node} related={outgoing} />
          </section>
          <section>
            <h3>Derived at build</h3>
            <dl className="out">
              <dt>Title</dt>
              <dd>{node.title}</dd>
              <dt>Canonical</dt>
              <dd>{new URL(node.path, view.origin).href}</dd>
              {node.lastmod !== undefined && (
                <>
                  <dt>Sitemap</dt>
                  <dd>&lt;lastmod&gt;{node.lastmod}</dd>
                </>
              )}
              <dt>{crumbs.length > 1 ? "Breadcrumb" : "JSON-LD"}</dt>
              <dd>{crumbs.length > 1 ? crumbs.join(" › ") : "WebSite, Organization"}</dd>
              <dt>Markdown</dt>
              <dd>{node.path === "/" ? "/index.md" : `${node.path}.md`}</dd>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
