import type { SceneMarkup } from "../../scene";
import { Chip, Line, Mark, Scene, Wordmark } from "../parts";

export const tagline = ["Declare SEO on the route.", "Derive the rest from one graph."] as const;
export const facts = [
  "TanStack Start · TanStack Router",
  "Vite plugin and CLI",
  "Open source · MIT",
];

/** The mark assembles and the wordmark lands: the film's poster frame. */
export const reveal: SceneMarkup = {
  id: "reveal",
  render: (size) => (
    <Scene size={size}>
      <div
        className="pg-abs"
        style={{
          left: 0,
          right: 0,
          top: 268,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 48,
        }}
      >
        <Mark height={132} a="mark" />
        <span className="pg-mask" data-layout-allow-overflow="">
          <span data-a="wordmark" style={{ display: "block" }}>
            <Wordmark size={200} />
          </span>
        </span>
      </div>
      <h2
        className="pg-h pg-abs"
        style={{
          left: 0,
          right: 0,
          top: 556,
          textAlign: "center",
          fontSize: 68,
          fontWeight: 640,
          lineHeight: 1.12,
          whiteSpace: "nowrap",
        }}
      >
        <Line a="tagline">{tagline[0]}</Line>
        <Line a="tagline">
          <span className="pg-soft">{tagline[1]}</span>
        </Line>
      </h2>
      <div
        className="pg-abs"
        style={{ left: 0, right: 0, top: 880, display: "flex", justifyContent: "center", gap: 20 }}
      >
        {facts.map((fact, index) => (
          <Chip key={fact} a="fact" lime={index === 0}>
            {fact}
          </Chip>
        ))}
      </div>
    </Scene>
  ),
};
