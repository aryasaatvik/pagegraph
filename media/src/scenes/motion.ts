import type { SceneMotion } from "../scene";
import { check } from "./check/motion";
import { cta } from "./cta/motion";
import { declarationStill } from "./declaration-still/motion";
import { declare } from "./declare/motion";
import { gatesStill } from "./gates-still/motion";
import { graph } from "./graph/motion";
import { hook } from "./hook/motion";
import { markdown } from "./markdown/motion";
import { reveal } from "./reveal/motion";
import { runtimeStill } from "./runtime-still/motion";
import { social } from "./social/motion";

/** Runtime entry: every scene's motion, keyed by scene id. `markup.tsx` renders their markup. */
export const motions: Record<string, SceneMotion> = {
  hook,
  reveal,
  declare,
  graph,
  check,
  markdown,
  cta,
  "declaration-still": declarationStill,
  "gates-still": gatesStill,
  "runtime-still": runtimeStill,
  social,
};
