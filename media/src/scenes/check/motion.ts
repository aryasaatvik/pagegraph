import type { SceneMotion } from "../../scene";
import { all, exit, lift, one, pop, rise } from "../motion-kit";

/**
 * 0.3 title. 1.0 the rename, 1.5 old path, 1.9 new path. 2.6 the unchanged collection. 3.6 the
 * terminal, 4.0-6.6 its report. 7.0 exit 1. 7.4 verdict. 8.4-9.2 the rules. 11.4 exit.
 */
export const check: SceneMotion = (tl, root) => {
  lift(tl, one(root, "title"), 0.3);
  rise(tl, one(root, "edit"), 1.0, { y: 16, duration: 0.5 });
  rise(tl, one(root, "edit-from"), 1.5, { x: -16, y: 0, duration: 0.4 });
  rise(tl, one(root, "edit-to"), 1.9, { x: -16, y: 0, duration: 0.4 });
  rise(tl, one(root, "stale"), 2.6, { y: 16, duration: 0.5 });
  rise(tl, one(root, "term"), 3.6, { y: 20, duration: 0.5 });
  rise(tl, all(root, "term-line"), 4.0, { y: 6, duration: 0.2, stagger: 0.17 });
  pop(tl, one(root, "exit"), 7.0);
  rise(tl, one(root, "verdict"), 7.4, { y: 14, duration: 0.6 });
  tl.fromTo(one(root, "rule"), { scaleX: 0 }, { scaleX: 1, duration: 0.5 }, 8.2);
  rise(tl, all(root, "aside"), 8.4, { y: 10, duration: 0.5, stagger: 0.6 });
  exit(tl, root, 11.4);
};
