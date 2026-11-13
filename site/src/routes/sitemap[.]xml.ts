import { createFileRoute } from "@tanstack/react-router";
import { sitemapXml } from "pagegraph/tanstack-start/server";

export const Route = createFileRoute("/sitemap.xml")({ server: { handlers: { GET: sitemapXml } } });
