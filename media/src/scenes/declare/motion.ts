import type { SceneMotion } from "../../scene";
import { all, draw, exit, hide, lift, one, rise } from "../motion-kit";

/**
 * 0.3 title. 0.8 sub. 1.2 the declaration. 2.4 head lines light and the <head> card arrives. 5.0
 * sitemap. 7.0 crumb and link, then the graph card. 9.2 note. 11.4 exit.
 */
export const declare: SceneMotion = (tl, root) => {
  lift(tl, one(root, "title"), 0.3);
  rise(tl, one(root, "sub"), 0.8, { y: 14, duration: 0.5 });
  rise(tl, one(root, "code"), 1.2, { y: 24, duration: 0.7 });
  rise(tl, all(root, "code-line"), 1.3, { y: 8, duration: 0.3, stagger: 0.035 });

  draw(tl, [one(root, "hi-head"), one(root, "hi-render")], 2.4, { duration: 0.5 });
  rise(tl, one(root, "out-head"), 2.8, { x: 30, y: 0, duration: 0.6 });
  hide(tl, [one(root, "hi-head"), one(root, "hi-render")], 4.8);

  draw(tl, one(root, "hi-sitemap"), 5.0, { duration: 0.4 });
  rise(tl, one(root, "out-sitemap"), 5.3, { x: 30, y: 0, duration: 0.6 });
  hide(tl, one(root, "hi-sitemap"), 6.8);

  draw(tl, [one(root, "hi-crumb"), one(root, "hi-link")], 7.0, { duration: 0.4 });
  rise(tl, one(root, "out-graph"), 7.3, { x: 30, y: 0, duration: 0.6 });

  rise(tl, one(root, "note"), 9.2, { y: 10, duration: 0.5 });
  exit(tl, root, 11.4);
};
