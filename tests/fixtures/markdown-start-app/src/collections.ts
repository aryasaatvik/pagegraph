import { contentCollection } from "pagegraph";

export const collections = [
  contentCollection({
    route: "/guides/$slug",
    source: "guides",
    pages: [{ url: "/guides/email", slug: "email" }, { url: "/guides/replies", slug: "replies" }],
    entry: ({ slug }) => ({ title: `Guide: ${slug}`, description: `Loaded ${slug}` }),
  }),
];
