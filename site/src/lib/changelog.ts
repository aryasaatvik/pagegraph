import { createServerFn } from "@tanstack/react-start";

/** The package's CHANGELOG.md as HTML, rendered once at prerender. */
export const getChangelog = createServerFn({ method: "GET" }).handler(async () => {
  const [{ marked }, { default: source }] = await Promise.all([
    import("marked"),
    import("../../../CHANGELOG.md?raw"),
  ]);
  // The changelog is this repository's own file; headings are package@version.
  const body = source.replace(/^# .*\n/, "");
  return { html: await marked.parse(body, { gfm: true }) };
});
