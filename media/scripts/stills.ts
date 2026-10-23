/* eslint-disable no-await-in-loop -- Each render runs parallel Chrome workers; serialize exports to bound memory. */
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { filmFile, poster, stills } from "../src/cuts";
import { exportsDir, hyperframes, run, stillDir } from "./projects";

/**
 * Each still renders through the same compositor as the film, as a lossless PNG sequence at one
 * frame per second; the frame at one second is the settled layout. The poster comes from the film.
 */
await mkdir(exportsDir, { recursive: true });
for (const still of stills) {
  const frames = join(stillDir(still.file), "frames");
  await rm(frames, { recursive: true, force: true });
  await run([
    hyperframes,
    "render",
    stillDir(still.file),
    "--format",
    "png-sequence",
    "--fps",
    "1",
    "--output",
    frames,
    "--quiet",
  ]);
  const settled = (await readdir(frames)).filter((name) => name.endsWith(".png")).sort()[1];
  if (settled === undefined) throw new Error(`no settled frame for ${still.file}`);
  await run([
    "ffmpeg",
    "-y",
    "-v",
    "error",
    "-i",
    join(frames, settled),
    "-frames:v",
    "1",
    "-pix_fmt",
    "rgb24",
    join(exportsDir, still.file),
  ]);
}
await run([
  "ffmpeg",
  "-y",
  "-v",
  "error",
  "-ss",
  String(poster.at),
  "-i",
  join(exportsDir, filmFile),
  "-frames:v",
  "1",
  "-q:v",
  "2",
  join(exportsDir, poster.file),
]);
console.log(`infographics, cards, and poster: ${exportsDir}`);
