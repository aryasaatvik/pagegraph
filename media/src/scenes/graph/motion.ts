import type { SceneMotion } from "../../scene";
import { all, draw, exit, lift, one, pop, rise, show, stroke } from "../motion-kit";

/**
 * 0.3 title. 0.8 sub. 1.2-2.4 page nodes. 2.6 the collection. 3.2 edges draw, 4.4 arrowheads and labels.
 * 5.2 divider. 5.5-7.5 derived outputs. 9.0 note. 11.4 exit.
 */
export const graph: SceneMotion = (tl, root) => {
  lift(tl, one(root, "title"), 0.3);
  rise(tl, one(root, "sub"), 0.8, { y: 14, duration: 0.5 });
  pop(tl, all(root, "node"), 1.2, { stagger: 0.2 });
  show(tl, one(root, "collection"), 2.6, 0.5);
  stroke(tl, all(root, "edge"), 3.2, { duration: 0.8, stagger: 0.25 });
  show(tl, all(root, "edge-head"), 4.4, 0.2);
  show(tl, all(root, "edge-label"), 4.6, 0.4);
  draw(tl, one(root, "divider"), 5.2, { axis: "y", duration: 0.6 });
  rise(tl, all(root, "output"), 5.5, { x: 30, y: 0, duration: 0.5, stagger: 0.45 });
  rise(tl, one(root, "note"), 9.0, { y: 10, duration: 0.5 });
  exit(tl, root, 11.4);
};
