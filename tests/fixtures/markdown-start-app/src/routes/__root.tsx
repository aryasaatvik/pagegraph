import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { T } from "pagegraph/react";

import "../facts";

export const Route = createRootRoute({
  component: () => (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        <header><T>Shared shell text</T></header>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});
