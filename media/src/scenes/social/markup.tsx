import type { SceneMarkup } from "../../scene";
import { Mark, Scene, Wordmark } from "../parts";
import { tagline } from "../reveal/markup";
import { install, repositoryUrl } from "../source";

/** OG and GitHub share card, laid out at whichever card size it renders. */
export const social: SceneMarkup = {
  id: "social",
  render: (size) => {
    const x = Math.round(size.width * 0.07);
    return (
      <Scene size={size}>
        <div
          data-a="card"
          className="pg-abs"
          style={{
            left: x,
            top: Math.round(size.height * 0.13),
            display: "flex",
            alignItems: "center",
            gap: 26,
          }}
        >
          <Mark height={68} />
          <Wordmark size={108} />
        </div>
        <h1
          className="pg-h pg-abs"
          style={{
            left: x,
            top: Math.round(size.height * 0.4),
            fontSize: 52,
            fontWeight: 640,
            lineHeight: 1.14,
            whiteSpace: "nowrap",
          }}
        >
          {tagline[0]}
          <br />
          <span className="pg-soft">{tagline[1]}</span>
        </h1>
        <div
          className="pg-abs"
          style={{
            left: x,
            right: x,
            bottom: Math.round(size.height * 0.1),
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            className="pg-mono"
            style={{
              fontSize: 28,
              padding: "12px 24px",
              border: "2px solid var(--pg-lime)",
              borderRadius: 10,
              background: "var(--pg-panel)",
              whiteSpace: "nowrap",
            }}
          >
            <span className="pg-lime">$</span> {install}
          </span>
          <span className="pg-meta" style={{ textAlign: "right", lineHeight: 1.6 }}>
            TanStack Start · TanStack Router
            <br />
            {repositoryUrl}
          </span>
        </div>
      </Scene>
    );
  },
};
