import { createSeo } from "pagegraph/react";

export const SITE_ORIGIN = "https://pagegraph.arya.sh";

export const seo = createSeo({
  origin: SITE_ORIGIN,
  site: {
    name: "PageGraph",
    logo: "/icon.svg",
    publisherLogo: "/icon-512.png",
    defaultImage: "/og.png",
    defaultAuthor: { name: "Saatvik Arya", url: "https://arya.sh" },
  },
  organization: {
    legalName: "PageGraph",
    description: "Route-declared SEO for TanStack Start and TanStack Router.",
    sameAs: ["https://github.com/aryasaatvik/pagegraph", "https://www.npmjs.com/package/pagegraph"],
    // TODO(site): the public contact address is pending the maintainer's choice; deploy waits on it.
    contactPoint: { contactType: "support", email: "TODO@pagegraph.arya.sh" },
  },
  // /docs filters its page list by ?q=, so the sitelinks search target is real.
  website: { searchPath: "/docs?q={search_term_string}" },
});

export const { seoHead } = seo;
