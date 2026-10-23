import type { SceneMarkup } from "../scene";
import { check } from "./check/markup";
import { cta } from "./cta/markup";
import { declarationStill } from "./declaration-still/markup";
import { declare } from "./declare/markup";
import { gatesStill } from "./gates-still/markup";
import { graph } from "./graph/markup";
import { hook } from "./hook/markup";
import { markdown } from "./markdown/markup";
import { reveal } from "./reveal/markup";
import { runtimeStill } from "./runtime-still/markup";
import { social } from "./social/markup";

/** Build-time entry: every scene's markup, keyed by scene id. `motion.ts` holds their motion. */
export const markups: Record<string, SceneMarkup> = {
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
