import { createFileRoute } from "@tanstack/react-router";
import { DocumentProvider, Section } from "pagegraph/react";

export const Route = createFileRoute("/broken")({
  staticData: { markdown: "rendered", seo: { kind: "page" } },
  head: () => ({ meta: [{ title: "Broken page" }, { name: "description", content: "Fails during capture." }] }),
  component: () => <DocumentProvider><Section id="broken" kind="hero"><Broken /></Section></DocumentProvider>,
});

function Broken(): never {
  throw new Error("Intentional fixture render failure");
}
