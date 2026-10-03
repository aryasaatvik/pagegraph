import { createFileRoute } from "@tanstack/react-router";
import { DocumentProvider, Fact, ForHumans, Section, T, Title, Visual } from "pagegraph/react";
import { Link } from "pagegraph/tanstack-start/react";

export const Route = createFileRoute("/")({
  staticData: {
    markdown: "rendered",
    llms: "Pages",
    seo: { kind: "page", head: { title: "Mail for teams", description: "Send product email." } },
  },
  head: () => ({
    meta: [{ title: "Mail for teams" }, { name: "description", content: "Send product email." }],
  }),
  component: () => (
    <DocumentProvider>
      <Section id="hero" kind="hero">
        <h1><Title>Email, in one call.</Title></h1>
        <p><T>Start with <Fact id="emails" /> emails.</T></p>
        <Link to="/plain"><T>Read more</T></Link>
        <T>Runtime: <Fact id="runtime" />.</T>
        <ForHumans><T>Scroll to compare.</T></ForHumans>
        <Visual describe="The email arrives in the inbox."><div>Image placeholder</div></Visual>
      </Section>
    </DocumentProvider>
  ),
});
