import type { OgImageResolver } from "pagegraph";

/** Every page shares the launch card rendered in media/; the build copies it to public/media. */
export const ogImage: OgImageResolver = (node) => ({
  url: "/media/og.png",
  width: 1200,
  height: 630,
  alt: node.head?.title ?? "PageGraph: declare SEO on the route, derive the rest from one graph",
});
