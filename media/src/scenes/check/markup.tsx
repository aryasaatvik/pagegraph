import type { SceneMarkup } from "../../scene";
import { Badge, Card, Header, Line, Scene, Terminal, highlightLine, type TermLine } from "../parts";
import { checkReport, collectionEntry, rename } from "../source";

const relatedLine =
  collectionEntry.code
    .split("\n")
    .find((line) => line.includes("related:"))
    ?.trim() ?? "";

export const reportLines: ReadonlyArray<TermLine> = [
  { text: `$ ${checkReport.command}`, tone: "lime" },
  { text: "" },
  ...checkReport.structural.split("\n").map((text): TermLine => ({
    text,
    tone: text.trimStart().startsWith("fix:") ? "soft" : "ink",
  })),
  { text: "" },
  { text: checkReport.trimmed, tone: "faint" },
  { text: "" },
  { text: checkReport.summary, tone: "coral" },
];

/** The rename from the hook, now caught: the real report, exit 1. */
export const check: SceneMarkup = {
  id: "check",
  render: (size) => (
    <Scene size={size}>
      <Header chapter="03 · Check" />
      <h1
        className="pg-h pg-abs"
        style={{ left: 120, top: 160, fontSize: 72, whiteSpace: "nowrap" }}
      >
        <Line a="title">Rename a route. The check names what broke.</Line>
      </h1>
      <Card
        a="edit"
        label="src/routes/(marketing)/pricing.tsx, renamed"
        style={{ left: 120, top: 268, width: 820, height: 132 }}
      >
        <div className="pg-mono" style={{ fontSize: 20, lineHeight: 1.5, whiteSpace: "pre" }}>
          <div data-a="edit-from" style={{ color: "var(--pg-coral)" }}>
            - {rename.from}
          </div>
          <div data-a="edit-to" style={{ color: "var(--pg-lime)" }}>
            + {rename.to}
          </div>
        </div>
      </Card>
      <Card
        a="stale"
        tone="coral"
        label="src/collections.ts, unchanged"
        style={{ left: 980, top: 268, width: 820, height: 132 }}
      >
        <div className="pg-mono" style={{ fontSize: 20, lineHeight: 1.5, whiteSpace: "pre" }}>
          <div> {highlightLine(relatedLine)}</div>
        </div>
      </Card>
      <Terminal
        lines={reportLines}
        fontSize={19}
        lineHeight={28}
        box={{ left: 120, top: 432, width: 1200, height: 508 }}
      />
      <div className="pg-abs" style={{ left: 1370, top: 432, width: 430 }}>
        <Badge a="exit" tone="coral">
          exit 1
        </Badge>
        <p
          data-a="verdict"
          className="pg-h"
          style={{ marginTop: 26, fontSize: 40, fontWeight: 640, lineHeight: 1.12 }}
        >
          Two blog posts still link to a page that no longer exists.
        </p>
        <i
          data-a="rule"
          className="pg-rule"
          style={{ marginTop: 34, marginBottom: 26, width: "100%" }}
        />
        <p data-a="aside" className="pg-note" style={{ margin: 0 }}>
          Structural violations fail the check. Editorial ones warn.
        </p>
        <p data-a="aside" className="pg-note" style={{ margin: "18px 0 0" }}>
          With routeConfig.enforceCoverageIn, the Vite build also fails for a page in those route
          groups that declares neither staticData nor head.
        </p>
      </div>
    </Scene>
  ),
};
