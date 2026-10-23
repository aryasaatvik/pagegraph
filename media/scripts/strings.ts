import { renderToStaticMarkup } from "react-dom/server";
import { markups } from "../src/scenes/markup";

/** Every visible string, for the claim audit. `scripts/copy.ts` prints it; `tests/copy.test.ts` audits it. */
export function visibleStrings(): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [id, scene] of Object.entries(markups)) {
    const html = renderToStaticMarkup(scene.render({ width: 1920, height: 1080 }));
    const text = html
      .replace(/<[^>]+>/g, "\n")
      .replaceAll("&amp;", "&")
      .replaceAll("&#x27;", "'")
      .replaceAll("&quot;", '"')
      .replaceAll("&gt;", ">")
      .replaceAll("&lt;", "<");
    result.set(
      id,
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    );
  }
  return result;
}
