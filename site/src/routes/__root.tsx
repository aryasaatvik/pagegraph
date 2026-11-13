import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";

import { SiteFooter, SiteHeader } from "../components/site-chrome";
import { themeScript } from "../components/theme";
import styles from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#fafafa", media: "(prefers-color-scheme: light)" },
      { name: "theme-color", content: "#111111", media: "(prefers-color-scheme: dark)" },
    ],
    links: [
      { rel: "stylesheet", href: styles },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  component: RootDocument,
  notFoundComponent: NotFound,
});

function RootDocument() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">
          <Outlet />
        </main>
        <SiteFooter />
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  return (
    <section className="hero notfound">
      <div className="wrap">
        <h1>This page is not in the graph.</h1>
        <p className="lede">
          The address may have moved when a route was renamed. Every page this site publishes is in
          its <a href="/sitemap.xml">sitemap</a>.
        </p>
        <div className="cta">
          <Link className="btn primary" to="/docs">
            Read the docs
          </Link>
          <Link className="btn secondary" to="/">
            Go home
          </Link>
        </div>
      </div>
    </section>
  );
}
