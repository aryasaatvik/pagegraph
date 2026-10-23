import type { SceneMarkup } from "../../scene";
import { Arrow, Card, Code, Header, Line, Scene } from "../parts";
import { authoredSection, dedent, humansOnly, llmsEntry, markdownTwin } from "../source";

/** Display lines of the authored section that resolve a fact. */
const factLines = dedent(authoredSection.code)
  .split("\n")
  .flatMap((line, index) => (line.includes("<Fact ") ? [index] : []));

/** The authored hero section and the Markdown twin and llms.txt entry the build writes. */
export const markdown: SceneMarkup = {
  id: "markdown",
  render: (size) => (
    <Scene size={size}>
      <Header chapter="04 · Markdown" />
      <h1
        className="pg-h pg-abs"
        style={{ left: 120, top: 160, fontSize: 72, whiteSpace: "nowrap" }}
      >
        <Line a="title">Authored pages ship as Markdown, too.</Line>
      </h1>
      <p data-a="sub" className="pg-sub pg-abs" style={{ left: 120, top: 250 }}>
        Mark page text with <span className="pg-mono">pagegraph/react</span>. After prerender, each
        rendered page gets a Markdown twin.
      </p>
      <Code
        code={dedent(authoredSection.code)}
        file="src/routes/index.tsx"
        fontSize={17}
        lineHeight={25}
        box={{ left: 120, top: 330, width: 600, height: 654 }}
        highlights={factLines.map((line) => ({ a: "hi-fact", from: line, to: line }))}
      />
      <div data-a="arrow" className="pg-abs" style={{ left: 742, top: 470 }}>
        <Arrow size={40} color="var(--pg-lime)" />
      </div>
      <Card
        a="twin"
        tone="lime"
        label="dist/client/index.md"
        style={{ left: 806, top: 330, width: 994, height: 296 }}
      >
        <div className="pg-mono" style={{ fontSize: 22, lineHeight: 1.6, whiteSpace: "pre" }}>
          {markdownTwin.map((line) => (
            <div key={line} data-a="twin-line">
              {line}
            </div>
          ))}
          <div data-a="twin-human" style={{ color: "var(--pg-faint)", marginTop: 6 }}>
            <s>{humansOnly}</s>
            <span style={{ fontSize: 17, marginLeft: 18 }}>ForHumans, left out</span>
          </div>
        </div>
      </Card>
      <Card a="llms" label="llms.txt" style={{ left: 806, top: 650, width: 994, height: 150 }}>
        <div className="pg-mono" style={{ fontSize: 20, lineHeight: 1.6, whiteSpace: "pre" }}>
          <div>## Pages</div>
          <div>{llmsEntry}</div>
        </div>
      </Card>
      <p
        data-a="note"
        className="pg-note pg-abs"
        style={{ left: 806, top: 830, margin: 0, width: 994 }}
      >
        Facts resolve from src/facts.ts, so 3000 renders as 3,000.
      </p>
    </Scene>
  ),
};
