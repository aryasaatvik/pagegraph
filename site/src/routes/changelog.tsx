import { createFileRoute } from "@tanstack/react-router";

import { getChangelog } from "../lib/changelog";
import { seo } from "../lib/seo";

export const Route = createFileRoute("/changelog")({
  staticData: {
    seo: {
      kind: "page",
      crumb: "Changelog",
      sitemap: { priority: 0.5, changeFrequency: "weekly" },
      head: {
        title: "Changelog | PageGraph",
        description: "Every PageGraph release: what changed for users, version by version.",
      },
    },
  },
  loader: () => getChangelog(),
  head: seo.head,
  component: Changelog,
});

function Changelog() {
  const { html } = Route.useLoaderData();
  return (
    <div className="wrap changelog">
      <h1>Changelog</h1>
      <p className="docs-lede">
        Every release of the <code>pagegraph</code> package, newest first.
      </p>
      <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
