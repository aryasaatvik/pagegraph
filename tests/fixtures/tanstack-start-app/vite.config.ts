import { defineConfig } from "vite";

import { pagegraph } from "../../../src/tanstack-start/index";

export default defineConfig({
  // A build constant the route modules read, as an app's env config would be.
  define: { "import.meta.env.VITE_BRAND": JSON.stringify("Example") },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  plugins: [
    pagegraph({
      origin: "https://example.com",
      robots: { disallow: ["/app"], contentSignal: "search=yes" },
      collections: "src/collections.ts",
      exclude: ["app-only.tsx"],
    }),
  ],
});
