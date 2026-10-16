import { defineConfig } from "vitest/config";

export default defineConfig({
  assetsInclude: ["**/*.md", "**/*.txt"],
  test: {
    environment: "node",
    // CLI subprocesses and app builds share the same host resources.
    maxWorkers: 2,
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
