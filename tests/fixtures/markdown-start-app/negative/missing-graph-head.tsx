import { createFileRoute } from "@tanstack/react-router";
import { DocumentProvider, Section, T } from "pagegraph/react";

export const Route = createFileRoute("/missing-graph-head")({
  staticData: { markdown: "rendered" },
  head: () => ({ meta: [{ title: "Only runtime metadata" }, { name: "description", content: "Missing graph metadata." }] }),
  component: () => <DocumentProvider><Section id="body" kind="prose"><T>Page body</T></Section></DocumentProvider>,
});
