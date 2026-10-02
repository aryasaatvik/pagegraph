import { createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({ staticData: { seo: { kind: "page", crumb: "Home" } } });
