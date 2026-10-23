import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openBrowser } from "../scripts/geometry";
import { stills } from "../src/cuts";

/**
 * The stills laid out by Chrome with the bundled fonts: the only place a long word, a wide column,
 * or a fallback font shows up as text past its column or the frame. Markup-level checks cannot see
 * it, and HyperFrames' layout check does not follow text inside a box that itself fits.
 */
let browser: Awaited<ReturnType<typeof openBrowser>>;
beforeAll(async () => {
  browser = await openBrowser();
});
afterAll(async () => {
  await browser.close();
});

/** Subpixel slack: glyph boxes and layout boxes round differently. */
const SLACK = 0.5;

describe("still geometry in Chrome", () => {
  test.each(stills)(
    "$file keeps every text line inside its block and the frame",
    async (still) => {
      const layout = await browser.layout(still.scene, still);
      expect(layout.lines.length).toBeGreaterThan(0);
      const outside = layout.lines.filter(
        (line) =>
          line.left < line.box.left - SLACK ||
          line.right > line.box.right + SLACK ||
          line.right > layout.frame + SLACK ||
          line.left < 0 ||
          line.bottom > still.height,
      );
      expect(outside).toEqual([]);
      expect(layout.clipped).toEqual([]);
    },
    30_000,
  );
});
