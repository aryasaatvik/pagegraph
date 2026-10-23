import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { filmFile } from "../src/cuts";
import { exportsDir, hyperframes, launchDir, run } from "./projects";

/** Renders the 60-second film. It has no audio track; see PROVENANCE.md. */
await mkdir(exportsDir, { recursive: true });
const output = join(exportsDir, filmFile);
await run([
  hyperframes,
  "render",
  launchDir,
  "--quality",
  "delivery",
  "--fps",
  "30",
  "--output",
  output,
  // Software rendering (SwiftShader) keeps frames reproducible across runs and GPUs.
  "--no-browser-gpu",
  "--quiet",
]);
console.log(`rendered ${output}`);
