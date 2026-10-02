import { defineConfig } from "vite";

import { pagegraph } from "../../../src/tanstack-start/index";

export default defineConfig(({ command }) => ({
  // A build constant the route modules read, as an app's env config would be.
  define: { "import.meta.env.VITE_BRAND": JSON.stringify("Example") },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  plugins: [
    pagegraph({
      // A build describes the deployment; dev and the CLI's serve-mode evaluation describe the local host.
      origin: command === "build" ? "https://example.com" : "http://localhost:5173",
      indexable: command === "build",
      robots: { disallow: ["/app"], contentSignal: "search=yes" },
      collections: "src/collections.ts",
      exclude: ["app-only.tsx"],
    }),
  ],
  build: { rolldownOptions: { input: "src/server-entry.ts" } },
  environments: {
    ssr: { build: { outDir: "dist/server", rolldownOptions: { input: "src/server-entry.ts" } } },
  },
}));
