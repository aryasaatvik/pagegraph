/**
 * Copy the launch media the site shows from ../media/exports into public/media, so the repository
 * keeps one copy of each binary. Runs before `cf dev`, `cf build`, and `pagegraph check`, which
 * requires every OG image to exist under public/.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const site = join(import.meta.dirname, "..");
const exports = join(site, "..", "media", "exports");
const target = join(site, "public", "media");

const files = [
  "og.png",
  "pagegraph-launch.mp4",
  "pagegraph-launch-poster.jpg",
  "drift-gates.png",
  "route-declaration.png",
  "what-runs-where.png",
];

await mkdir(target, { recursive: true });
await Promise.all(files.map((file) => copyFile(join(exports, file), join(target, file))));
console.log(`synced ${files.length} media files into public/media`);
