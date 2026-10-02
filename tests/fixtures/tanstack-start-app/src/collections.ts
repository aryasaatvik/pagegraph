import { contentCollection } from "../../../../src/core/index";

import { posts } from "./content/posts";

export const collections = () => [
  contentCollection({
    route: "/blog/$slug",
    source: "blog",
    pages: posts,
    entry: (post) => ({ title: post.title, description: post.description, publishedAt: post.date, related: ["/pricing"] }),
  }),
];
