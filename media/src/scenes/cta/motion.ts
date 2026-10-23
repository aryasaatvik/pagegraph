import type { SceneMotion } from "../../scene";
import { one, rise } from "../motion-kit";

/** 0.2 brand. 0.7 install line. 1.2 repository. 1.6 terms. Holds to the last frame. */
export const cta: SceneMotion = (tl, root) => {
  rise(tl, one(root, "brand"), 0.2, { y: 20, duration: 0.7 });
  rise(tl, one(root, "install"), 0.7, { y: 20, duration: 0.6 });
  rise(tl, one(root, "repo"), 1.2, { y: 12, duration: 0.5 });
  rise(tl, one(root, "terms"), 1.6, { y: 12, duration: 0.5 });
};
