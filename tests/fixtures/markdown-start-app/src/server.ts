import handler from "@tanstack/react-start/server-entry";
import { markdownRequest } from "pagegraph/tanstack-start/markdown";

declare module "@tanstack/react-start" {
  interface Register {
    server: { requestContext: { fixtureHost: string } };
  }
}

export default {
  async fetch(request: Request) {
    const options = { context: { fixtureHost: "forwarded" } };
    return (await markdownRequest(request, options)) ?? handler.fetch(request, options);
  },
};
