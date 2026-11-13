import handler from "@tanstack/react-start/server-entry";
import { markdownRequest } from "pagegraph/tanstack-start/markdown";

export default {
  async fetch(request: Request) {
    return (await markdownRequest(request)) ?? handler.fetch(request);
  },
};
