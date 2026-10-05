import type { OgImageResolver } from "../../../../src/core/index";

// Render these files in the consumer's build; pagegraph only resolves their metadata.
export const ogImage: OgImageResolver = (node) => ({
  url: "/og/default.png",
  width: 1200,
  height: 630,
  alt: node.head?.title ?? node.path,
});
