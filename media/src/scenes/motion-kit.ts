import { gsap } from "gsap";

/**
 * Motion helpers shared by every scene. Motion lives only on the scene's paused GSAP timeline: no
 * timers, clocks, randomness, or CSS transitions. Eases are GSAP's own so a seek is exact.
 */
export { gsap };

export const ease = {
  out: "power3.out",
  soft: "expo.out",
  inOut: "power2.inOut",
  snap: "back.out(1.6)",
  linear: "none",
} as const;

type Timeline = gsap.core.Timeline;

/** Every element in a scene marked `data-a="<name>"`, in document order. */
export function all(root: HTMLElement, name: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[data-a="${name}"]`));
}

/** The one element marked `data-a="<name>"`. */
export function one(root: HTMLElement, name: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`[data-a="${name}"]`);
  if (element === null)
    throw new Error(`scene ${root.dataset.compositionId} has no [data-a="${name}"]`);
  return element;
}

/** The element at `index` among `data-a="<name>"` matches. */
export function nth(root: HTMLElement, name: string, index: number): HTMLElement {
  const element = all(root, name)[index];
  if (element === undefined)
    throw new Error(`scene ${root.dataset.compositionId} has no [data-a="${name}"] #${index}`);
  return element;
}

/** Fade and lift into place. */
export function rise(
  tl: Timeline,
  targets: gsap.TweenTarget,
  at: number,
  vars: { y?: number; x?: number; duration?: number; stagger?: number; ease?: string } = {},
): void {
  tl.fromTo(
    targets,
    { autoAlpha: 0, y: vars.y ?? 28, x: vars.x ?? 0 },
    {
      autoAlpha: 1,
      y: 0,
      x: 0,
      duration: vars.duration ?? 0.6,
      ease: vars.ease ?? ease.out,
      stagger: vars.stagger ?? 0,
    },
    at,
  );
}

/** Rise a line of display type out of its mask. */
export function lift(
  tl: Timeline,
  targets: gsap.TweenTarget,
  at: number,
  vars: { duration?: number; stagger?: number } = {},
): void {
  tl.fromTo(
    targets,
    { autoAlpha: 0, yPercent: 112 },
    {
      autoAlpha: 1,
      yPercent: 0,
      duration: vars.duration ?? 0.8,
      ease: ease.soft,
      stagger: vars.stagger ?? 0,
    },
    at,
  );
}

/** Send a line of display type up out of its mask, hidden once it has gone. */
export function drop(
  tl: Timeline,
  targets: gsap.TweenTarget,
  at: number,
  vars: { duration?: number; stagger?: number } = {},
): void {
  tl.to(
    targets,
    {
      autoAlpha: 0,
      yPercent: -112,
      duration: vars.duration ?? 0.5,
      ease: ease.inOut,
      stagger: vars.stagger ?? 0,
    },
    at,
  );
}

/** Draw a rule, bar, or fill from its origin edge. */
export function draw(
  tl: Timeline,
  targets: gsap.TweenTarget,
  at: number,
  vars: { axis?: "x" | "y"; duration?: number; stagger?: number; ease?: string } = {},
): void {
  const axis = vars.axis ?? "x";
  tl.fromTo(
    targets,
    axis === "x" ? { scaleX: 0 } : { scaleY: 0 },
    {
      ...(axis === "x" ? { scaleX: 1 } : { scaleY: 1 }),
      duration: vars.duration ?? 0.7,
      ease: vars.ease ?? ease.inOut,
      stagger: vars.stagger ?? 0,
    },
    at,
  );
}

/** Fade in without movement. */
export function show(tl: Timeline, targets: gsap.TweenTarget, at: number, duration = 0.3): void {
  tl.fromTo(targets, { autoAlpha: 0 }, { autoAlpha: 1, duration, ease: ease.out }, at);
}

/** Fade out without movement. */
export function hide(tl: Timeline, targets: gsap.TweenTarget, at: number, duration = 0.3): void {
  tl.to(targets, { autoAlpha: 0, duration, ease: ease.out }, at);
}

/** Every scene leaves the same way: content lifts slightly and fades before the cut. */
export function exit(tl: Timeline, root: HTMLElement, at: number): void {
  // HyperFrames nests the composition inside its host element, so find the scene by class.
  const scene = root.querySelector<HTMLElement>(".pg-scene");
  if (scene === null) throw new Error(`scene ${root.dataset.compositionId} has no .pg-scene`);
  const content = Array.from(scene.children).filter(
    (element) => !element.classList.contains("pg-grid"),
  );
  tl.to(content, { autoAlpha: 0, y: -18, duration: 0.4, ease: ease.inOut }, at);
}

/** Settle a still: everything the scene shows is in place by one second. */
export const STILL_SETTLE = 1;

/** Draw SVG strokes declared with `pathLength={1}` from their start. */
export function stroke(
  tl: Timeline,
  targets: gsap.TweenTarget,
  at: number,
  vars: { duration?: number; stagger?: number; ease?: string } = {},
): void {
  tl.fromTo(
    targets,
    { strokeDasharray: 1, strokeDashoffset: 1 },
    {
      strokeDashoffset: 0,
      duration: vars.duration ?? 0.7,
      ease: vars.ease ?? ease.inOut,
      stagger: vars.stagger ?? 0,
    },
    at,
  );
}

/** Pop a node or chip into place from a slight scale. */
export function pop(
  tl: Timeline,
  targets: gsap.TweenTarget,
  at: number,
  vars: { duration?: number; stagger?: number } = {},
): void {
  tl.fromTo(
    targets,
    { autoAlpha: 0, scale: 0.86, transformOrigin: "50% 50%" },
    {
      autoAlpha: 1,
      scale: 1,
      duration: vars.duration ?? 0.45,
      ease: ease.snap,
      stagger: vars.stagger ?? 0,
    },
    at,
  );
}
