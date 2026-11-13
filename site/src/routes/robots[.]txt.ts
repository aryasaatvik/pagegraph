import { createFileRoute } from "@tanstack/react-router";
import { robotsTxt } from "pagegraph/tanstack-start/server";

export const Route = createFileRoute("/robots.txt")({ server: { handlers: { GET: robotsTxt } } });
