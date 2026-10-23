import type { SceneMotion } from "../../scene";
import { all, draw, exit, lift, one, rise } from "../motion-kit";

/**
 * 0.2 kicker. 0.5 the route. 1.1-2.3 its copies collect on the right. 3.0 the route is struck and
 * renamed. 3.6-4.4 each copy goes stale. 4.6 and 5.3 the headline. 6.5 exit.
 */
export const hook: SceneMotion = (tl, root) => {
  rise(tl, one(root, "kicker"), 0.2, { y: 12, duration: 0.5 });
  rise(tl, one(root, "route"), 0.5, { y: 24, duration: 0.7 });
  rise(tl, all(root, "copy"), 1.1, { x: 40, y: 0, duration: 0.5, stagger: 0.2 });
  draw(tl, one(root, "strike"), 3.0, { duration: 0.4 });
  tl.to(one(root, "route"), { color: "var(--pg-faint)", duration: 0.3 }, 3.1);
  rise(tl, one(root, "renamed"), 3.3, { x: -20, y: 0, duration: 0.5 });
  tl.to(
    all(root, "copy-dot"),
    { backgroundColor: "var(--pg-coral)", duration: 0.2, stagger: 0.14 },
    3.7,
  );
  tl.to(all(root, "copy"), { borderColor: "var(--pg-coral)", duration: 0.2, stagger: 0.14 }, 3.7);
  tl.to(all(root, "copy-value"), { color: "var(--pg-soft)", duration: 0.2, stagger: 0.14 }, 3.7);
  lift(tl, all(root, "headline"), 4.6, { duration: 0.8, stagger: 0.7 });
  exit(tl, root, 6.5);
};
