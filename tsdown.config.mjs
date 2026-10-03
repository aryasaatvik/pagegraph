import { defineConfig } from "tsdown";
import { libraryAlwaysBundle } from "./scripts/bundle-policy.mjs";

// One entry per public `exports` subpath, plus `cli` for the `bin`. Two passes so
// the CLI can bundle Effect while the library entries stay dependency-free.
//
// Runtime entries use portable graph/document code and their declared React/Start peers;
// `tests/package/entry-graph.test.ts` pins what they import. The prerender-worker entry
// forwards to the compiled application only in the non-deployed capture Worker.
// Build entries (`vite`, `config`, `audit`, `claims`, `tanstack-start`, `oxlint`) load the app through Vite or drive Node
// I/O. Each has a `build-only/*` twin that the `workerd`/`worker`/`browser` export
// conditions resolve to, which throws a clear error at import.
//
// `cli` reaches Effect and the Bun platform adapter. It is
// built as a separate pass that **bundles** `effect` and `@effect/*`: a published
// binary that resolved Effect from the consumer's tree would couple to the
// consumer's Effect version. Bundling makes the binary
// self-contained. `vite` and `lighthouse` stay external — the CLI loads the app
// graph through Vite and spawns Lighthouse, both optional peers.
const base = {
  format: ["esm"],
  outDir: "dist",
  dts: true,
  sourcemap: true,
  platform: "neutral",
  loader: {
    ".jsonc": "text",
    ".md": "text",
    ".txt": "text",
  },
  // Neutral resolves no Node builtins, so `node:*` imports are declared external
  // here rather than left to be inferred with a warning.
  // `virtual:pagegraph/runtime` is resolved by the app's build through the plugin.
  deps: { neverBundle: [/^node:/, /^virtual:/] },
  // Emit `.js` (not `.mjs`) so the `exports` map points at plain `.js`; the
  // package is `type: module`, so `.js` is ESM.
  outExtensions: () => ({ js: ".js" }),
};

export default defineConfig([
  {
    ...base,
    entry: {
      index: "src/core/index.ts",
      react: "src/react/index.ts",
      vite: "src/vite/index.ts",
      config: "src/config/index.ts",
      claims: "src/claims.ts",
      audit: "src/audit/index.ts",
      oxlint: "src/oxlint/index.js",
      "tanstack-start/index": "src/tanstack-start/index.ts",
      "tanstack-start/server": "src/tanstack-start/server.ts",
      "tanstack-start/markdown": "src/tanstack-start/markdown.tsx",
      "tanstack-start/react": "src/tanstack-start/react.tsx",
      "tanstack-start/prerender-worker": "src/tanstack-start/prerender-worker.ts",
      "build-only/tanstack-start": "src/build-only/tanstack-start.ts",
      "build-only/vite": "src/build-only/vite.ts",
      "build-only/config": "src/build-only/config.ts",
      "build-only/claims": "src/build-only/claims.ts",
      "build-only/audit": "src/build-only/audit.ts",
      "build-only/oxlint": "src/build-only/oxlint.ts",
    },
    // `schema-dts` is types-only: it is bundled into the `.d.ts` and erases from
    // the JS, which is what keeps `.`/`./react` free of runtime dependencies.
    // Authored document hashes are synchronous and portable; consumers need no noble dependency.
    deps: { ...base.deps, alwaysBundle: libraryAlwaysBundle },
    clean: true,
  },
  {
    ...base,
    entry: { cli: "src/cli/bin.ts" },
    // The library pass owns the clean; this pass appends the CLI artifacts.
    clean: false,
    deps: {
      neverBundle: [/^node:/, /^virtual:/],
      // Effect and every `@effect/*` package are bundled for the built CLI and
      // workflow runtime, so consumers do not resolve a different Effect version.
      alwaysBundle: [/^effect(\/|$)/, /^@effect\//],
    },
  },
]);
