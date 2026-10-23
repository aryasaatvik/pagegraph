import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { filmFile } from "../src/cuts";
import { app, exportsDir, run } from "./projects";

/** Review points in the rendered film: every beat's settled state and each cut between beats. */
export const checkpoints = [
  [1.6, "hook-route"],
  [2.6, "hook-copies"],
  [4.2, "hook-stale"],
  [6.2, "hook-headline"],
  [6.85, "cut-hook-reveal"],
  [7.6, "reveal-assemble"],
  [10.6, "reveal-settled"],
  [11.85, "cut-reveal-declare"],
  [14.0, "declare-code"],
  [16.0, "declare-head"],
  [18.0, "declare-sitemap"],
  [20.5, "declare-graph"],
  [23.0, "declare-settled"],
  [23.85, "cut-declare-graph"],
  [26.0, "graph-nodes"],
  [28.8, "graph-edges"],
  [31.5, "graph-outputs"],
  [34.5, "graph-settled"],
  [35.85, "cut-graph-check"],
  [38.4, "check-edit"],
  [41.0, "check-report"],
  [43.5, "check-exit"],
  [46.5, "check-settled"],
  [47.85, "cut-check-markdown"],
  [50.5, "markdown-twin"],
  [53.8, "markdown-settled"],
  [54.85, "cut-markdown-cta"],
  [55.5, "cta-in"],
  [57.5, "cta-settled"],
  [59.9, "cta-last"],
] as const;

const dir = join(app, ".build/review");
await mkdir(dir, { recursive: true });
const files = await Promise.all(
  checkpoints.map(async ([time, id]) => {
    const file = join(dir, `${time.toFixed(2).padStart(5, "0")}-${id}.png`);
    await run([
      "ffmpeg",
      "-y",
      "-v",
      "error",
      "-ss",
      String(time),
      "-i",
      join(exportsDir, filmFile),
      "-frames:v",
      "1",
      file,
    ]);
    return file;
  }),
);
const columns = 5;
const cells = checkpoints.map(
  (_, index) => `[${index}:v]scale=480:270,pad=480:300:0:0:color=0x0b0f13[v${index}]`,
);
const layout = checkpoints
  .map((_, index) => `${(index % columns) * 480}_${Math.floor(index / columns) * 300}`)
  .join("|");
const graph = `${cells.join(";")};${checkpoints.map((_, index) => `[v${index}]`).join("")}xstack=inputs=${files.length}:layout=${layout}:fill=0x0b0f13[out]`;
await run([
  "ffmpeg",
  "-y",
  "-v",
  "error",
  ...files.flatMap((file) => ["-i", file]),
  "-filter_complex",
  graph,
  "-map",
  "[out]",
  "-frames:v",
  "1",
  join(dir, "contact-sheet.png"),
]);
console.log(`MP4 frames and contact sheet: ${dir}`);
