import { createSeo } from "../../../../src/react/index";

import { ogImage } from "./og-image";

const site = createSeo({
  ogImage,
  origin: "https://example.com",
  site: { name: "Example", logo: "/logo.png", publisherLogo: "/logo.png", defaultImage: "/og.png", defaultAuthor: { name: "Example" } },
  organization: { description: "Example, Inc.", sameAs: [], contactPoint: { contactType: "support", email: "hi@example.com" } },
  website: { searchPath: "/search?q={search_term_string}" },
});

export const { seoHead } = site;
export const seo = { head: site.head };
