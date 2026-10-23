import type { SceneMotion } from "../../scene";
import { all, exit, lift, one, rise, show } from "../motion-kit";

/**
 * 0.2 title. 0.5 sub. 0.8 the authored section. 1.7 arrow. 1.9 the twin, 2.2-3.2 its lines, 3.5
 * the human-only line struck. 4.1 llms.txt. 4.7 the facts light and the note lands. 6.5 exit.
 */
export const markdown: SceneMotion = (tl, root) => {
  lift(tl, one(root, "title"), 0.2);
  rise(tl, one(root, "sub"), 0.5, { y: 14, duration: 0.5 });
  rise(tl, one(root, "code"), 0.8, { y: 20, duration: 0.6 });
  show(tl, one(root, "arrow"), 1.7, 0.3);
  rise(tl, one(root, "twin"), 1.9, { x: 30, y: 0, duration: 0.5 });
  rise(tl, all(root, "twin-line"), 2.2, { y: 8, duration: 0.3, stagger: 0.25 });
  rise(tl, one(root, "twin-human"), 3.5, { y: 8, duration: 0.3 });
  rise(tl, one(root, "llms"), 4.1, { y: 16, duration: 0.5 });
  show(tl, all(root, "hi-fact"), 4.7, 0.4);
  rise(tl, one(root, "note"), 4.8, { y: 10, duration: 0.4 });
  exit(tl, root, 6.5);
};
