import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { renderToStaticMarkup } from "react-dom/server";
import { beats, film, stills } from "../src/cuts";
import type { Cut } from "../src/scene";
import { markups } from "../src/scenes/markup";
import { app, launchDir, stillDir } from "./projects";

/** Seconds a still's composition runs; its settled frame is captured after `STILL_SETTLE`. */
export const STILL_DURATION = 2;

const { values } = parseArgs({ options: { scene: { type: "string" } } });

const runtime = await Bun.build({
  entrypoints: [join(app, "src/runtime.ts")],
  format: "iife",
  target: "browser",
});
const [bundle] = runtime.outputs;
if (!runtime.success || bundle === undefined)
  throw new AggregateError(runtime.logs, "motion bundle failed");
const js = await bundle.text();
const stylesheet = await readFile(join(app, "src/styles.css"), "utf8");
if (/(?:^|[;{\s])(?:transition|animation)(?:-[a-z-]+)?\s*:/m.test(stylesheet))
  throw new Error("styles.css declares a CSS transition or animation; use the GSAP timeline");
const config = await readFile(join(launchDir, "hyperframes.json"), "utf8");

if (values.scene !== undefined) {
  const id = values.scene;
  if (markups[id] === undefined) throw new Error(`unknown scene ${id}`);
  const beat = beats.find((candidate) => candidate.scene === id);
  await project(
    {
      id: `scene-${id}`,
      width: 1920,
      height: 1080,
      shots: [{ scene: id, start: 0, duration: beat?.duration ?? STILL_DURATION }],
    },
    join(app, ".build/scenes", id),
  );
} else {
  await project(film, launchDir);
  await Promise.all(
    stills.map((still) =>
      project(
        {
          id: `still-${still.file.replace(/\.png$/, "")}`,
          width: still.width,
          height: still.height,
          shots: [{ scene: still.scene, start: 0, duration: STILL_DURATION }],
        },
        stillDir(still.file),
      ),
    ),
  );
}

async function project(cut: Cut, dir: string) {
  const assets = join(dir, "assets");
  await rm(join(dir, "compositions"), { recursive: true, force: true });
  await mkdir(join(assets, "fonts"), { recursive: true });
  await mkdir(join(dir, "compositions"), { recursive: true });
  await Promise.all([
    writeFile(join(assets, "pagegraph.css"), stylesheet),
    writeFile(join(assets, "scenes.js"), js),
    copyFile(join(app, "node_modules/gsap/dist/gsap.min.js"), join(assets, "gsap.min.js")),
    copyFile(
      join(
        app,
        "node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-standard-normal.woff2",
      ),
      join(assets, "fonts/bricolage-grotesque.woff2"),
    ),
    copyFile(
      join(
        app,
        "node_modules/@fontsource-variable/spline-sans-mono/files/spline-sans-mono-latin-wght-normal.woff2",
      ),
      join(assets, "fonts/spline-sans-mono.woff2"),
    ),
    ...(dir === launchDir ? [] : [writeFile(join(dir, "hyperframes.json"), config)]),
  ]);
  const duration = Math.max(...cut.shots.map((shot) => shot.start + shot.duration));
  const hosts = await Promise.all(
    cut.shots.map(async (shot, index) => {
      const markup = markups[shot.scene];
      if (markup === undefined) throw new Error(`unknown scene ${shot.scene}`);
      const id = `${cut.id}-${index}-${shot.scene}`;
      const html = renderToStaticMarkup(markup.render({ width: cut.width, height: cut.height }));
      await writeFile(
        join(dir, "compositions", `${id}.html`),
        `<!doctype html><html><head><meta charset="UTF-8"></head><body><template>
      <div data-composition-id="${id}" data-width="${cut.width}" data-height="${cut.height}" style="position:absolute;inset:0;background:var(--pg-night)">${html}</div>
      <script>window.__timelines=window.__timelines||{};window.__timelines[${JSON.stringify(id)}]=pagegraphMedia.scene(${JSON.stringify(shot.scene)},${JSON.stringify(id)});</script>
      </template></body></html>`,
      );
      return `<div id="${id}-host" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${shot.start}" data-duration="${shot.duration}" data-track-index="0" data-width="${cut.width}" data-height="${cut.height}"></div>`;
    }),
  );
  await writeFile(
    join(dir, "index.html"),
    `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=${cut.width},height=${cut.height}">
    <link rel="stylesheet" href="assets/pagegraph.css"><style>html,body{margin:0;width:${cut.width}px;height:${cut.height}px;overflow:hidden;background:var(--pg-night)}#root{position:relative;width:${cut.width}px;height:${cut.height}px;background:var(--pg-night)}</style>
    <script src="assets/gsap.min.js"></script><script src="assets/scenes.js"></script></head><body>
    <div id="root" data-composition-id="${cut.id}" data-start="0" data-duration="${duration}" data-width="${cut.width}" data-height="${cut.height}">${hosts.join("\n")}</div>
    <script>window.__timelines=window.__timelines||{};window.__timelines[${JSON.stringify(cut.id)}]=gsap.timeline({paused:true});</script></body></html>`,
  );
  console.log(`built ${cut.id} (${duration}s, ${cut.width}x${cut.height}) at ${dir}`);
}
