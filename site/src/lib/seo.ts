import { createSeo } from "pagegraph/react";

import { ogImage } from "./og-image";

export const SITE_ORIGIN = "https://pagegraph.arya.sh";

export const seo = createSeo({
  origin: SITE_ORIGIN,
  ogImage,
  site: {
    name: "PageGraph",
    logo: "/icon-512.png",
    publisherLogo: "/icon-512.png",
    defaultImage: "/media/og.png",
    defaultAuthor: { name: "Saatvik Arya", url: "https://arya.sh" },
  },
  organization: {
    legalName: "PageGraph",
    description: "Route-declared SEO for TanStack Start and TanStack Router.",
    sameAs: ["https://github.com/aryasaatvik/pagegraph", "https://www.npmjs.com/package/pagegraph"],
  },
  // /docs filters its page list by ?q=, so the sitelinks search target is real.
  website: { searchPath: "/docs?q={search_term_string}" },
});

export const { seoHead } = seo;
