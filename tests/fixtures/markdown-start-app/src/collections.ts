import { contentCollection } from "pagegraph";

export const collections = [
  contentCollection({
    route: "/guides/$slug",
    source: "guides",
    pages: ["email", "replies", "café", "hello world"].map((slug) => ({ url: `/guides/${slug}`, slug })),
    entry: ({ slug }) => ({ title: `Guide: ${slug}`, description: `Loaded ${slug}` }),
  }),
];
