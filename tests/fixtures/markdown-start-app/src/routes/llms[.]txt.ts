import { createFileRoute } from "@tanstack/react-router";
import { llmsTxt } from "pagegraph/tanstack-start/server";

export const Route = createFileRoute("/llms.txt")({
  server: { handlers: { GET: llmsTxt() } },
});
