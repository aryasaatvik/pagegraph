import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { OgImagePolicy, Violation } from "../core/checks";
import type { SeoGraph } from "../core/graph";
import { isSitemapEligible } from "../core/projections";

const contained = (root: string, file: string): boolean => {
  const path = relative(root, file);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};

/** Verify static same-origin image assets without fetching external images. */
export async function checkLocalOgImages(
  graph: SeoGraph,
  origin: string,
  projectRoot: string,
  policy?: OgImagePolicy,
): Promise<Array<Violation>> {
  const severity = policy?.severity ?? "structural";
  if (severity === "off") return [];
  const siteOrigin = new URL(origin).origin;
  const publicRoot = resolve(projectRoot, policy?.publicDirectory ?? "public");
  const findings: Array<Violation> = [];
  for (const node of graph.nodes.values()) {
    const image = node.head?.image;
    if (!isSitemapEligible(node) || !image?.url.trim()) continue;
    let url: URL;
    try {
      url = new URL(image.url, origin);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Invalid image protocol");
    } catch {
      findings.push({ severity, rule: "invalid-og-image", path: node.path,
        message: `Sitemap page "${node.path}" has an invalid OG image URL "${image.url}".`,
        fix: "Declare an HTTP(S) image URL or a local asset path." });
      continue;
    }
    if (url.origin !== siteOrigin) continue;
    let valid = false;
    try {
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.includes("\0") || pathname.includes("\\")) throw new Error("Invalid asset path");
      const file = resolve(publicRoot, `.${pathname}`);
      if (contained(publicRoot, file)) {
        const [realRoot, realFile] = await Promise.all([realpath(publicRoot), realpath(file)]);
        valid = contained(realRoot, realFile) && (await stat(realFile)).isFile();
      }
    } catch {
      // Missing, malformed, or escaped assets all fail the same local-file contract.
    }
    if (!valid) findings.push({
      severity, rule: "missing-og-image-file", path: node.path,
      message: `Sitemap page "${node.path}" references OG image "${image.url}" without a file inside "${publicRoot}".`,
      fix: "Generate or add the image in the public asset directory, update its URL, or configure ogImage.publicDirectory.",
    });
  }
  return findings;
}
