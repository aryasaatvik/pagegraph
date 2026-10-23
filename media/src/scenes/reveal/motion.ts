import type { SceneMotion } from "../../scene";
import { all, exit, lift, one, pop, rise, stroke } from "../motion-kit";

/**
 * 0.2 the declared node. 0.5 its edges draw. 0.9 the derived nodes. 1.0 wordmark. 1.6 tagline.
 * 2.4 facts. Settled from 2.9 (the poster is at 3.6). 4.6 exit.
 */
export const reveal: SceneMotion = (tl, root) => {
  pop(tl, one(root, "mark-root"), 0.2, { duration: 0.5 });
  stroke(tl, one(root, "mark-edge"), 0.5, { duration: 0.5 });
  pop(tl, all(root, "mark-leaf"), 0.9, { duration: 0.4, stagger: 0.12 });
  lift(tl, one(root, "wordmark"), 1.0, { duration: 0.9 });
  lift(tl, all(root, "tagline"), 1.6, { duration: 0.8, stagger: 0.3 });
  rise(tl, all(root, "fact"), 2.4, { y: 16, duration: 0.5, stagger: 0.1 });
  exit(tl, root, 4.6);
};
