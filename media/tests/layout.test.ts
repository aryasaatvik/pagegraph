import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { app } from "../scripts/projects";
import { film, stills } from "../src/cuts";
import type { Size } from "../src/scene";
import { markups } from "../src/scenes/markup";
import { CODE_CHROME, CODE_PAD, MONO_ADVANCE } from "../src/scenes/parts";

/** Every scene at every size it renders: film beats at 1920×1080, stills at their own size. */
const renders: ReadonlyArray<{ scene: string; size: Size }> = [
  ...film.shots.map((shot) => ({ scene: shot.scene, size: film })),
  ...stills.map((still) => ({ scene: still.scene, size: still })),
];

interface Panel {
  readonly className: string;
  readonly cols: number;
  readonly rows: number;
  readonly font: number;
  readonly line: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Code and terminal panels, with the content metrics and box they declare. */
function panels(html: string): Panel[] {
  return [...html.matchAll(/<div class="(pg-code|pg-term)"([^>]*)>/g)].map(
    ([, className, attrs]) => {
      const number = (pattern: RegExp) => Number(pattern.exec(attrs ?? "")?.[1]);
      return {
        className: className ?? "",
        cols: number(/data-cols="(\d+)"/),
        rows: number(/data-rows="(\d+)"/),
        font: number(/data-font="(\d+)"/),
        line: number(/data-line="(\d+)"/),
        left: number(/left:(\d+)px/),
        top: number(/top:(\d+)px/),
        width: number(/width:(\d+)px/),
        height: number(/height:(\d+)px/),
      };
    },
  );
}

describe("layout at native sizes", () => {
  test.each(renders)(
    "$scene code and terminal panels fit their text and the canvas",
    ({ scene, size }) => {
      const markup = markups[scene];
      if (markup === undefined) throw new Error(`no markup for ${scene}`);
      for (const panel of panels(renderToStaticMarkup(markup.render(size)))) {
        // The panel border is 1.5px a side; the header or bar adds a 1.5px rule beneath it.
        const border = 3;
        // The terminal bar is 46px; the code file header is 54px. Both bodies pad 22px top and bottom.
        const chrome = (panel.className === "pg-term" ? 46 + 44 : CODE_CHROME) + 1.5;
        expect(panel.cols * panel.font * MONO_ADVANCE + 2 * CODE_PAD + border).toBeLessThanOrEqual(
          panel.width,
        );
        expect(panel.rows * panel.line + chrome + border).toBeLessThanOrEqual(panel.height);
        expect(panel.left).toBeGreaterThanOrEqual(100);
        expect(panel.left + panel.width).toBeLessThanOrEqual(size.width - 100);
        expect(panel.top + panel.height).toBeLessThanOrEqual(size.height - 60);
      }
    },
  );

  test("every name a motion animates exists in its scene's markup", () => {
    const scenes = join(app, "src/scenes");
    for (const dir of readdirSync(scenes, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    )) {
      const motion = readFileSync(join(scenes, dir.name, "motion.ts"), "utf8");
      const markup = markups[dir.name];
      if (markup === undefined) throw new Error(`no markup for ${dir.name}`);
      const html = renderToStaticMarkup(markup.render(film));
      for (const [, name] of motion.matchAll(/\b(?:one|all|nth)\(root, "([^"]+)"/g))
        expect({ scene: dir.name, name, present: html.includes(`data-a="${name}"`) }).toEqual({
          scene: dir.name,
          name,
          present: true,
        });
    }
  });
});
