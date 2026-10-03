import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/plain")({
  staticData: {
    seo: { kind: "page", head: { title: "Plain page", description: "An ordinary HTML page." } },
  },
  head: () => ({ meta: [{ title: "Plain page" }, { name: "description", content: "An ordinary HTML page." }] }),
  component: () => <h1>Plain page</h1>,
});
