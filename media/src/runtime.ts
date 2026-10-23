import { gsap } from "gsap";
import { motions } from "./scenes/motion";

// 2D transforms only: 3D layers rasterize slightly differently between otherwise identical renders.
gsap.config({ force3D: false });

/** Builds one scene's paused timeline; HyperFrames seeks it frame by frame. */
function scene(sceneId: string, compositionId: string): gsap.core.Timeline {
  const root = document.querySelector<HTMLElement>(`[data-composition-id="${compositionId}"]`);
  const motion = motions[sceneId];
  if (root === null || motion === undefined)
    throw new Error(`cannot mount ${sceneId} as ${compositionId}`);
  const timeline = gsap.timeline({ paused: true });
  motion(timeline, root);
  return timeline;
}
Object.assign(window, { pagegraphMedia: { scene } });
