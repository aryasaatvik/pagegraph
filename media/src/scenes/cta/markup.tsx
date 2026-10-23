import type { SceneMarkup } from "../../scene";
import { Mark, Scene, Wordmark } from "../parts";
import { install, repositoryUrl } from "../source";

export const terms = "MIT · TanStack Start and TanStack Router · Pre-1.0";

/** Install line and repository; holds to the last frame. */
export const cta: SceneMarkup = {
  id: "cta",
  render: (size) => (
    <Scene size={size}>
      <div
        data-a="brand"
        className="pg-abs"
        style={{
          left: 0,
          right: 0,
          top: 250,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 36,
        }}
      >
        <Mark height={96} />
        <Wordmark size={150} />
      </div>
      <div
        className="pg-abs"
        style={{ left: 0, right: 0, top: 520, display: "flex", justifyContent: "center" }}
      >
        <span
          data-a="install"
          className="pg-mono"
          style={{
            fontSize: 54,
            fontWeight: 500,
            padding: "22px 44px",
            border: "2px solid var(--pg-lime)",
            borderRadius: 14,
            background: "var(--pg-panel)",
            whiteSpace: "nowrap",
          }}
        >
          <span className="pg-lime">$</span> {install}
        </span>
      </div>
      <p
        data-a="repo"
        className="pg-mono pg-abs"
        style={{ left: 0, right: 0, top: 712, margin: 0, textAlign: "center", fontSize: 32 }}
      >
        {repositoryUrl}
      </p>
      <p
        data-a="terms"
        className="pg-meta pg-abs"
        style={{ left: 0, right: 0, top: 800, margin: 0, textAlign: "center", fontSize: 22 }}
      >
        {terms}
      </p>
    </Scene>
  ),
};
